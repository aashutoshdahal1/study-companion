import { useState, useEffect, useRef } from "react";
import { X, Loader2, Sparkles, BookOpenCheck, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { pdfjs } from "react-pdf";
import JSZip from "jszip";
import type { DocMeta } from "@/lib/storage";

interface SmartNotesGeneratorProps {
  isOpen: boolean;
  onClose: () => void;
  activeBlob: Blob | null;
  activeMeta: DocMeta | null;
  totalPages: number;
  currentPage: number;
  notesHtml?: string;
  onInsertToNotes: (html: string) => void;
}

type Phase = "idle" | "extracting" | "generating" | "done";

// ── Text extraction ─────────────────────────────────────────────────────────

async function extractPdfRange(
  blob: Blob,
  from: number,
  to: number,
  onProgress: (p: number) => void
): Promise<string> {
  const data = await blob.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const parts: string[] = [];

  for (let p = from; p <= to; p++) {
    onProgress(p);
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items as Array<{ str?: string; hasEOL?: boolean }>;

    let currentLine = "";
    const lines: string[] = [];

    items.forEach((item) => {
      const chunk = (item.str || "").trimEnd();
      if (!chunk) return;
      if (currentLine && !currentLine.endsWith(" ")) currentLine += " ";
      currentLine += chunk;
      if (item.hasEOL) {
        lines.push(currentLine.trim());
        currentLine = "";
      }
    });
    if (currentLine.trim()) lines.push(currentLine.trim());

    const pageText = lines.join("\n").trim();
    if (pageText) parts.push(`[Page ${p}]\n${pageText}`);
  }

  return parts.join("\n\n");
}

async function extractPptxRange(
  blob: Blob,
  from: number,
  to: number,
  onProgress: (p: number) => void
): Promise<string> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const parts: string[] = [];

  for (let s = from; s <= to; s++) {
    onProgress(s);
    const slideFile = zip.file(`ppt/slides/slide${s}.xml`);
    if (!slideFile) continue;

    const xml = await slideFile.async("string");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const tNodes = doc.getElementsByTagNameNS("*", "t");
    const text = Array.from(tNodes)
      .map((n) => n.textContent || "")
      .join(" ")
      .trim();

    if (text) parts.push(`[Slide ${s}]\n${text}`);
  }

  return parts.join("\n\n");
}

// ── AI proxy helpers ─────────────────────────────────────────────────────────

const NOTES_PROMPT = (from: number, to: number, hint: string, text: string) => `
You are a study assistant helping a bachelor-level student understand academic material.

Create comprehensive, well-structured study notes from the text below (pages/slides ${from}–${to}).
${hint ? `The student wants to focus on: ${hint}\n` : ""}
Rules:
- Write in plain, simple English — explain as if to someone encountering this topic for the first time
- Keep accuracy and depth appropriate for university level
- Bold every key term the first time it appears
- Use bullet points for lists of facts or steps
- Include a real-world example for any abstract concept
- Do NOT copy sentences verbatim; rewrite in your own words

Use exactly this structure:

## Overview
[2–3 sentences: what is this section about and why it matters]

## Key Concepts
[Each major term/idea as: **Term** — simple definition, then one example if useful]

## Detailed Notes
[Bullet points organized by sub-topic. Nest sub-bullets for supporting details]

## Key Takeaways
[5 crisp bullet points: the most important things to remember]

Document text:
${text.slice(0, 9000)}
`.trim();

