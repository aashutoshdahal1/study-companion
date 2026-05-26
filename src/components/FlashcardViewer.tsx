import { useState, useEffect, useCallback } from "react";
import { X, ChevronLeft, ChevronRight, Loader2, Sparkles, RotateCcw, FileText, BookOpen, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { storage } from "@/lib/storage";

type Flashcard = { question: string; answer: string };
import { toast } from "sonner";

interface FlashcardViewerProps {
  isOpen: boolean;
  onClose: () => void;
  docId: string | null;
  notesHtml: string;
  pageText?: string;
  currentPage?: number;
}

function stripHtml(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent || div.innerText || "").replace(/\s+/g, " ").trim();
}

function parseFlashcardsFromResponse(text: string): Flashcard[] {
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

const CHUNK_SIZE = 3000;

function splitIntoChunks(text: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    const chunk = text.slice(i, i + CHUNK_SIZE).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

const FLASHCARD_PROMPT = (text: string) => {
  const count = Math.min(12, Math.max(5, Math.floor(text.length / 250)));
  return `Generate ${count} study flashcards from the following text. Return ONLY a valid JSON array — no markdown code fences, no explanation, nothing else. Each element must have exactly two string fields: "question" and "answer".

Example of the exact format to return:
[{"question":"What is X?","answer":"X is Y"},{"question":"Define Z","answer":"Z means W"}]

Study material:
${text}`;
};

async function callGroq(prompt: string, signal: AbortSignal): Promise<string> {
  const apiKey = localStorage.getItem("groq-api-key") || "";
  const model = localStorage.getItem("groq-model") || "llama-3.3-70b-versatile";
  if (!apiKey) throw new Error("Groq API key not configured. Add your key in Chat Settings.");

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.4 }),
    signal,
  });
  if (!response.ok) throw new Error(`Groq HTTP ${response.status}`);
  const json = await response.json();
  return json.choices?.[0]?.message?.content ?? "";
}

