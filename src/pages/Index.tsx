import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThemeProvider } from "next-themes";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import jsPDF from "jspdf";
import { BookOpen, Download, FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DocSidebar } from "@/components/DocSidebar";
import { PdfViewer } from "@/components/PdfViewer";
import { NotesEditor } from "@/components/NotesEditor";
import { storage, type DocMeta } from "@/lib/storage";

function StudyApp() {
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeBlob, setActiveBlob] = useState<Blob | null>(null);
  const [activeMeta, setActiveMeta] = useState<DocMeta | null>(null);
  const [page, setPage] = useState(1);
  const [notesHtml, setNotesHtml] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const editorRef = useRef<{ insertPageTag: () => void } | null>(null);

  // Load docs on mount
  useEffect(() => {
    storage.listDocs().then((d) => {
      setDocs(d);
      if (d[0]) setActiveId(d[0].id);
    });
  }, []);

  // Load active doc + notes
  useEffect(() => {
    if (!activeId) {
      setActiveBlob(null);
      setActiveMeta(null);
      setNotesHtml("");
      return;
    }
    setLoading(true);
    Promise.all([storage.getBlob(activeId), storage.getNote(activeId), storage.listDocs()]).then(
      ([blob, note, all]) => {
        const meta = all.find((m) => m.id === activeId) || null;
        setActiveBlob(blob || null);
        setActiveMeta(meta);
        setNotesHtml(note?.html || "");
        setPage(meta?.lastPage || 1);
        setLoading(false);
      }
    );
  }, [activeId]);

  // Auto-save notes (debounced)
  useEffect(() => {
    if (!activeId) return;
    const t = setTimeout(() => {
      storage
        .saveNote({ docId: activeId, html: notesHtml, perPage: {}, updatedAt: Date.now() })
        .then(() => setSavedAt(Date.now()));
    }, 600);
    return () => clearTimeout(t);
  }, [notesHtml, activeId]);

  // Persist last page
  useEffect(() => {
    if (!activeMeta) return;
    const updated = { ...activeMeta, lastPage: page };
    storage.updateDoc(updated);
  }, [page, activeMeta]);

  const handleUpload = useCallback(async (file: File) => {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Only PDF files are supported right now.");
      return;
    }
    const meta: DocMeta = {
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      addedAt: Date.now(),
      lastPage: 1,
    };
    await storage.addDoc(meta, file);
    const all = await storage.listDocs();
    setDocs(all);
    setActiveId(meta.id);
    toast.success(`Loaded ${file.name}`);
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      await storage.deleteDoc(id);
      const all = await storage.listDocs();
      setDocs(all);
      if (activeId === id) setActiveId(all[0]?.id || null);
    },
    [activeId]
  );

  const insertPageTag = useCallback(() => {
    // Append a tag at end of notes; lightweight approach
    const tag = `<p><strong>— Page ${page} —</strong></p>`;
    setNotesHtml((h) => (h ? h + tag : tag));
    toast(`Tagged page ${page}`);
  }, [page]);

  const downloadAsText = () => {
    if (!activeMeta) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = notesHtml;
    const text = tmp.innerText || "";
    const blob = new Blob([text], { type: "text/plain" });
    triggerDownload(blob, `${stripExt(activeMeta.name)} — notes.txt`);
  };

  const downloadAsPdf = () => {
    if (!activeMeta) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = notesHtml;
    const text = tmp.innerText || "";
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(`Notes — ${activeMeta.name}`, 48, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    const lines = doc.splitTextToSize(text || "(empty)", 500);
    doc.text(lines, 48, 90);
    doc.save(`${stripExt(activeMeta.name)} — notes.pdf`);
  };

  const savedLabel = useMemo(() => {
    if (!savedAt) return "";
    const s = Math.round((Date.now() - savedAt) / 1000);
    return s < 5 ? "Saved" : `Saved ${s}s ago`;
  }, [savedAt, notesHtml]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-toolbar px-3">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-primary/10 text-primary flex items-center justify-center">
            <BookOpen className="h-4 w-4" />
          </div>
          <h1 className="text-sm font-semibold tracking-tight">StudySync</h1>
          {activeMeta && (
            <span className="ml-3 text-xs text-muted-foreground truncate max-w-[40ch]">
              {activeMeta.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {activeMeta && (
            <span className="text-xs text-muted-foreground mr-1">{savedLabel}</span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" disabled={!activeMeta}>
                <Download className="h-4 w-4 mr-1.5" /> Export notes
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={downloadAsPdf}>
                <FileDown className="h-4 w-4 mr-2" /> Download PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={downloadAsText}>
                <FileDown className="h-4 w-4 mr-2" /> Download .txt
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <DocSidebar
          docs={docs}
          activeId={activeId}
          onSelect={setActiveId}
          onUpload={handleUpload}
          onDelete={handleDelete}
        />
        <main className="flex-1 min-w-0">
          {loading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading…
            </div>
          ) : (
            <PanelGroup direction="horizontal" className="h-full">
              <Panel defaultSize={55} minSize={30} className="bg-surface">
                <PdfViewer file={activeBlob} page={page} onPageChange={setPage} />
              </Panel>
              <PanelResizeHandle className="w-1.5 bg-border hover:bg-primary/40 transition-colors" />
              <Panel defaultSize={45} minSize={25} className="bg-card">
                <NotesEditor value={notesHtml} onChange={setNotesHtml} onInsertPageTag={activeMeta ? insertPageTag : undefined} />
              </Panel>
            </PanelGroup>
          )}
        </main>
      </div>
    </div>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function stripExt(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

const Index = () => (
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
    <StudyApp />
  </ThemeProvider>
);

export default Index;