async function callZaiStreaming(
  prompt: string,
  token: string,
  signal: AbortSignal,
  onChunk: (chunk: string) => void
): Promise<void> {
  const payload = {
    stream: true,
    model: "GLM-5-Turbo",
    messages: [{ role: "user", content: prompt }],
    chat_id: crypto.randomUUID(),
    current_user_message_id: crypto.randomUUID(),
    current_user_message_parent_id: null,
    extra: {},
    params: {},
    features: {
      image_generation: false,
      web_search: false,
      auto_web_search: false,
      preview_mode: true,
      flags: [],
    },
    background_tasks: { title_generation: false, tags_generation: false },
    variables: {},
  };

  const response = await fetch(`http://localhost:8788?timestamp=${Date.now()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Token": token },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) throw new Error(`Z.ai HTTP ${response.status}`);

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const processLine = (line: string) => {
    if (!line.startsWith("data: ")) return;
    const raw = line.slice(6).trim();
    if (!raw || raw === "[DONE]") return;
    try {
      const evt = JSON.parse(raw);
      const d = evt.data;
      if (!d) return;
      const chunk = d.delta_content || d.edit_content;
      if (chunk && (d.phase === "answer" || d.phase === "other")) onChunk(chunk);
    } catch {}
  };

  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim()) processLine(buffer.trim());
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) processLine(line);
    }
  }
}

async function callDeepaiStreaming(
  prompt: string,
  signal: AbortSignal,
  onChunk: (chunk: string) => void
): Promise<void> {
  const params = new URLSearchParams({
    chat_style: "chat",
    model: "standard",
    session_uuid: crypto.randomUUID(),
    sensitivity_request_id: crypto.randomUUID(),
    hacker_is_stinky: "very_stinky",
    chatHistory: JSON.stringify([{ role: "user", content: prompt }]),
    enabled_tools: JSON.stringify([]),
  });

  const response = await fetch("http://localhost:8787/api", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal,
  });
  if (!response.ok) throw new Error(`DeepAI HTTP ${response.status}`);

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk(decoder.decode(value, { stream: true }));
    }
  }
}

// ── Markdown → HTML ──────────────────────────────────────────────────────────

function inline(t: string): string {
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inUl = false;

  const closeList = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
  };

  for (const line of lines) {
    const t = line.trim();

    if (!t) {
      closeList();
      continue;
    }

    if (t.startsWith("## ")) {
      closeList();
      out.push(`<h2>${inline(t.slice(3))}</h2>`);
    } else if (t.startsWith("### ")) {
      closeList();
      out.push(`<h3>${inline(t.slice(4))}</h3>`);
    } else if (/^[-*•]\s/.test(t)) {
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${inline(t.replace(/^[-*•]\s/, ""))}</li>`);
    } else {
      closeList();
      out.push(`<p>${inline(t)}</p>`);
    }
  }

  closeList();
  return out.join("");
}

// ── Component ────────────────────────────────────────────────────────────────

