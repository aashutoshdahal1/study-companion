import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, X, Languages, Copy, Check, ClipboardPaste, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface VoiceNotesProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertToNotes: (html: string) => void;
}

type Lang = "ne-NP" | "en-US" | "ne-NP en-US";

const LANG_OPTIONS: { value: Lang; label: string; short: string }[] = [
  { value: "ne-NP", label: "Nepali", short: "NP" },
  { value: "en-US", label: "English", short: "EN" },
  { value: "ne-NP en-US", label: "Mixed", short: "NP+EN" },
];

// Chrome Web Speech API sends audio to Google servers.
// ne-NP is poorly supported server-side and often returns "network" error.
// Strategy: on network error, auto-fallback to en-US and warn the user.
const NETWORK_ERROR_FALLBACK: Lang = "en-US";
const MAX_NETWORK_RETRIES = 2;

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

export function VoiceNotes({ isOpen, onClose, onInsertToNotes }: VoiceNotesProps) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [lang, setLang] = useState<Lang>("ne-NP en-US");
  const [activeLang, setActiveLang] = useState<Lang>("ne-NP en-US"); // actual lang in use (may differ after fallback)
  const [supported, setSupported] = useState(true);
  const [copied, setCopied] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const transcriptRef = useRef("");
  const isListeningRef = useRef(false); // ref so onend closure always sees latest value
  const networkRetriesRef = useRef(0);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) setSupported(false);
  }, []);

  useEffect(() => {
    if (!isOpen) stopListening();
  }, [isOpen]);

  // Keep ref in sync with state so closures inside recognition callbacks see
  // the latest value without needing to re-register handlers.
  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  function getLangCode(selected: Lang): string {
    // ne-NP mixed → try ne-NP first; fallback logic handles network errors
    if (selected === "ne-NP en-US") return "ne-NP";
    return selected;
  }

  function buildRecognition(langCode: string): SpeechRecognition | null {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const r = new SR();
    r.lang = langCode;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    return r;
  }

  function startListening(overrideLang?: Lang) {
    const chosenLang = overrideLang ?? lang;
    const langCode = getLangCode(chosenLang);
    const r = buildRecognition(langCode);
    if (!r) return;

    r.onresult = (e: SpeechRecognitionEvent) => {
      // Got a result — network is working, reset retry counter
      networkRetriesRef.current = 0;
      setNetworkError(false);

      let interimText = "";
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalText += text + " ";
        } else {
          interimText += text;
        }
      }
      if (finalText) {
        transcriptRef.current += finalText;
        setTranscript(transcriptRef.current);
      }
      setInterim(interimText);
    };

    r.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error === "not-allowed") {
        toast.error("Microphone permission denied. Please allow mic access in browser settings.");
        stopListening();
        return;
      }

      if (e.error === "network") {
        networkRetriesRef.current += 1;

        if (networkRetriesRef.current <= MAX_NETWORK_RETRIES && chosenLang !== NETWORK_ERROR_FALLBACK) {
          // Retry same language once before falling back
          return; // onend will restart
        }

        // After retries exhausted, fall back to en-US
        if (chosenLang !== NETWORK_ERROR_FALLBACK) {
          setNetworkError(true);
          setActiveLang(NETWORK_ERROR_FALLBACK);
          toast.warning(
            "Nepali speech recognition unavailable (Google server issue). Switched to English. You can still type Nepali manually.",
            { duration: 6000 }
          );
          // Restart with English
          stopListeningInternal(r);
          networkRetriesRef.current = 0;
          startListening(NETWORK_ERROR_FALLBACK);
        } else {
          // Already on en-US and still getting network error
          setNetworkError(true);
          toast.error("Speech recognition network error. Check your internet connection and try again.");
          stopListening();
        }
        return;
      }

      if (e.error === "aborted" || e.error === "no-speech") return; // non-fatal, onend restarts
      toast.error(`Speech error: ${e.error}`);
    };

    r.onend = () => {
      // Auto-restart if we're still supposed to be listening
      if (recognitionRef.current === r && isListeningRef.current) {
        try { r.start(); } catch { /* already restarting elsewhere */ }
      }
    };

    recognitionRef.current = r;
    setActiveLang(chosenLang);
    try {
      r.start();
      setIsListening(true);
      isListeningRef.current = true;
    } catch {
      toast.error("Could not start speech recognition. Try refreshing the page.");
    }
  }

  function stopListeningInternal(r: SpeechRecognition) {
    r.onend = null;
    try { r.stop(); } catch {}
  }

  function stopListening() {
    if (recognitionRef.current) {
      stopListeningInternal(recognitionRef.current);
      recognitionRef.current = null;
    }
    setIsListening(false);
    isListeningRef.current = false;
    setInterim("");
    networkRetriesRef.current = 0;
  }

  function toggleListening() {
    if (isListening) {
      stopListening();
    } else {
      setNetworkError(false);
      startListening();
    }
  }

  function handleLangChange(newLang: Lang) {
    const wasListening = isListening;
    if (wasListening) stopListening();
    setLang(newLang);
    setActiveLang(newLang);
    setNetworkError(false);
    if (wasListening) {
      setTimeout(() => startListening(newLang), 150);
    }
  }

  function handleInsert() {
    const text = (transcriptRef.current + interim).trim();
    if (!text) return;
    const timestamp = new Date().toLocaleString();
    const html =
      `<p><strong>— Voice Notes (${timestamp}) —</strong></p>` +
      text
        .split(/\n+/)
        .filter(Boolean)
        .map((line) => `<p>${line}</p>`)
        .join("") +
      `<hr>`;
    onInsertToNotes(html);
    toast.success("Voice notes inserted!");
    setTranscript("");
    transcriptRef.current = "";
    setInterim("");
  }

  function handleClear() {
    setTranscript("");
    transcriptRef.current = "";
    setInterim("");
  }

  async function handleCopy() {
    const text = (transcriptRef.current + interim).trim();
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!isOpen) return null;

  const fullText = transcript + interim;
  const showFallbackBanner = networkError && activeLang === NETWORK_ERROR_FALLBACK && lang !== NETWORK_ERROR_FALLBACK;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-xl border border-border bg-background shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-toolbar">
          <div className="flex items-center gap-2">
            <Mic className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Voice Notes</span>
            {isListening && (
              <span className="flex items-center gap-1 text-xs text-red-500">
                <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                Recording
              </span>
            )}
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Language toggle */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
          <Languages className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground mr-1">Language:</span>
          <div className="flex gap-1">
            {LANG_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleLangChange(opt.value)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  lang === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
              >
                {opt.short}
              </button>
            ))}
          </div>
          {activeLang !== lang && (
            <span className="ml-auto text-xs text-amber-500 font-medium">using EN fallback</span>
          )}
        </div>

        {/* Browser not supported */}
        {!supported && (
          <div className="px-4 py-3 text-sm text-destructive bg-destructive/10">
            Speech recognition requires Chrome or Edge browser.
          </div>
        )}

        {/* Network fallback banner */}
        {showFallbackBanner && (
          <div className="flex items-start gap-2 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Nepali speech recognition is unavailable (Google server issue — common for ne-NP).
              Recording in English. You can type Nepali words directly in the text area.
            </span>
          </div>
        )}

        {/* Transcript area — editable so user can type Nepali words manually */}
        <div className="relative min-h-[160px] max-h-[300px] flex flex-col">
          <textarea
            className="flex-1 min-h-[160px] max-h-[300px] resize-none px-4 py-3 text-sm leading-relaxed bg-transparent outline-none placeholder:text-muted-foreground placeholder:italic"
            placeholder={isListening ? "Listening… speak now (you can also type here)" : "Press Start to record, or just type here"}
            value={fullText}
            onChange={(e) => {
              transcriptRef.current = e.target.value;
              setTranscript(e.target.value);
              setInterim("");
            }}
          />
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-border bg-toolbar">
          <Button
            variant={isListening ? "destructive" : "default"}
            size="sm"
            onClick={toggleListening}
            disabled={!supported}
            className="gap-1.5"
          >
            {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {isListening ? "Stop" : "Start"}
          </Button>

          <Button variant="outline" size="sm" onClick={handleCopy} disabled={!fullText} className="gap-1.5">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>

          <Button variant="outline" size="sm" onClick={handleClear} disabled={!fullText}>
            Clear
          </Button>

          <Button size="sm" onClick={handleInsert} disabled={!fullText} className="ml-auto gap-1.5">
            <ClipboardPaste className="h-4 w-4" />
            Insert to Notes
          </Button>
        </div>
      </div>
    </div>
  );
}
