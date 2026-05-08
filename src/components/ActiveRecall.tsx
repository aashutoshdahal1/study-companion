import { useState, useCallback } from "react";
import { X, Loader2, Sparkles, FileText, BookOpen, RotateCcw, Brain, ChevronRight, Eye, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface RecallChunk {
  passage: string;
  hint: string;
  keyPoints: string[];
}

interface RecallResult {
  score: number; // 0–100
  feedback: string;
  missed: string[];
}

interface ActiveRecallProps {
  isOpen: boolean;
  onClose: () => void;
  notesHtml: string;
  pageText?: string;
  currentPage?: number;
}

function stripHtml(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent || div.innerText || "").replace(/\s+/g, " ").trim();
}

function parseChunks(text: string): RecallChunk[] {
  const clean = text.trim();
  try {
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  const match = clean.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
  }
  return [];
}

function parseResult(text: string): RecallResult | null {
  const clean = text.trim();
  try {
    const parsed = JSON.parse(clean);
    if (parsed && typeof parsed.score === "number") return parsed;
  } catch {}
  const match = clean.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed && typeof parsed.score === "number") return parsed;
    } catch {}
  }
  return null;
}

const CHUNK_PROMPT = (text: string) =>
  `Split the following study text into 4–6 meaningful sections for active recall practice. Return ONLY a valid JSON array — no markdown fences, no extra text. Each element must have: "passage" (the original text of that section, verbatim), "hint" (a one-sentence topic cue, e.g. "This section covers..."), "keyPoints" (array of 3–5 key facts a student must recall).

Study material:
${text.slice(0, 4000)}`;

const GRADE_PROMPT = (passage: string, keyPoints: string[], attempt: string) =>
  `A student is practicing active recall. Below is the original passage, the key points they should mention, and their recall attempt. Grade their attempt and return ONLY a valid JSON object — no markdown, no extra text — with: "score" (integer 0–100), "feedback" (2–3 sentences of constructive feedback), "missed" (array of key points they forgot or got wrong).

Original passage:
${passage}

Key points to recall:
${keyPoints.map((k, i) => `${i + 1}. ${k}`).join("\n")}

Student's attempt:
${attempt}`;

async function callZaiProxy(prompt: string, token: string, signal: AbortSignal): Promise<string> {
  const payload = {
    stream: true,
    model: "GLM-5-Turbo",
    messages: [{ role: "user", content: prompt }],
    chat_id: crypto.randomUUID(),
    current_user_message_id: crypto.randomUUID(),
    current_user_message_parent_id: null,
    extra: {},
    params: {},
    features: { image_generation: false, web_search: false, auto_web_search: false, preview_mode: true, flags: [] },
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
  let result = "";

  const processLine = (line: string) => {
    if (!line.startsWith("data: ")) return;
    const raw = line.slice(6).trim();
    if (!raw || raw === "[DONE]") return;
    try {
      const evt = JSON.parse(raw);
      const d = evt.data;
      if (!d) return;
      const chunk = d.delta_content || d.edit_content;
      if (chunk && (d.phase === "answer" || d.phase === "other")) result += chunk;
    } catch {}
  };

  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { if (buffer.trim()) processLine(buffer.trim()); break; }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) processLine(line);
    }
  }
  return result;
}

