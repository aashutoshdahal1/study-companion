import { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { X, Upload, Loader2, FileAudio, ClipboardPaste, RotateCcw, ChevronDown, ChevronUp, Mic, MicOff, Radio } from "lucide-react";
import { toast } from "sonner";

const CHUNK_MS = 10 * 60 * 1000; // 10 minutes per chunk

// Convert markdown + embedded HTML to pure HTML for rendering and TipTap insertion.
// Multi-line <div style="..."> blocks are wrapped in a sentinel so TipTap's HtmlBlock
// extension stores them as a single atomic node (preserving all inline styles).
function markdownToHtml(text: string): string {
  // First pass: collect multi-line HTML div blocks into single tokens
  const tokens = splitHtmlBlocks(text);
  const out: string[] = [];
  let inList = false;

  for (const token of tokens) {
    if (token.type === "html") {
      if (inList) { out.push("</ul>"); inList = false; }
      // Wrap in sentinel div so TipTap HtmlBlock parseHTML rule catches it
      out.push(`<div class="html-block" data-html="${escAttr(token.content)}">${token.content}</div>`);
      continue;
    }

    const line = token.content.trimEnd();
    if (!line.trim()) {
      if (inList) { out.push("</ul>"); inList = false; }
      continue;
    }

    if (line.startsWith("### ")) { if (inList) { out.push("</ul>"); inList = false; } out.push(`<h3>${inlineFormat(line.slice(4))}</h3>`); continue; }
    if (line.startsWith("## "))  { if (inList) { out.push("</ul>"); inList = false; } out.push(`<h2>${inlineFormat(line.slice(3))}</h2>`); continue; }
    if (line.startsWith("# "))   { if (inList) { out.push("</ul>"); inList = false; } out.push(`<h1>${inlineFormat(line.slice(2))}</h1>`); continue; }

    if (line.startsWith("- ") || line.startsWith("• ")) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inlineFormat(line.slice(2))}</li>`);
      continue;
    }

    if (inList) { out.push("</ul>"); inList = false; }
    out.push(`<p>${inlineFormat(line)}</p>`);
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

// Split text into markdown lines and multi-line HTML div blocks
function splitHtmlBlocks(text: string): Array<{ type: "md" | "html"; content: string }> {
  const result: Array<{ type: "md" | "html"; content: string }> = [];
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Detect start of a block-level HTML element
    if (/^\s*<(div|section|article|aside|figure|table|blockquote)[\s>]/i.test(line)) {
      const tagMatch = line.match(/^\s*<(\w+)/);
      const tag = tagMatch ? tagMatch[1].toLowerCase() : "div";
      let depth = 0;
      const block: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        depth += (l.match(new RegExp(`<${tag}[\\s>]`, "gi")) || []).length;
        depth -= (l.match(new RegExp(`</${tag}>`, "gi")) || []).length;
        block.push(l);
        i++;
        if (depth <= 0) break;
      }
      result.push({ type: "html", content: block.join("\n") });
    } else {
      result.push({ type: "md", content: line });
      i++;
    }
  }
  return result;
}

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function inlineFormat(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

// ── audioconvert.ai API ────────────────────────────────────────────────────
// All calls are proxied through the local server to avoid browser CORS restrictions.
const AC_BASE = "http://localhost:8788/api/audioconvert";

const getToken = () => localStorage.getItem("audioconvert-token") || "";

// The proxy reads X-AC-Token and adds the Bearer prefix itself.
function acHeaders(extra: Record<string, string> = {}) {
  return {
    "X-AC-Token": getToken(),
    accept: "*/*",
    ...extra,
  };
}

// Step 1: get presigned upload URL + the resource key embedded in it
async function presign(filename: string): Promise<{ uploadUrl: string; fileLink: string }> {
  const res = await fetch(
    `${AC_BASE}/resource/upload/presign?filename=${encodeURIComponent(filename)}`,
    { headers: acHeaders() }
  );
  if (!res.ok) throw new Error(`Presign failed: ${res.status}`);
  const json = await res.json();
  console.log("[AudioTranscriber] presign response:", json);
  const uploadUrl: string = json?.data?.upload_url ?? "";
  if (!uploadUrl) throw new Error(`Presign: missing data.upload_url. Got: ${JSON.stringify(json)}`);
  // file_link is the permanent CDN URL used to reference the file after upload.
  // If not returned directly, derive it from the upload URL (path without query string).
  const fileLink: string =
    json?.data?.file_link ?? json?.data?.cdn_url ?? json?.data?.url ??
    (() => { const u = new URL(uploadUrl); return `${u.origin}${u.pathname}`; })();
  return { uploadUrl, fileLink };
}

// Step 2: PUT file via local server proxy — browser PUT to Aliyun OSS directly
// gets 403 because the browser adds Origin/Referer headers that break the presigned signature.
async function uploadFile(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch("http://localhost:8788/api/oss-upload", {
    method: "PUT",
    headers: { "X-OSS-URL": uploadUrl },
    body: file,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Upload failed: ${err.error ?? res.status}${err.detail ? ` — ${err.detail}` : ""}`);
  }
}