export function FlashcardViewer({ isOpen, onClose, docId, notesHtml, pageText, currentPage }: FlashcardViewerProps) {
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [source, setSource] = useState<"notes" | "page">("notes");

  useEffect(() => {
    if (!docId || !isOpen) return;
    storage.getDeck(docId).then((deck) => {
      if (deck && deck.cards.length > 0) {
        setCards(deck.cards.map((c) => ({ question: c.front, answer: c.back })));
        setCurrentIndex(0);
        setIsFlipped(false);
      } else {
        setCards([]);
      }
    });
  }, [docId, isOpen]);

  const handleGenerate = useCallback(async () => {
    const rawText = source === "notes" ? stripHtml(notesHtml) : (pageText || "");
    if (!rawText.trim()) {
      toast.error(
        source === "notes"
          ? "No notes to generate from. Write some notes first."
          : "No page text — extract page text first using the button in the document viewer."
      );
      return;
    }

    setIsGenerating(true);
    const abort = new AbortController();

    try {
      const chunks = splitIntoChunks(rawText);

      toast.info(`Processing ${chunks.length} section${chunks.length > 1 ? "s" : ""}…`);

      const results = await Promise.all(
        chunks.map(async (chunk) => {
          const responseText = await callGroq(FLASHCARD_PROMPT(chunk), abort.signal);
          return parseFlashcardsFromResponse(responseText);
        })
      );

      const allCards = results.flat();

      if (allCards.length === 0) {
        toast.error("Couldn't generate flashcards. Check your AI token in chat settings.");
        return;
      }

      // Deduplicate by question text
      const seen = new Set<string>();
      const unique = allCards.filter((c) => {
        const key = c.question.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      setCards(unique);
      setCurrentIndex(0);
      setIsFlipped(false);
      const deckId = docId ?? `standalone-${btoa(rawText.slice(0, 64)).replace(/[^a-zA-Z0-9]/g, '')}`;
      await storage.saveDeck({
        docId: deckId,
        cards: unique.map((c, i) => ({ front: c.question, back: c.answer, id: String(i) })),
        updatedAt: Date.now(),
      });
      toast.success(`Generated ${unique.length} flashcards covering all topics!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate flashcards.");
    } finally {
      setIsGenerating(false);
    }
  }, [docId, source, notesHtml, pageText]); // docId kept for optional saveDeck

  const goNext = useCallback(() => {
    setIsFlipped(false);
    setCurrentIndex((i) => Math.min(i + 1, cards.length - 1));
  }, [cards.length]);

  const goPrev = useCallback(() => {
    setIsFlipped(false);
    setCurrentIndex((i) => Math.max(i - 1, 0));
  }, []);

  const handleShuffle = useCallback(() => {
    setCards((prev) => [...prev].sort(() => Math.random() - 0.5));
    setCurrentIndex(0);
    setIsFlipped(false);
  }, []);

  const handleReset = useCallback(() => {
    setCurrentIndex(0);
    setIsFlipped(false);
  }, []);

  if (!isOpen) return null;

  const currentCard = cards[currentIndex];
  const progress = cards.length > 0 ? ((currentIndex + 1) / cards.length) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: "90vh" }}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Flashcards</span>
            {cards.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {currentIndex + 1} / {cards.length}
              </span>
            )}
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Progress bar */}
        {cards.length > 0 && (
          <div className="h-1 bg-muted shrink-0">
            <div className="h-1 bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        )}

        {/* Card area */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-5 overflow-hidden">
          {cards.length === 0 ? (
            <div className="text-center text-muted-foreground space-y-3">
              <BookOpen className="h-10 w-10 mx-auto opacity-25" />
              <p className="text-sm font-medium">No flashcards yet</p>
              <p className="text-xs">Choose a source below and click Generate.</p>
            </div>
          ) : (
            <>
              {/* Flip card */}
              <div
                className="w-full cursor-pointer select-none"
                style={{ perspective: "1000px", height: "200px" }}
                onClick={() => setIsFlipped((f) => !f)}
              >
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                    height: "100%",
                    transformStyle: "preserve-3d",
                    transition: "transform 0.4s ease",
                    transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
                  }}
                >
                  {/* Front — Question */}
                  <div
                    style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
                    className="bg-primary/5 border-2 border-primary/20 rounded-xl flex flex-col items-center justify-center p-6 text-center gap-3"
                  >
                    <span className="text-[10px] font-semibold text-primary/50 uppercase tracking-widest">Question</span>
                    <p className="text-sm font-medium leading-relaxed">{currentCard?.question}</p>
                    <span className="text-[10px] text-muted-foreground">Click to flip</span>
                  </div>
                  {/* Back — Answer */}
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      backfaceVisibility: "hidden",
                      WebkitBackfaceVisibility: "hidden",
                      transform: "rotateY(180deg)",
                    }}
                    className="bg-card border-2 border-border rounded-xl flex flex-col items-center justify-center p-6 text-center gap-3"
                  >
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Answer</span>
                    <p className="text-sm leading-relaxed">{currentCard?.answer}</p>
                  </div>
                </div>
              </div>

              {/* Navigation */}
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={goPrev} disabled={currentIndex === 0}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" className="text-xs h-8 px-2" onClick={handleReset}>
                  <RotateCcw className="h-3 w-3 mr-1" /> Restart
                </Button>
                <Button variant="ghost" size="sm" className="text-xs h-8 px-2" onClick={handleShuffle}>
                  <Shuffle className="h-3 w-3 mr-1" /> Shuffle
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={goNext} disabled={currentIndex === cards.length - 1}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Generate section */}
        <div className="p-4 border-t border-border space-y-3 shrink-0">
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
              title={!pageText ? "Extract page text first using the button in the viewer" : undefined}
            >
              <BookOpen className="h-3 w-3 mr-1.5" />
              {pageText ? `Page ${currentPage ?? ""}` : "Page (extract first)"}
            </Button>
          </div>
          <Button className="w-full" size="sm" onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-2" /> {cards.length > 0 ? "Regenerate" : "Generate"} Flashcards</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
