import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Mic, Play, Pause, Square, X, ChevronLeft, ChevronRight, SkipBack, Download,
} from "lucide-react";
import type { DocMeta } from "@/lib/storage";

const TTS_BASE = "http://localhost:8788";
const CHUNK_SIZE = 2000;

interface Voice {
  id: string;
  name: string;
  gender: string;
  accent: string;
}

interface PodcastPlayerProps {
  isOpen: boolean;
  onClose: () => void;
  activeMeta: DocMeta | null;
  notesHtml?: string;
}

function htmlToPlainText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;

  div.querySelectorAll("hr, script, style").forEach((el) => el.remove());

  div.querySelectorAll("p, strong, em, h1, h2, h3, h4, h5, h6").forEach((el) => {
    if (/^[\s\-–—]*AI\s+Response[\s\-–—]*$/i.test(el.textContent || "")) {
      el.remove();
    }
  });

  div.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,tr,br,div").forEach((el) => {
    el.insertAdjacentText("afterend", ". ");
  });

  const raw = (div.textContent || "").replace(/\s+/g, " ").trim();

  return raw
    .replace(/[^\x00-\x7F]/g, " ")
    .replace(/(\.\s*){2,}/g, ". ")
    .replace(/^[^a-zA-Z0-9]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitIntoChunks(text: string, size: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= size) {
      chunks.push(remaining);
      break;
    }
    const slice = remaining.slice(0, size);
    const lastPeriod = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("? "), slice.lastIndexOf("! "));
    const cutAt = lastPeriod > size * 0.5 ? lastPeriod + 2 : size;
    chunks.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }
  return chunks.filter(Boolean);
}

