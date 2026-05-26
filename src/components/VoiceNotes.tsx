import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, X, Download, Scissors, Square, Circle, FileAudio } from "lucide-react";
import { toast } from "sonner";

interface VoiceRecorderProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertToNotes: (html: string) => void;
  onSendToTranscriber?: (file: File) => void;
}

const CHUNK_MINUTES = 10;
const CHUNK_MS = CHUNK_MINUTES * 60 * 1000;

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getMimeType(): string {
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  return "audio/webm";
}

function getExtension(mimeType: string): string {
  if (mimeType.includes("mp4")) return "m4a";
  return "webm";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface RecordingChunk {
  index: number;
  blob: Blob;
  durationSec: number;
  label: string;
}

export function VoiceNotes({ isOpen, onClose, onInsertToNotes, onSendToTranscriber }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [chunks, setChunks] = useState<RecordingChunk[]>([]);
  const [fullBlob, setFullBlob] = useState<Blob | null>(null);
  const [mimeType, setMimeType] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const blobsRef = useRef<Blob[]>([]);           // all blobs for the full recording
  const chunkBlobsRef = useRef<Blob[]>([]);       // blobs for current 10-min chunk
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunkStartSecRef = useRef(0);
  const chunkIndexRef = useRef(0);
  const secondsRef = useRef(0);

  useEffect(() => {
    if (!isOpen) stopRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => () => stopRecording(), []);

  function startTimer() {
    timerRef.current = setInterval(() => {
      secondsRef.current += 1;
      setSeconds(secondsRef.current);
    }, 1000);
  }

  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      blobsRef.current = [];
      chunkBlobsRef.current = [];
      chunkIndexRef.current = 0;
      chunkStartSecRef.current = 0;
      secondsRef.current = 0;
      setSeconds(0);
      setChunks([]);
      setFullBlob(null);

      const mime = getMimeType();
      setMimeType(mime);

      const mr = new MediaRecorder(stream, { mimeType: mime });
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) {
          blobsRef.current.push(e.data);
          chunkBlobsRef.current.push(e.data);
        }
      };
      mr.start(1000);
      mediaRecorderRef.current = mr;

      setIsRecording(true);
      setIsPaused(false);
      startTimer();

      // Auto-split every 10 minutes
      chunkTimerRef.current = setInterval(() => sealChunk(false), CHUNK_MS);
    } catch {
      toast.error("Microphone access denied.");
    }
  }

  function sealChunk(isFinal: boolean) {
    const mime = mediaRecorderRef.current?.mimeType ?? mimeType;
    const blob = new Blob(chunkBlobsRef.current, { type: mime });
    if (blob.size < 1000) return; // ignore near-empty chunks

    const idx = chunkIndexRef.current++;
    const startSec = chunkStartSecRef.current;
    const endSec = isFinal ? secondsRef.current : startSec + CHUNK_MS / 1000;
    const label = `Part ${idx + 1} — ${formatTime(startSec)} to ${formatTime(endSec)}`;

    setChunks((prev) => [...prev, { index: idx, blob, durationSec: endSec - startSec, label }]);
    chunkBlobsRef.current = [];
    chunkStartSecRef.current = endSec;
  }

  function stopRecording() {
    if (chunkTimerRef.current) { clearInterval(chunkTimerRef.current); chunkTimerRef.current = null; }
    stopTimer();

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      // Flush remaining data then seal
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          blobsRef.current.push(e.data);
          chunkBlobsRef.current.push(e.data);
        }
      };
      mediaRecorderRef.current.onstop = () => {
        sealChunk(true);
        const mime = mediaRecorderRef.current?.mimeType ?? mimeType;
        const full = new Blob(blobsRef.current, { type: mime });
        if (full.size > 0) setFullBlob(full);
      };
      mediaRecorderRef.current.stop();
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    setIsRecording(false);
    setIsPaused(false);
  }

  function togglePause() {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    if (isPaused) {
      mr.resume();
      startTimer();
      setIsPaused(false);
    } else {
      mr.pause();
      stopTimer();
      setIsPaused(true);
    }
  }

  function handleReset() {
    stopRecording();
    setChunks([]);
    setFullBlob(null);
    setSeconds(0);
    secondsRef.current = 0;
    blobsRef.current = [];
    chunkBlobsRef.current = [];
  }

  function downloadFull() {
    if (!fullBlob) return;
    const ext = getExtension(mimeType);
    downloadBlob(fullBlob, `recording-${new Date().toISOString().slice(0, 16).replace("T", "_")}.${ext}`);
  }

  function downloadChunk(chunk: RecordingChunk) {
    const ext = getExtension(mimeType);
    downloadBlob(chunk.blob, `recording-part${chunk.index + 1}.${ext}`);
  }

  function downloadAllChunks() {
    chunks.forEach((c, i) => {
      setTimeout(() => {
        const ext = getExtension(mimeType);
        downloadBlob(c.blob, `recording-part${c.index + 1}.${ext}`);
      }, i * 300);
    });
  }

  if (!isOpen) return null;

  const hasRecording = fullBlob || chunks.length > 0;
  const ext = getExtension(mimeType);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-xl border border-border bg-background shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-toolbar shrink-0">
          <div className="flex items-center gap-2">
            <Mic className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Voice Recorder</span>
            {isRecording && (
              <span className="flex items-center gap-1 text-xs text-red-500">
                <span className={`inline-block h-2 w-2 rounded-full bg-red-500 ${isPaused ? "" : "animate-pulse"}`} />
                {isPaused ? "Paused" : "Recording"} — {formatTime(seconds)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {hasRecording && !isRecording && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleReset}>
                New
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-4">

          {/* Record controls */}
          {!hasRecording && (
            <div className="flex flex-col items-center gap-4 py-6">
              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={`w-24 h-24 rounded-full flex items-center justify-center shadow-lg transition-all ${
                  isRecording ? "bg-red-500 hover:bg-red-600" : "bg-primary hover:bg-primary/90"
                }`}
              >
                {isRecording
                  ? <Square className="h-8 w-8 text-white fill-white" />
                  : <Circle className="h-10 w-10 text-white fill-white" />
                }
              </button>

              {isRecording ? (
                <div className="text-center space-y-1">
                  <p className="text-2xl font-mono font-semibold tabular-nums">{formatTime(seconds)}</p>
                  <p className="text-xs text-muted-foreground">Auto-splits every {CHUNK_MINUTES} min</p>
                  <div className="flex gap-2 mt-2">
                    <Button variant="outline" size="sm" onClick={togglePause} className="gap-1.5">
                      {isPaused ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
                      {isPaused ? "Resume" : "Pause"}
                    </Button>
                    <Button variant="destructive" size="sm" onClick={stopRecording} className="gap-1.5">
                      <Square className="h-3.5 w-3.5 fill-white" /> Stop
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium">Tap to start recording</p>
                  <p className="text-xs text-muted-foreground">
                    Records locally · auto-splits into {CHUNK_MINUTES}-min parts
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Active recording with chunks building up */}
          {isRecording && chunks.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Completed parts</p>
              {chunks.map((chunk) => (
                <ChunkRow
                  key={chunk.index}
                  chunk={chunk}
                  ext={ext}
                  onDownload={downloadChunk}
                  onTranscribe={onSendToTranscriber ? (c) => {
                    const file = new File([c.blob], `recording-part${c.index + 1}.${ext}`, { type: c.blob.type });
                    onSendToTranscriber(file);
                    toast.success(`Part ${c.index + 1} sent to Audio Transcriber`);
                  } : undefined}
                />
              ))}
            </div>
          )}

          {/* Finished recording results */}
          {!isRecording && hasRecording && (
            <div className="space-y-4">
              {/* Timer summary */}
              <div className="rounded-lg bg-muted/40 px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Recording complete</p>
                  <p className="text-xs text-muted-foreground">
                    {formatTime(seconds)} total
                    {chunks.length > 1 ? ` · ${chunks.length} parts` : ""}
                    {fullBlob ? ` · ${formatSize(fullBlob.size)}` : ""}
                  </p>
                </div>
                {fullBlob && (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={downloadFull}>
                    <Download className="h-3.5 w-3.5" /> Download full
                  </Button>
                )}
              </div>

              {/* Chunks */}
              {chunks.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <Scissors className="h-3.5 w-3.5" />
                      {chunks.length} × {CHUNK_MINUTES}-min parts
                    </p>
                    {chunks.length > 1 && (
                      <button
                        onClick={downloadAllChunks}
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                      >
                        <Download className="h-3 w-3" /> Download all
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Upload each part to <strong>Audio Transcriber</strong> for transcription.
                  </p>
                  {chunks.map((chunk) => (
                    <ChunkRow
                      key={chunk.index}
                      chunk={chunk}
                      ext={ext}
                      onDownload={downloadChunk}
                      onTranscribe={onSendToTranscriber ? (c) => {
                        const file = new File([c.blob], `recording-part${c.index + 1}.${ext}`, { type: c.blob.type });
                        onSendToTranscriber(file);
                        toast.success(`Part ${c.index + 1} sent to Audio Transcriber`);
                      } : undefined}
                    />
                  ))}
                </div>
              )}

              {/* Record again */}
              <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={handleReset}>
                <Circle className="h-3.5 w-3.5 fill-current" /> Record again
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChunkRow({
  chunk,
  ext,
  onDownload,
  onTranscribe,
}: {
  chunk: RecordingChunk;
  ext: string;
  onDownload: (c: RecordingChunk) => void;
  onTranscribe?: (c: RecordingChunk) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{chunk.label}</p>
        <p className="text-xs text-muted-foreground">
          {formatTime(chunk.durationSec)} · {formatSize(chunk.blob.size)} · .{ext}
        </p>
      </div>
      <div className="flex gap-1 shrink-0">
        {onTranscribe && (
          <Button size="sm" variant="default" className="h-7 text-xs gap-1" onClick={() => onTranscribe(chunk)}>
            <FileAudio className="h-3 w-3" /> Transcribe
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onDownload(chunk)}>
          <Download className="h-3 w-3" /> Download
        </Button>
      </div>
    </div>
  );
}
