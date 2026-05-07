import { useState, useCallback } from "react";
import { X, ChevronRight, Loader2, Sparkles, FileText, BookOpen, RotateCcw, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface Question {
  question: string;
  options: string[];
  answer: number;
  explanation: string;
}

interface QuizViewerProps {
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

function parseQuestions(text: string): Question[] {
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

const QUIZ_PROMPT = (text: string) =>
  `Generate 8 multiple-choice questions to test understanding of the following text. Return ONLY a valid JSON array — no markdown fences, no extra text. Each element must have: "question" (string), "options" (array of exactly 4 strings), "answer" (integer 0-3, index of the correct option), "explanation" (one sentence explaining why).

Example:
[{"question":"What is photosynthesis?","options":["Light to sugar","Heat to motion","Sound to electricity","Water to ice"],"answer":0,"explanation":"Photosynthesis converts light energy into chemical energy stored as sugar."}]

Study material:
${text.slice(0, 3000)}`;

async function callZaiProxy(text: string, token: string, signal: AbortSignal): Promise<string> {
  const payload = {
    stream: true,
    model: "GLM-5-Turbo",
    messages: [{ role: "user", content: QUIZ_PROMPT(text) }],
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

export function QuizViewer({ isOpen, onClose, notesHtml, pageText, currentPage }: QuizViewerProps) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [quizDone, setQuizDone] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [source, setSource] = useState<"notes" | "page">("notes");

  const phase = questions.length === 0 ? "idle" : quizDone ? "done" : "active";

  const resetQuiz = () => {
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setRevealed(false);
    setScore(0);
    setQuizDone(false);
  };

  const handleGenerate = useCallback(async () => {
    if (isGenerating) return;

    const rawText = source === "notes" ? stripHtml(notesHtml) : (pageText || "");
    if (!rawText.trim()) {
      toast.error(source === "notes" ? "No notes to generate from." : "No page text — extract page text first.");
      return;
    }

    setIsGenerating(true);
    resetQuiz();
    setQuestions([]);
    const abort = new AbortController();

    try {
      const token = localStorage.getItem("zai-glm-bearer-token") || "";
      let responseText = "";

      if (token) {
        try { 
          responseText = await callZaiProxy(rawText, token, abort.signal); 
        } catch (error) {
          console.error("Quiz - Z.ai proxy error:", error);
        }
      }

      if (!responseText) {
        throw new Error("Z.ai token not configured. Please add your Z.ai token in chat settings.");
      }

      const parsed = parseQuestions(responseText);
      if (parsed.length === 0) {
        toast.error("Couldn't parse questions from AI response. Try again.");
        return;
      }

      setQuestions(parsed);
      toast.success(`Generated ${parsed.length} questions!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate quiz.");
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, source, notesHtml, pageText]);

  const handleSelectAnswer = (optionIndex: number) => {
    if (revealed) return;
    setSelectedAnswer(optionIndex);
    setRevealed(true);
    if (optionIndex === questions[currentIndex].answer) {
      setScore((s) => s + 1);
    }
  };

  const handleNext = () => {
    if (currentIndex >= questions.length - 1) {
      setQuizDone(true);
    } else {
      setCurrentIndex((i) => i + 1);
      setSelectedAnswer(null);
      setRevealed(false);
    }
  };

  if (!isOpen) return null;

  const currentQ = questions[currentIndex];
  const progressPct =
    phase === "active"
      ? ((currentIndex + (revealed ? 1 : 0)) / questions.length) * 100
      : phase === "done"
      ? 100
      : 0;

  const scorePercent = questions.length > 0 ? score / questions.length : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-lg flex flex-col"
        style={{ maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Quiz Mode</span>
            {phase === "active" && (
              <span className="text-xs text-muted-foreground">
                {currentIndex + 1} / {questions.length}
              </span>
            )}
            {phase === "done" && (
              <span className="text-xs text-muted-foreground">
                {score} / {questions.length} correct
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
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {phase === "idle" && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-8 text-muted-foreground">
              <Sparkles className="h-10 w-10 opacity-25" />
              <p className="text-sm font-medium">No quiz yet</p>
              <p className="text-xs">Choose a source below and click Generate.</p>
            </div>
          )}

          {phase === "done" && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-8">
              <div
                className={`text-5xl font-bold ${
                  scorePercent === 1
                    ? "text-green-500"
                    : scorePercent >= 0.7
                    ? "text-primary"
                    : "text-yellow-500"
                }`}
              >
                {score}/{questions.length}
              </div>
              <p className="text-sm text-muted-foreground">
                {scorePercent === 1
                  ? "Perfect! You nailed it."
                  : scorePercent >= 0.7
                  ? "Good work — keep it up!"
                  : "Keep studying — you'll get there."}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="text-xs mt-1"
                onClick={resetQuiz}
              >
                <RotateCcw className="h-3 w-3 mr-1.5" /> Retry same questions
              </Button>
            </div>
          )}

          {phase === "active" && currentQ && (
            <div className="space-y-4">
              <p className="font-medium text-sm leading-relaxed">{currentQ.question}</p>

              <div className="space-y-2">
                {currentQ.options.map((opt, i) => {
                  const isCorrect = i === currentQ.answer;
                  const isSelected = i === selectedAnswer;
                  let extra = "justify-start text-left h-auto py-2.5 px-3 whitespace-normal";
                  if (revealed) {
                    if (isCorrect)
                      extra +=
                        " border-green-500 bg-green-500/10 text-green-700 dark:text-green-400";
                    else if (isSelected)
                      extra +=
                        " border-red-400 bg-red-400/10 text-red-700 dark:text-red-400";
                    else extra += " opacity-40";
                  }

                  return (
                    <Button
                      key={i}
                      variant="outline"
                      className={`w-full ${extra}`}
                      onClick={() => handleSelectAnswer(i)}
                      disabled={revealed}
                    >
                      <span className="shrink-0 font-semibold mr-2 text-xs w-4">
                        {String.fromCharCode(65 + i)}.
                      </span>
                      <span className="text-xs flex-1">{opt}</span>
                      {revealed && isCorrect && (
                        <CheckCircle2 className="h-4 w-4 ml-2 shrink-0 text-green-500" />
                      )}
                      {revealed && isSelected && !isCorrect && (
                        <XCircle className="h-4 w-4 ml-2 shrink-0 text-red-400" />
                      )}
                    </Button>
                  );
                })}
              </div>

              {revealed && (
                <div className="text-xs text-muted-foreground bg-muted rounded-lg p-3 border border-border leading-relaxed">
                  <span className="font-semibold text-foreground">Why: </span>
                  {currentQ.explanation}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border space-y-2 shrink-0">
          {/* Source + generate — shown when idle or done */}
          {(phase === "idle" || phase === "done") && (
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
              <Button
                className="w-full"
                size="sm"
                onClick={handleGenerate}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    {phase === "done" ? "New Quiz" : "Generate Quiz"}
                  </>
                )}
              </Button>
            </>
          )}

          {/* Active quiz controls */}
          {phase === "active" && revealed && (
            <Button className="w-full" size="sm" onClick={handleNext}>
              {currentIndex >= questions.length - 1 ? "See Results" : "Next Question"}
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
          {phase === "active" && !revealed && (
            <p className="text-center text-xs text-muted-foreground py-1">
              Select an answer above
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