export function PodcastPlayer({ isOpen, onClose, activeMeta, notesHtml }: PodcastPlayerProps) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState("voice-79");
  const [rate, setRate] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chunks, setChunks] = useState<string[]>([]);
  const [chunkIndex, setChunkIndex] = useState(0);
  const [audioUrls, setAudioUrls] = useState<(string | null)[]>([]);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [manualText, setManualText] = useState("");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadedSrcRef = useRef<string | null>(null);

  // Auto-populate text from notes when opened
  useEffect(() => {
    if (isOpen && notesHtml && !manualText) {
      const plain = htmlToPlainText(notesHtml);
      if (plain) setManualText(plain);
    }
  }, [isOpen, notesHtml]);

  // Check server status
  useEffect(() => {
    if (!isOpen) return;
    fetch(`${TTS_BASE}/api/voices`, { signal: AbortSignal.timeout(2000) })
      .then(() => setServerOnline(true))
      .catch(() => setServerOnline(false));
  }, [isOpen]);

  // Load voices
  useEffect(() => {
    if (!isOpen || !serverOnline) return;
    fetch(`${TTS_BASE}/api/voices`)
      .then((r) => r.json())
      .then((d) => setVoices(d.voices || []))
      .catch(() => {});
  }, [isOpen, serverOnline]);

  // Auto-advance chunks
  const handleAudioEnded = useCallback(() => {
    let next = chunkIndex + 1;
    while (next < chunks.length && audioUrls[next] === null && next < audioUrls.length) {
      next++;
    }
    if (next < chunks.length && audioUrls[next]) {
      setChunkIndex(next);
    } else {
      setIsPlaying(false);
    }
  }, [chunkIndex, chunks.length, audioUrls]);

  // Load audio when chunk URL changes
  const currentUrl = audioUrls[chunkIndex] || null;
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentUrl) return;
    if (loadedSrcRef.current === currentUrl) return;

    loadedSrcRef.current = currentUrl;
    audio.src = currentUrl;
    audio.load();
    if (isPlaying) {
      audio.play().catch(() => setIsPlaying(false));
    }
  }, [currentUrl, isPlaying]);

  const generateAudio = async () => {
    const rawText = manualText.trim();
    if (!rawText) { setError("Please enter some text to convert to speech."); return; }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
    loadedSrcRef.current = null;
    audioUrls.forEach((u) => u && URL.revokeObjectURL(u));
    if (downloadUrl) { URL.revokeObjectURL(downloadUrl); setDownloadUrl(null); }

    const textChunks = splitIntoChunks(rawText, CHUNK_SIZE);
    setChunks(textChunks);
    setChunkIndex(0);
    setAudioUrls(new Array(textChunks.length).fill(null));
    setIsPlaying(false);
    setIsGenerating(true);
    setError(null);
    setProgress(0);
    setDuration(0);

    abortRef.current = new AbortController();

    let skipped = 0;
    let startedPlayback = false;
    try {
      const urls: (string | null)[] = new Array(textChunks.length).fill(null);
      for (let i = 0; i < textChunks.length; i++) {
        if (abortRef.current.signal.aborted) break;

        try {
          const res = await fetch(`${TTS_BASE}/api/tts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: textChunks[i], voice: selectedVoice, pitch: 0, rate }),
            signal: abortRef.current.signal,
          });

          if (res.ok) {
            const blob = await res.blob();
            if (blob.size > 0) {
              urls[i] = URL.createObjectURL(blob);
            } else {
              skipped++;
            }
          } else {
            skipped++;
          }
        } catch (chunkErr: any) {
          if (chunkErr.name === "AbortError") throw chunkErr;
          skipped++;
        }

        setAudioUrls([...urls]);

        if (!startedPlayback && urls[i]) {
          startedPlayback = true;
          setChunkIndex(i);
          setIsPlaying(true);
        }
      }

      if (skipped > 0) {
        setError(`${skipped} part${skipped > 1 ? "s" : ""} could not be converted (skipped).`);
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setError(err.message || "Failed to generate audio");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      const url = audioUrls[chunkIndex];
      if (url && loadedSrcRef.current !== url) {
        loadedSrcRef.current = url;
        audio.src = url;
        audio.load();
      }
      audio.play().catch(() => setIsPlaying(false));
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setIsGenerating(false);
  };

  const skipChunk = (delta: number) => {
    const next = Math.max(0, Math.min(chunks.length - 1, chunkIndex + delta));
    setChunkIndex(next);
  };

  const handleDownload = () => {
    const url = audioUrls[chunkIndex];
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `podcast-part${chunkIndex + 1}-${Date.now()}.mp3`;
    a.click();
  };

  const handleLoadNotes = () => {
    if (!notesHtml) return;
    const plain = htmlToPlainText(notesHtml);
    if (plain) setManualText(plain);
  };

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  const wordCount = manualText.split(/\s+/).filter(Boolean).length;
  const estimatedMins = Math.ceil(wordCount / 150);
  const readyCount = audioUrls.filter(Boolean).length;

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[540px] bg-background border border-border rounded-2xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-primary/20 to-primary/5 px-5 py-3 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center">
            <Mic className="h-3.5 w-3.5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">Podcast Mode</p>
            {activeMeta && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[280px]">{activeMeta.name}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{wordCount} words · ~{estimatedMins} min</span>
          <div
            className={`w-2 h-2 rounded-full ${
              serverOnline === true ? "bg-green-500" : serverOnline === false ? "bg-red-500" : "bg-yellow-500"
            }`}
            title={serverOnline === true ? "Server online" : serverOnline === false ? "Server offline" : "Checking…"}
          />
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {serverOnline === false && (
          <div className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
            TTS server offline. Start it with <code className="font-mono">node server.js</code> on port 3001.
          </div>
        )}

        {/* Voice + Speed */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Voice</label>
            <select
              value={selectedVoice}
              onChange={(e) => setSelectedVoice(e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {voices.length === 0 && <option value="voice-79">Nova — American ♀</option>}
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} — {v.accent} {v.gender === "female" ? "♀" : v.gender === "male" ? "♂" : "⚬"}
                </option>
              ))}
            </select>
          </div>
          <div className="w-32">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Speed: {rate > 0 ? `+${rate}` : rate}
            </label>
            <input
              type="range"
              min="-10"
              max="10"
              step="1"
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
              className="w-full accent-primary mt-1.5"
            />
          </div>
        </div>

        {/* Hidden audio element */}
        <audio
          ref={audioRef}
          onEnded={handleAudioEnded}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={() => {
            if (audioRef.current) setProgress(audioRef.current.currentTime);
          }}
          onLoadedMetadata={() => {
            if (audioRef.current) setDuration(audioRef.current.duration);
          }}
        />

        {/* Progress bar */}
        {chunks.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                Part {chunkIndex + 1} of {chunks.length}
                {isGenerating && ` · ${readyCount} ready`}
              </span>
              <span>{formatTime(progress)} / {formatTime(duration)}</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: duration > 0 ? `${(progress / duration) * 100}%` : "0%" }}
              />
            </div>
            {chunks.length > 1 && (
              <div className="flex gap-1 justify-center mt-1">
                {chunks.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setChunkIndex(i)}
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${
                      i === chunkIndex ? "bg-primary" : audioUrls[i] ? "bg-primary/40" : "bg-muted-foreground/30"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Text input */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">Text to convert:</label>
            {notesHtml && (
              <button
                onClick={handleLoadNotes}
                className="text-xs text-primary hover:underline"
              >
                Load from notes
              </button>
            )}
          </div>
          <textarea
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            placeholder="Type or paste your notes here, or click 'Load from notes'…"
            className="w-full h-24 px-3 py-2 text-sm bg-muted border border-border rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            disabled={isGenerating}
          />
          <p className="text-xs text-muted-foreground text-right">{manualText.length} / 5000 chars</p>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {/* Controls */}
        <div className="flex items-center gap-2">
          <Button
            onClick={generateAudio}
            disabled={isGenerating || !manualText.trim() || serverOnline === false}
            className="flex-1 h-9 text-sm gap-2"
          >
            <Mic className="h-4 w-4" />
            {isGenerating
              ? `Generating… ${readyCount}/${chunks.length || "?"}`
              : chunks.length > 0 ? "Regenerate" : "Generate Podcast"}
          </Button>

          {chunks.length > 0 && (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => skipChunk(-1)} disabled={chunkIndex === 0}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-9 w-9" onClick={togglePlay} disabled={!audioUrls[chunkIndex]}>
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button variant="outline" size="icon" className="h-9 w-9" onClick={handleStop}>
                <Square className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => skipChunk(1)} disabled={chunkIndex >= chunks.length - 1}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => { setChunkIndex(0); if (audioRef.current) audioRef.current.currentTime = 0; }}>
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-9 w-9" onClick={handleDownload} disabled={!audioUrls[chunkIndex]} title="Download current part">
                <Download className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Long text is split into parts and streamed as audio becomes ready
        </p>
      </div>
    </div>
  );
}