export function SmartNotesGenerator({
  isOpen,
  onClose,
  activeBlob,
  activeMeta,
  totalPages,
  notesHtml,
  onInsertToNotes,
}: SmartNotesGeneratorProps) {
  const [fromPage, setFromPage] = useState("1");
  const [toPage, setToPage] = useState("10");
  const [hint, setHint] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [extractProgress, setExtractProgress] = useState(0);
  const [streamedText, setStreamedText] = useState("");
  const [error, setError] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // Reset when a new document is opened
  useEffect(() => {
    setPhase("idle");
    setStreamedText("");
    setError("");
    setFromPage("1");
    setToPage(String(Math.min(10, totalPages || 10)));
  }, [activeMeta?.id, totalPages]);

  // Auto-scroll preview as text streams in
  useEffect(() => {
    previewRef.current?.scrollTo({ top: previewRef.current.scrollHeight, behavior: "smooth" });
  }, [streamedText]);

  const validate = (): { from: number; to: number } | null => {
    const from = parseInt(fromPage, 10);
    const to = parseInt(toPage, 10);

    if (isNaN(from) || isNaN(to) || from < 1 || to < from) {
      setError("Enter a valid range (e.g. 1 to 10).");
      return null;
    }
    if (totalPages > 0 && to > totalPages) {
      setError(`This document only has ${totalPages} pages.`);
      return null;
    }
    if (to - from + 1 > 30) {
      setError("Maximum range is 30 pages at a time.");
      return null;
    }
    return { from, to };
  };

  const handleGenerate = async () => {
    setError("");
    setStreamedText("");
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    let rawText = "";
    let fromNum = 1;
    let toNum = 1;

    if (!activeBlob || !activeMeta) {
      // Standalone note — use notesHtml directly
      const stripped = (notesHtml || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!stripped) {
        setError("No note content to generate from. Write some notes first.");
        return;
      }
      rawText = stripped;
      setPhase("generating");
    } else {
      const range = validate();
      if (!range) return;
      fromNum = range.from;
      toNum = range.to;

      // ── Phase 1: Extract ───────────────────────────────────────────────
      setPhase("extracting");
      setExtractProgress(range.from);

      try {
        const onProgress = (p: number) => setExtractProgress(p);
        if (activeMeta.type === "pdf") {
          rawText = await extractPdfRange(activeBlob, range.from, range.to, onProgress);
        } else if (activeMeta.type === "pptx") {
          rawText = await extractPptxRange(activeBlob, range.from, range.to, onProgress);
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError("Failed to extract text from the document.");
        setPhase("idle");
        return;
      }

      if (!rawText.trim()) {
        setError("No extractable text found in those pages.");
        setPhase("idle");
        return;
      }
    }

    // ── Phase 2: Generate ────────────────────────────────────────────────
    setPhase("generating");
    const prompt = NOTES_PROMPT(fromNum, toNum, hint, rawText);
    const token = localStorage.getItem("zai-glm-bearer-token") || "";
    const onChunk = (chunk: string) =>
      setStreamedText((prev) => prev + chunk);

    try {
      if (token) {
        await callZaiStreaming(prompt, token, signal, onChunk);
      } else {
        await callDeepaiStreaming(prompt, signal, onChunk);
      }
      setPhase("done");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      // Z.ai failed → try DeepAI
      try {
        setStreamedText("");
        await callDeepaiStreaming(prompt, signal, onChunk);
        setPhase("done");
      } catch {
        setError("No AI backend reachable. Configure Z.ai token or start the DeepAI proxy.");
        setPhase("idle");
      }
    }
  };

  const handleAddToNotes = () => {
    if (!streamedText) return;
    const label = `Pages ${fromPage}–${toPage}`;
    const html = `
      <div style="border-left:3px solid #6ee7f7;padding-left:14px;margin:20px 0">
        <p><strong>— Smart Notes: ${label} —</strong></p>
        ${markdownToHtml(streamedText)}
      </div>
    `;
    onInsertToNotes(html);
    toast.success("Smart notes added!");
    onClose();
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setPhase("idle");
    setStreamedText("");
  };

  if (!isOpen) return null;

  const pageLabel = activeMeta?.type === "pptx" ? "slide" : "page";
  const isRunning = phase === "extracting" || phase === "generating";
  const totalRange = parseInt(toPage, 10) - parseInt(fromPage, 10) + 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-xl flex flex-col"
        style={{ maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <BookOpenCheck className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Smart Notes Generator</span>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Page range inputs — only shown for documents, not standalone notes */}
          {activeMeta && (
            <div className="space-y-2">
              <label className="text-xs font-medium">
                Extract {pageLabel}s
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <span className="text-xs text-muted-foreground block mb-1">From</span>
                  <input
                    type="number"
                    min={1}
                    max={totalPages || 9999}
                    value={fromPage}
                    onChange={(e) => { setFromPage(e.target.value); setError(""); }}
                    disabled={isRunning}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <span className="text-muted-foreground mt-5">→</span>
                <div className="flex-1">
                  <span className="text-xs text-muted-foreground block mb-1">To</span>
                  <input
                    type="number"
                    min={1}
                    max={totalPages || 9999}
                    value={toPage}
                    onChange={(e) => { setToPage(e.target.value); setError(""); }}
                    disabled={isRunning}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                {totalPages > 0 && (
                  <span className="text-xs text-muted-foreground mt-5 shrink-0">
                    / {totalPages}
                  </span>
                )}
              </div>
            </div>
          )}
          {!activeMeta && (
            <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
              Generating smart notes from your class note content.
            </p>
          )}

          {/* Optional focus hint */}
          <div className="space-y-1">
            <label className="text-xs font-medium">
              Focus area <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="e.g. thermodynamics equations, key definitions…"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              disabled={isRunning}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}

          {/* Progress / status */}
          {phase === "extracting" && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Extracting {pageLabel} {extractProgress} of {toPage}…
                </span>
                <span>{Math.round(((extractProgress - parseInt(fromPage, 10) + 1) / totalRange) * 100)}%</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-200"
                  style={{
                    width: `${Math.round(
                      ((extractProgress - parseInt(fromPage, 10) + 1) / totalRange) * 100
                    )}%`,
                  }}
                />
              </div>
            </div>
          )}

          {phase === "generating" && streamedText === "" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              AI is writing your notes…
            </div>
          )}

          {/* Streaming / final preview */}
          {(phase === "generating" || phase === "done") && streamedText && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium">
                  {phase === "done" ? "Generated notes" : "Generating…"}
                </label>
                {phase === "generating" && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> writing
                  </span>
                )}
              </div>
              <div
                ref={previewRef}
                className="h-64 overflow-y-auto rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed font-mono whitespace-pre-wrap"
              >
                {streamedText}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex gap-2 shrink-0">
          {isRunning ? (
            <Button variant="outline" className="flex-1" size="sm" onClick={handleCancel}>
              Cancel
            </Button>
          ) : (
            <>
              <Button
                className="flex-1"
                size="sm"
                onClick={handleGenerate}
                disabled={!activeBlob || !activeMeta}
              >
                <Sparkles className="h-4 w-4 mr-2" />
                {phase === "done" ? "Regenerate" : "Generate Notes"}
              </Button>
              {phase === "done" && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  onClick={handleAddToNotes}
                >
                  <BookOpenCheck className="h-4 w-4 mr-2" />
                  Add to Notes
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