// Step 3: tell audioconvert.ai to start transcription, get back a transcribeId.
// The API accepts either audio_url (full OSS URL) or resource_key (path portion).
async function startTranscription(fileLink: string, filename: string): Promise<string> {
  // Try resource_key (path without host) first — more reliable than full OSS URL
  const urlObj = new URL(fileLink);
  const resourceKey = urlObj.pathname.replace(/^\//, "");
  const body = { audio_url: fileLink, resource_key: resourceKey, filename };
  console.log("[AudioTranscriber] startTranscription body:", body);

  const res = await fetch(`${AC_BASE}/transcribe`, {
    method: "POST",
    headers: acHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Start transcription failed: ${res.status}`);
  const json = await res.json();
  console.log("[AudioTranscriber] start transcription response:", json);
  const id: string =
    json?.data?.transcribe_id ?? json?.data?.id ?? json?.transcribe_id ?? json?.id ?? "";
  if (!id) throw new Error(`No transcribe ID in response. Got: ${JSON.stringify(json)}`);
  return id;
}

// Step 4: poll until transcription is ready, returns formatted transcript string
async function pollTranscription(transcribeId: string, onStatus: (s: string) => void): Promise<string> {
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const res = await fetch(`${AC_BASE}/transcribe/${transcribeId}`, { headers: acHeaders() });
      if (!res.ok) continue;
      const json = await res.json();
      const status: string =
        json?.data?.status ?? json?.data?.state ?? json?.status ?? json?.state ?? "";
      onStatus(status);
      if (["done", "completed", "ready", "success"].includes(status)) {
        return buildTranscript(json?.data);
      }
      if (["error", "failed"].includes(status)) throw new Error("Transcription failed on server.");
    } catch (e: any) {
      if (e.message?.startsWith("Transcription failed")) throw e;
    }
  }
  throw new Error("Transcription timed out after 6 minutes.");
}

// Build speaker-segmented transcript from word-level data.
// Uses word timestamps to find speaker-change boundaries, then slices the
// original plain text (which has correct punctuation) for each segment.
function buildTranscript(data: any): string {
  const words: any[] = data?.transcription?.words ?? [];
  const plainText: string = data?.transcription?.text ?? data?.text ?? "";

  // No word data — return plain text as-is
  if (words.length === 0 || !plainText) return plainText;

  // Collect speaker-change boundaries: { speaker, charStart, charEnd, timeStart }
  // We use only actual word tokens (not spacing) to track speaker changes.
  // Each word has a char offset we can approximate by matching against plainText.
  interface Seg { speaker: string; timeStart: number; words: string[] }
  const segs: Seg[] = [];
  let cur: Seg | null = null;

  for (const w of words) {
    if (w.type === "spacing" || !w.text?.trim()) continue;
    const speaker: string = w.speaker_id ?? "speaker_0";
    if (!cur || cur.speaker !== speaker) {
      if (cur) segs.push(cur);
      cur = { speaker, timeStart: w.start ?? 0, words: [w.text] };
    } else {
      cur.words.push(w.text);
    }
  }
  if (cur) segs.push(cur);

  if (segs.length === 0) return plainText;

  // Map each segment to a slice of plainText by finding where its first word starts
  const speakerMap: Record<string, string> = {};
  let speakerIndex = 1;
  const label = (id: string) => {
    if (!speakerMap[id]) speakerMap[id] = `Speaker ${speakerIndex++}`;
    return speakerMap[id];
  };

  const result: string[] = [];
  let searchFrom = 0;

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const nextSeg = segs[i + 1];
    const firstWord = seg.words[0];

    // Find start of this segment in plainText
    const idx = plainText.indexOf(firstWord, searchFrom);
    if (idx === -1) continue;

    // Find end: start of next segment's first word, or end of string
    let end = plainText.length;
    if (nextSeg) {
      const nextIdx = plainText.indexOf(nextSeg.words[0], idx + firstWord.length);
      if (nextIdx !== -1) end = nextIdx;
    }

    const segText = plainText.slice(idx, end).trim();
    searchFrom = idx + firstWord.length;

    result.push(`${formatTime(seg.timeStart)}\n${label(seg.speaker)}\n${segText}`);
  }

  return result.join("\n\n");
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// Step 5: stream the summary via SSE
async function streamSummary(transcribeId: string, onChunk: (text: string) => void): Promise<void> {
  const res = await fetch(`${AC_BASE}/transcribe/${transcribeId}/summary?scenario=auto`, {
    method: "POST",
    headers: acHeaders({ accept: "text/event-stream" }),
  });
  if (!res.ok) throw new Error(`Summary failed: ${res.status}`);
  const reader = res.body?.getReader();
  if (!reader) return;
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      try {
        const payload = JSON.parse(line.slice(5).trim());
        if (payload.t) onChunk(payload.t);
      } catch {}
    }
  }
}

// Step 6: fetch visual HTML summary (non-blocking bonus)
async function fetchVisualSummary(transcribeId: string): Promise<string> {
  const res = await fetch(`${AC_BASE}/transcribe/${transcribeId}/visual-summary`, {
    headers: acHeaders(),
  });
  if (!res.ok) return "";
  const json = await res.json();
  return json?.data?.html ?? json?.html ?? json?.content ?? "";
}

// ── Component ──────────────────────────────────────────────────────────────

type Step = "idle" | "uploading" | "transcribing" | "summarising" | "done" | "error";

interface LiveChunk {
  index: number;
  label: string;        // "Chunk 1 (00:00 – 10:00)"
  status: "processing" | "done" | "error";
  transcript: string;
  error?: string;
}

interface AudioTranscriberProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertToNotes: (html: string) => void;
  pendingFile?: File | null;
  onPendingFileConsumed?: () => void;
}

export function AudioTranscriber({ isOpen, onClose, onInsertToNotes, pendingFile, onPendingFileConsumed }: AudioTranscriberProps) {
  const [step, setStep] = useState<Step>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [summary, setSummary] = useState("");
  const [transcript, setTranscript] = useState("");
  const [activeTab, setActiveTab] = useState<"summary" | "transcript">("summary");
  const [visualHtml, setVisualHtml] = useState("");
  const [showVisual, setShowVisual] = useState(false);
  const [token, setToken] = useState(() => localStorage.getItem("audioconvert-token") || "");
  const [showTokenInput, setShowTokenInput] = useState(!localStorage.getItem("audioconvert-token"));

  // Live recording state
  const [mode, setMode] = useState<"file" | "live">("file");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [liveChunks, setLiveChunks] = useState<LiveChunk[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunkBlobsRef = useRef<Blob[]>([]);
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunkIndexRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);

  // Auto-process a file passed from another component (e.g. VoiceNotes chunk)
  useEffect(() => {
    if (isOpen && pendingFile && step === "idle") {
      onPendingFileConsumed?.();
      handleFile(pendingFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, pendingFile]);

  function saveToken(t: string) {
    localStorage.setItem("audioconvert-token", t);
    setToken(t);
    setShowTokenInput(false);
  }

  // ── Live recording ────────────────────────────────────────────────────────

  useEffect(() => {
    return () => stopRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startRecording() {
    if (!token) { setShowTokenInput(true); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunkIndexRef.current = 0;
      setLiveChunks([]);
      setRecordingSeconds(0);
      setIsRecording(true);
      setActiveTab("transcript");

      // Tick the recording clock
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);

      startChunk(stream);

      // Every 10 min, seal the current chunk and start a new one
      chunkTimerRef.current = setInterval(() => {
        rotateChunk(stream);
      }, CHUNK_MS);

    } catch {
      toast.error("Microphone access denied.");
    }
  }

  function startChunk(stream: MediaStream) {
    chunkBlobsRef.current = [];
    // Prefer mp4/aac which audioconvert.ai handles well; fall back to webm
    const mimeType =
      MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4"
      : MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
      : "audio/webm";
    const ext = mimeType.includes("mp4") ? "m4a" : "webm";
    const mr = new MediaRecorder(stream, { mimeType });
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunkBlobsRef.current.push(e.data); };
    mr.onstop = () => {
      const blob = new Blob(chunkBlobsRef.current, { type: mimeType });
      const idx = chunkIndexRef.current++;
      const startSec = idx * (CHUNK_MS / 1000);
      const endSec = startSec + (CHUNK_MS / 1000);
      const label = `Chunk ${idx + 1} (${formatTime(startSec)} – ${formatTime(endSec)})`;
      const chunk: LiveChunk = { index: idx, label, status: "processing", transcript: "" };
      setLiveChunks((prev) => [...prev, chunk]);
      const filename = `live-recording-chunk-${idx + 1}.${ext}`;
      console.log(`[LiveRecord] chunk ${idx + 1}: ${(blob.size / 1024).toFixed(1)} KB, type=${mimeType}, file=${filename}`);
      processChunk(blob, idx, filename);
    };
    mr.start(1000);
    mediaRecorderRef.current = mr;
  }

  function rotateChunk(stream: MediaStream) {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop(); // triggers onstop → processChunk
    }
    startChunk(stream);
  }

  function stopRecording() {
    if (chunkTimerRef.current) { clearInterval(chunkTimerRef.current); chunkTimerRef.current = null; }
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
  }

  async function processChunk(blob: Blob, idx: number, filename: string) {
    const updateChunk = (patch: Partial<LiveChunk>) =>
      setLiveChunks((prev) => prev.map((c) => (c.index === idx ? { ...c, ...patch } : c)));
    try {
      const file = new File([blob], filename, { type: blob.type });
      const { uploadUrl, fileLink } = await presign(filename);
      console.log(`[LiveRecord] chunk ${idx + 1} fileLink:`, fileLink);
      await uploadFile(uploadUrl, file);
      const transcribeId = await startTranscription(fileLink, filename);
      const text = await pollTranscription(transcribeId, () => {});
      updateChunk({ status: "done", transcript: text || "(no transcript returned)" });
    } catch (err: any) {
      console.error(`[LiveRecord] chunk ${idx + 1} error:`, err.message);
      updateChunk({ status: "error", error: err.message });
    }
  }

  // ── File upload ───────────────────────────────────────────────────────────

  async function handleFile(file: File) {
    if (!token) { setShowTokenInput(true); return; }
    abortRef.current = false;
    setSummary("");
    setTranscript("");
    setVisualHtml("");
    setShowVisual(false);
    setActiveTab("summary");

    try {
      // 1. Get presigned upload URL + permanent file link
      setStep("uploading");
      setStatusMsg(`Preparing upload for ${file.name}…`);
      const { uploadUrl, fileLink } = await presign(file.name);
      if (abortRef.current) return;

      // 2. PUT file directly to Aliyun OSS
      setStatusMsg(`Uploading ${file.name}…`);
      await uploadFile(uploadUrl, file);
      if (abortRef.current) return;

      // 3. Tell audioconvert.ai to start transcription
      setStep("transcribing");
      setStatusMsg("Starting transcription…");
      const transcribeId = await startTranscription(fileLink, file.name);
      if (abortRef.current) return;

      // 4. Poll until transcription is ready, capture transcript text
      setStatusMsg("Transcribing audio… (this takes 1–5 min)");
      const transcriptText = await pollTranscription(transcribeId, (s) => setStatusMsg(`Transcribing… ${s}`));
      if (abortRef.current) return;
      if (transcriptText) setTranscript(transcriptText);

      // 5. Stream summary
      setStep("summarising");
      setStatusMsg("Generating summary…");
      let summaryText = "";
      await streamSummary(transcribeId, (chunk) => {
        summaryText += chunk;
        setSummary(summaryText);
      });
      if (abortRef.current) return;

      // 6. Visual summary (non-blocking)
      fetchVisualSummary(transcribeId)
        .then((html) => { if (html) setVisualHtml(html); })
        .catch(() => {});

      setStep("done");
      setStatusMsg("Done!");
      toast.success("Transcription complete!");
    } catch (err: any) {
      if (abortRef.current) return;
      setStep("error");
      setStatusMsg(err.message || "Something went wrong.");
      toast.error(err.message || "Transcription failed.");
    }
  }

  function handleInsert() {
    const timestamp = new Date().toLocaleString();
    if (activeTab === "transcript") {
      if (!transcript.trim()) return;
      const html =
        `<p><strong>— Transcript (${timestamp}) —</strong></p>` +
        transcript
          .split(/\n\n+/)
          .filter(Boolean)
          .map((block) => {
            const lines = block.trim().split("\n");
            if (lines.length >= 2 && /^\d{2}:\d{2}/.test(lines[0])) {
              const time = lines[0];
              const speaker = lines.length >= 3 ? `<strong>${lines[1]}</strong><br>` : "";
              const text = lines.slice(lines.length >= 3 ? 2 : 1).join(" ");
              return `<p><small style="color:#888">${time}</small><br>${speaker}${text}</p>`;
            }
            return `<p>${block.trim()}</p>`;
          })
          .join("") +
        `<hr>`;
      onInsertToNotes(html);
      toast.success("Transcript inserted into notes!");
    } else {
      if (!summary.trim()) return;
      const html =
        `<p><strong>— Audio Transcript Summary (${timestamp}) —</strong></p>` +
        markdownToHtml(summary) +
        `<hr>`;
      onInsertToNotes(html);
      toast.success("Summary inserted into notes!");
    }
  }

  function handleReset() {
    abortRef.current = true;
    stopRecording();
    setStep("idle");
    setStatusMsg("");
    setSummary("");
    setTranscript("");
    setLiveChunks([]);
    setRecordingSeconds(0);
    setVisualHtml("");
    setShowVisual(false);
    setActiveTab("summary");
  }

  if (!isOpen) return null;

  const busy = step === "uploading" || step === "transcribing" || step === "summarising";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-xl border border-border bg-background shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-toolbar shrink-0">
          <div className="flex items-center gap-2">
            <FileAudio className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Audio Transcriber</span>
            {busy && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                {statusMsg}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {step !== "idle" && (
              <Button variant="ghost" size="sm" onClick={handleReset} className="h-7 text-xs gap-1">
                <RotateCcw className="h-3 w-3" /> New
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-4">

          {/* Token input */}
          {showTokenInput && (
            <div className="space-y-2 p-3 rounded-lg border border-border bg-muted/40">
              <p className="text-xs font-medium">audioconvert.ai Bearer Token</p>
              <p className="text-xs text-muted-foreground">
                Open audioconvert.ai, log in, open DevTools → Network tab, upload any file, and copy the <code className="font-mono">authorization</code> header value (without "Bearer ").
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  defaultValue={token}
                  placeholder="Paste your JWT token here…"
                  className="flex-1 px-2.5 py-1.5 text-xs bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary"
                  onBlur={(e) => {
                    const val = e.target.value.replace(/^Bearer\s+/i, "").trim();
                    if (val) saveToken(val);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const val = (e.target as HTMLInputElement).value.replace(/^Bearer\s+/i, "").trim();
                      if (val) saveToken(val);
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  onClick={() => setShowTokenInput(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Mode switcher */}
          {(step === "idle" || isRecording) && (
            <div className="flex gap-1 rounded-lg bg-muted p-0.5 w-fit">
              <button
                onClick={() => { stopRecording(); setMode("file"); }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${mode === "file" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Upload className="h-3.5 w-3.5" /> Upload File
              </button>
              <button
                onClick={() => setMode("live")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${mode === "live" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Radio className="h-3.5 w-3.5" /> Live Record
              </button>
            </div>
          )}

          {/* File upload area */}
          {step === "idle" && mode === "file" && (
            <div
              className="border-2 border-dashed border-border rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) handleFile(file);
              }}
            >
              <FileAudio className="h-10 w-10 text-muted-foreground/50" />
              <div className="text-center">
                <p className="text-sm font-medium">Drop an audio file here</p>
                <p className="text-xs text-muted-foreground mt-1">MP3, M4A, WAV, OGG — any lecture recording</p>
              </div>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Upload className="h-3.5 w-3.5" /> Browse file
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="audio/*,.mp3,.m4a,.wav,.ogg,.webm"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
              {token && (
                <button className="text-xs text-muted-foreground hover:text-foreground underline" onClick={(e) => { e.stopPropagation(); setShowTokenInput(true); }}>
                  Change token
                </button>
              )}
              {!token && (
                <button className="text-xs text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setShowTokenInput(true); }}>
                  Set API token first
                </button>
              )}
            </div>
          )}

          {/* Live recording area */}
          {mode === "live" && (step === "idle" || isRecording) && (
            <div className="rounded-xl border border-border bg-muted/20 p-6 flex flex-col items-center gap-4">
              {/* Record button */}
              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={`w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-lg ${
                  isRecording
                    ? "bg-red-500 hover:bg-red-600 animate-pulse"
                    : "bg-primary hover:bg-primary/90"
                }`}
              >
                {isRecording
                  ? <MicOff className="h-8 w-8 text-white" />
                  : <Mic className="h-8 w-8 text-white" />
                }
              </button>

              {isRecording ? (
                <div className="text-center space-y-1">
                  <p className="text-sm font-semibold text-red-500 flex items-center gap-1.5 justify-center">
                    <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                    Recording — {formatTime(recordingSeconds)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Auto-splits every 10 min and transcribes each chunk
                  </p>
                </div>
              ) : (
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium">Tap to start recording</p>
                  <p className="text-xs text-muted-foreground">
                    Splits into 10-min chunks · each transcribed automatically
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Live chunks list */}
          {liveChunks.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Live Chunks ({liveChunks.filter(c => c.status === "done").length}/{liveChunks.length} done)
              </p>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {liveChunks.map((chunk) => (
                  <div key={chunk.index} className="rounded-lg border border-border bg-muted/20 overflow-hidden">
                    {/* Chunk header */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-muted/40">
                      {chunk.status === "processing" && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />}
                      {chunk.status === "done" && <span className="h-3.5 w-3.5 rounded-full bg-green-500 shrink-0 flex items-center justify-center"><span className="text-white text-[8px] font-bold">✓</span></span>}
                      {chunk.status === "error" && <span className="h-3.5 w-3.5 rounded-full bg-destructive shrink-0 flex items-center justify-center"><span className="text-white text-[8px] font-bold">!</span></span>}
                      <span className="text-xs font-medium flex-1">{chunk.label}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                        chunk.status === "done" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : chunk.status === "error" ? "bg-destructive/10 text-destructive"
                        : "bg-primary/10 text-primary"
                      }`}>
                        {chunk.status === "processing" ? "Transcribing…" : chunk.status === "done" ? "Done" : "Error"}
                      </span>
                    </div>
                    {/* Chunk transcript */}
                    {chunk.status === "done" && chunk.transcript && (
                      <div className="px-3 py-2 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto font-mono">
                        {chunk.transcript}
                      </div>
                    )}
                    {chunk.status === "error" && (
                      <div className="px-3 py-2 text-xs text-destructive">{chunk.error}</div>
                    )}
                  </div>
                ))}
              </div>
              {/* Insert all done chunks */}
              {liveChunks.some(c => c.status === "done") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5 text-xs"
                  onClick={() => {
                    const combined = liveChunks
                      .filter(c => c.status === "done")
                      .map(c => `**${c.label}**\n\n${c.transcript}`)
                      .join("\n\n---\n\n");
                    const timestamp = new Date().toLocaleString();
                    const html =
                      `<p><strong>— Live Recording Transcript (${timestamp}) —</strong></p>` +
                      markdownToHtml(combined) + `<hr>`;
                    onInsertToNotes(html);
                    toast.success("Live transcript inserted!");
                  }}
                >
                  <ClipboardPaste className="h-3.5 w-3.5" /> Insert All Chunks to Notes
                </Button>
              )}
            </div>
          )}

          {/* Progress states */}
          {busy && (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="h-10 w-10 animate-spin text-primary/60" />
              <div className="text-center">
                <p className="text-sm font-medium">{statusMsg}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {step === "transcribing" && "This can take 1–5 minutes for long recordings…"}
                  {step === "summarising" && "Generating summary in Nepali/English…"}
                </p>
              </div>
            </div>
          )}

          {/* Error */}
          {step === "error" && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
              {statusMsg}
            </div>
          )}

          {/* Results: tabs for Summary / Transcript */}
          {(summary || transcript) && (
            <div className="space-y-2">
              {/* Tab bar */}
              <div className="flex items-center justify-between">
                <div className="flex gap-1 rounded-lg bg-muted p-0.5">
                  <button
                    onClick={() => setActiveTab("summary")}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      activeTab === "summary" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Summary
                  </button>
                  {transcript && (
                    <button
                      onClick={() => setActiveTab("transcript")}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                        activeTab === "transcript" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Transcript
                    </button>
                  )}
                </div>
                <div className="flex gap-1">
                  {activeTab === "summary" && visualHtml && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowVisual(!showVisual)}>
                      {showVisual ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {showVisual ? "Hide visual" : "Visual"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={handleInsert}
                    disabled={activeTab === "summary" ? !summary.trim() : !transcript.trim()}
                  >
                    <ClipboardPaste className="h-3 w-3" /> Insert to Notes
                  </Button>
                </div>
              </div>

              {/* Summary tab */}
              {activeTab === "summary" && (
                <>
                  {showVisual && visualHtml && (
                    <iframe
                      srcDoc={visualHtml}
                      className="w-full rounded-lg border border-border"
                      style={{ height: 420 }}
                      sandbox="allow-same-origin"
                      title="Visual summary"
                    />
                  )}
                  <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm leading-relaxed max-h-72 overflow-y-auto">
                    <div dangerouslySetInnerHTML={{ __html: markdownToHtml(summary) }} />
                    {step === "summarising" && (
                      <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 align-text-bottom" />
                    )}
                  </div>
                </>
              )}

              {/* Transcript tab */}
              {activeTab === "transcript" && transcript && (
                <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm leading-relaxed max-h-72 overflow-y-auto font-mono whitespace-pre-wrap">
                  {transcript}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