export function ActiveRecall({ isOpen, onClose, notesHtml, pageText, currentPage }: ActiveRecallProps) {
  const [chunks, setChunks] = useState<RecallChunk[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [attempt, setAttempt] = useState("");
  const [result, setResult] = useState<RecallResult | null>(null);
  const [passageVisible, setPassageVisible] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGrading, setIsGrading] = useState(false);
  const [sessionDone, setSessionDone] = useState(false);
  const [scores, setScores] = useState<number[]>([]);
  const [source, setSource] = useState<"notes" | "page">("notes");

  const phase = chunks.length === 0 ? "idle" : sessionDone ? "done" : result ? "graded" : passageVisible ? "read" : "recall";

  const reset = () => {
    setCurrentIndex(0);
    setAttempt("");
    setResult(null);
    setPassageVisible(false);
    setSessionDone(false);
    setScores([]);
  };

  const handleGenerate = useCallback(async () => {
    if (isGenerating) return;
    const rawText = source === "notes" ? stripHtml(notesHtml) : (pageText || "");
    if (!rawText.trim()) {
      toast.error(source === "notes" ? "No notes to generate from." : "No page text — extract page text first.");
      return;
    }

    setIsGenerating(true);
    reset();
    setChunks([]);
    const abort = new AbortController();

    try {
      const token = localStorage.getItem("zai-glm-bearer-token") || "";
      if (!token) throw new Error("Z.ai token not configured. Please add your Z.ai token in chat settings.");

      const responseText = await callZaiProxy(CHUNK_PROMPT(rawText), token, abort.signal);
      const parsed = parseChunks(responseText);
      if (parsed.length === 0) {
        toast.error("Couldn't parse sections from AI response. Try again.");
        return;
      }
      setChunks(parsed);
      toast.success(`Ready — ${parsed.length} sections to recall!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate recall session.");
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, source, notesHtml, pageText]);

  const handleRevealPassage = () => setPassageVisible(true);

  const handleStartRecall = () => {
    setPassageVisible(false);
    setAttempt("");
    setResult(null);
  };

  const handleSubmitAttempt = useCallback(async () => {
    if (!attempt.trim()) {
      toast.error("Write something before submitting.");
      return;
    }
    const chunk = chunks[currentIndex];
    setIsGrading(true);
    const abort = new AbortController();

    try {
      const token = localStorage.getItem("zai-glm-bearer-token") || "";
      if (!token) throw new Error("Z.ai token not configured.");

      const responseText = await callZaiProxy(
        GRADE_PROMPT(chunk.passage, chunk.keyPoints, attempt),
        token,
        abort.signal
      );
      const parsed = parseResult(responseText);
      if (!parsed) {
        toast.error("Couldn't parse grading response. Try again.");
        return;
      }
      setResult(parsed);
      setScores((s) => [...s, parsed.score]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to grade response.");
    } finally {
      setIsGrading(false);
    }
  }, [attempt, chunks, currentIndex]);

  const handleNext = () => {
    if (currentIndex >= chunks.length - 1) {
      setSessionDone(true);
    } else {
      setCurrentIndex((i) => i + 1);
      setAttempt("");
      setResult(null);
      setPassageVisible(false);
    }
  };

  if (!isOpen) return null;

  const chunk = chunks[currentIndex];
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const progressPct = chunks.length > 0
    ? ((currentIndex + (result ? 1 : 0)) / chunks.length) * 100
    : 0;

  const scoreColor = (s: number) =>
    s >= 80 ? "text-green-500" : s >= 55 ? "text-yellow-500" : "text-red-400";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-lg flex flex-col"
        style={{ maxHeight: "92vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Active Recall</span>
            {phase !== "idle" && phase !== "done" && (
              <span className="text-xs text-muted-foreground">
                {currentIndex + 1} / {chunks.length}
              </span>
            )}
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-muted shrink-0">
          <div
            className="h-1 bg-primary transition-all duration-300"
            style={{ width: `${phase === "done" ? 100 : progressPct}%` }}
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Idle */}
          {phase === "idle" && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-8 text-muted-foreground">
              <Brain className="h-10 w-10 opacity-25" />
              <p className="text-sm font-medium">Active Recall Practice</p>
              <p className="text-xs leading-relaxed max-w-xs">
                Read a section, then hide it and try to recall the key points in your own words.
                AI grades your response and highlights what you missed.
              </p>
            </div>
          )}

          {/* Done */}
          {phase === "done" && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-8">
              <div className={`text-5xl font-bold ${scoreColor(avgScore)}`}>{avgScore}%</div>
              <p className="text-sm text-muted-foreground font-medium">Average recall score</p>
              <div className="flex gap-1 flex-wrap justify-center">
                {scores.map((s, i) => (
                  <span
                    key={i}
                    className={`text-xs px-2 py-0.5 rounded-full border ${scoreColor(s)} border-current`}
                  >
                    §{i + 1}: {s}%
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {avgScore >= 80
                  ? "Excellent retention! You're ready to move on."
                  : avgScore >= 55
                  ? "Good effort. Review the sections you missed."
                  : "Keep practicing — re-read and try again."}
              </p>
              <Button variant="outline" size="sm" className="text-xs mt-1" onClick={reset}>
                <RotateCcw className="h-3 w-3 mr-1.5" /> Practice again
              </Button>
            </div>
          )}

          {/* Read phase — show the passage */}
          {phase === "read" && chunk && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Read this section</p>
              <div className="bg-muted/50 border border-border rounded-lg p-4 text-sm leading-relaxed text-foreground">
                {chunk.passage}
              </div>
              <div className="text-xs text-muted-foreground bg-primary/5 border border-primary/20 rounded-lg p-3">
                <span className="font-semibold text-primary">Key points to remember:</span>
                <ul className="mt-1.5 space-y-1 list-disc list-inside">
                  {chunk.keyPoints.map((kp, i) => <li key={i}>{kp}</li>)}
                </ul>
              </div>
            </div>
          )}

          {/* Recall phase — passage hidden */}
          {phase === "recall" && chunk && (
            <div className="space-y-3">
              <div className="bg-muted/30 border border-dashed border-border rounded-lg p-3 text-xs text-muted-foreground text-center">
                <Eye className="h-4 w-4 mx-auto mb-1 opacity-40" />
                <span className="font-medium">Topic hint:</span> {chunk.hint}
              </div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                Recall — write what you remember
              </p>
              <Textarea
                placeholder="In your own words, write everything you can recall about this section…"
                value={attempt}
                onChange={(e) => setAttempt(e.target.value)}
                className="min-h-[140px] text-sm resize-none"
                disabled={isGrading}
              />
            </div>
          )}

          {/* Graded phase */}
          {phase === "graded" && chunk && result && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className={`text-2xl font-bold ${scoreColor(result.score)}`}>{result.score}%</span>
                <span className="text-xs text-muted-foreground">recall score</span>
              </div>

              <div className="text-sm text-foreground bg-muted/40 border border-border rounded-lg p-3 leading-relaxed">
                {result.feedback}
              </div>

              {result.missed.length > 0 && (
                <div className="text-xs border border-yellow-400/40 bg-yellow-400/5 rounded-lg p-3 space-y-1">
                  <p className="font-semibold text-yellow-600 dark:text-yellow-400">Points you missed:</p>
                  <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                    {result.missed.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                </div>
              )}

              {result.missed.length === 0 && (
                <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400 bg-green-500/5 border border-green-500/20 rounded-lg p-3">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  You covered all the key points!
                </div>
              )}

              <div className="bg-muted/30 border border-dashed border-border rounded-lg p-3">
                <p className="text-xs text-muted-foreground font-medium mb-1">Original passage</p>
                <p className="text-xs leading-relaxed text-foreground">{chunk.passage}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border space-y-2 shrink-0">
          {/* Source + generate */}
          {phase === "idle" && (
            <>
              <div className="flex gap-2">
                <Button
                  variant={source === "notes" ? "default" : "outline"}
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={() => setSource("notes")}
                >
                  <FileText className="h-3 w-3 mr-1.5" /> From Notes
                </Button>
                <Button
                  variant={source === "page" ? "default" : "outline"}
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={() => setSource("page")}
                  disabled={!pageText}
                  title={!pageText ? "Extract page text first" : undefined}
                >
                  <BookOpen className="h-3 w-3 mr-1.5" />
                  {pageText ? `Page ${currentPage ?? ""}` : "Page (extract first)"}
                </Button>
              </div>
              <Button className="w-full" size="sm" onClick={handleGenerate} disabled={isGenerating}>
                {isGenerating ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
                ) : (
                  <><Brain className="h-4 w-4 mr-2" /> Start Recall Session</>
                )}
              </Button>
            </>
          )}

          {/* Read phase controls */}
          {phase === "read" && (
            <Button className="w-full" size="sm" onClick={handleStartRecall}>
              <Brain className="h-4 w-4 mr-2" /> Hide & Recall
            </Button>
          )}

          {/* Recall phase controls */}
          {phase === "recall" && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={handleRevealPassage}
              >
                <Eye className="h-3 w-3 mr-1.5" /> Peek
              </Button>
              <Button
                className="flex-1"
                size="sm"
                onClick={handleSubmitAttempt}
                disabled={isGrading || !attempt.trim()}
              >
                {isGrading ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Grading…</>
                ) : (
                  <><Sparkles className="h-4 w-4 mr-2" /> Submit & Grade</>
                )}
              </Button>
            </div>
          )}

          {/* Graded controls */}
          {phase === "graded" && (
            <Button className="w-full" size="sm" onClick={handleNext}>
              {currentIndex >= chunks.length - 1 ? "See Results" : "Next Section"}
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}

          {/* Done controls */}
          {phase === "done" && (
            <Button className="w-full" size="sm" onClick={handleGenerate} disabled={isGenerating}>
              {isGenerating ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
              ) : (
                <><Brain className="h-4 w-4 mr-2" /> New Session</>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
