import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThemeProvider } from "next-themes";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import JSZip from "jszip";
import { pdfjs } from "react-pdf";
import { BookOpen, Download, FileDown, Layers, Loader2, PanelLeft, PanelRight, Sparkles } from "lucide-react";
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
import { PptxViewer, type PptxViewerHandle } from "@/components/PptxViewer";
import { NotesEditor } from "@/components/NotesEditor";
import { ChatAI } from "@/components/ChatAI";
import { FlashcardViewer } from "@/components/FlashcardViewer";
import { QuizViewer } from "@/components/QuizViewer";
import { SmartNotesGenerator } from "@/components/SmartNotesGenerator";
import { storage, type DocMeta, type Workspace } from "@/lib/storage";
import { markdownToHtml } from "@/lib/utils";

const ACTIVE_WORKSPACE_STORAGE_KEY = "study-companion.activeWorkspaceId";

function extractLinesForExport(html: string): string[] {
  const root = document.createElement("div");
  root.innerHTML = html;

  const lines: string[] = [];

  const normalizeText = (value: string) =>
    value
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const addLine = (value: string, prefix = "") => {
    const text = normalizeText(value);
    if (!text) return;
    lines.push(prefix ? `${prefix}${text}` : text);
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      addLine(node.textContent || "");
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (tag === "ul") {
      const items = Array.from(el.children).filter((child) => child.tagName.toLowerCase() === "li");
      items.forEach((item) => addLine(item.textContent || "", "• "));
      return;
    }

    if (tag === "ol") {
      const items = Array.from(el.children).filter((child) => child.tagName.toLowerCase() === "li");
      items.forEach((item, index) => addLine(item.textContent || "", `${index + 1}. `));
      return;
    }

    if (["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre"].includes(tag)) {
      addLine(el.textContent || "");
      return;
    }

    if (tag === "br") {
      lines.push("");
      return;
    }

    Array.from(el.childNodes).forEach(walk);
  };

  Array.from(root.childNodes).forEach(walk);

  return lines;
}

function renderPdfFromText(doc: jsPDF, activeName: string, formattedText: string) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Study Notes", 48, 60);
  doc.setFontSize(14);
  doc.text(activeName, 48, 85);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Exported: ${new Date().toLocaleString()}`, 48, 105);

  const lines = formattedText.split("\n");
  let yPosition = 130;
  const lineHeight = 14;
  const pageHeight = doc.internal.pageSize.height;
  const margin = 48;
  const maxWidth = 500;

  lines.forEach((line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      yPosition += lineHeight / 2;
      return;
    }

    if (yPosition > pageHeight - margin) {
      doc.addPage();
      yPosition = margin;
    }

    if (/^Page\s+\d+$/i.test(trimmedLine)) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
    } else if (trimmedLine === "=".repeat(80)) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
    } else if (trimmedLine === "-".repeat(40)) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
    }

    if (doc.getTextWidth(trimmedLine) > maxWidth) {
      const wrappedLines = doc.splitTextToSize(trimmedLine, maxWidth);
      wrappedLines.forEach((wrappedLine: string) => {
        if (yPosition > pageHeight - margin) {
          doc.addPage();
          yPosition = margin;
        }
        doc.text(wrappedLine, margin, yPosition);
        yPosition += lineHeight;
      });
    } else {
      doc.text(trimmedLine, margin, yPosition);
      yPosition += lineHeight;
    }
  });
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function plainTextToParagraphHtml(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}

async function extractPdfPageText(blob: Blob, pageNumber: number) {
  const pdf = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
  const page = await pdf.getPage(pageNumber);
  const textContent = await page.getTextContent();
  const items = textContent.items as Array<{ str?: string; hasEOL?: boolean }>;

  const lines: string[] = [];
  let currentLine = "";

  items.forEach((item) => {
    const chunk = (item.str || "").trimEnd();
    if (!chunk) return;

    if (currentLine && !currentLine.endsWith(" ")) {
      currentLine += " ";
    }
    currentLine += chunk;

    if (item.hasEOL) {
      lines.push(currentLine.trim());
      currentLine = "";
    }
  });

  if (currentLine.trim()) {
    lines.push(currentLine.trim());
  }

  return lines.join("\n").trim();
}

async function extractPptxSlideCount(blob: Blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const presentationXml = await zip.file("ppt/presentation.xml")?.async("string");
  if (presentationXml) {
    const doc = new DOMParser().parseFromString(presentationXml, "application/xml");
    const slideIds = doc.getElementsByTagNameNS("*", "sldId");
    if (slideIds.length > 0) return slideIds.length;
  }

  return Object.keys(zip.files).filter((fileName) => /^ppt\/slides\/slide\d+\.xml$/i.test(fileName)).length;
}

async function extractPptxSlideText(blob: Blob, slideNumber: number) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const slideFile = zip.file(`ppt/slides/slide${slideNumber}.xml`);
  if (!slideFile) return "";

  const slideXml = await slideFile.async("string");
  const slideDoc = new DOMParser().parseFromString(slideXml, "application/xml");
  
  // Try different namespace approaches for PPTX XML
  let paragraphs: Element[] = [];
  
  // Method 1: Try with specific PPTX namespace
  const pElements = slideDoc.getElementsByTagNameNS("http://schemas.openxmlformats.org/presentationml/2006/main", "p");
  if (pElements.length > 0) {
    paragraphs = Array.from(pElements);
  } else {
    // Method 2: Try with generic namespace
    const genericPElements = slideDoc.getElementsByTagNameNS("*", "p");
    if (genericPElements.length > 0) {
      paragraphs = Array.from(genericPElements);
    } else {
      // Method 3: Try without namespace (fallback)
      paragraphs = Array.from(slideDoc.getElementsByTagName("p"));
    }
  }

  const lines = paragraphs
    .map((paragraph) => {
      let textElements: Element[] = [];
      
      // Try different methods to get text elements
      const tElementsNS = paragraph.getElementsByTagNameNS("http://schemas.openxmlformats.org/presentationml/2006/main", "t");
      if (tElementsNS.length > 0) {
        textElements = Array.from(tElementsNS);
      } else {
        const genericTElements = paragraph.getElementsByTagNameNS("*", "t");
        if (genericTElements.length > 0) {
          textElements = Array.from(genericTElements);
        } else {
          textElements = Array.from(paragraph.getElementsByTagName("t"));
        }
      }
      
      return textElements
        .map((node) => node.textContent || "")
        .join("")
        .trim();
    })
    .filter(Boolean);

  const extractedText = lines.join("\n").trim();
  console.log(`PPTX Slide ${slideNumber} extracted text:`, extractedText);
  return extractedText;
}

async function extractTextFromVisibleElement(element: HTMLElement) {
  const canvas = await html2canvas(element, {
    scale: Math.max(2, window.devicePixelRatio || 1),
    useCORS: true,
    allowTaint: true,
    backgroundColor: "#ffffff",
    ignoreElements: (node) => node.tagName.toLowerCase() === "button",
  });

  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");

  try {
    const { data } = await worker.recognize(canvas);
    return (data.text || "").trim();
  } finally {
    await worker.terminate();
  }
}

function StudyApp() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeBlob, setActiveBlob] = useState<Blob | null>(null);
  const [activeMeta, setActiveMeta] = useState<DocMeta | null>(null);
  const [page, setPage] = useState(1);
  const [pptxSlideCount, setPptxSlideCount] = useState(0);
  const [notesHtml, setNotesHtml] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [extractingPageText, setExtractingPageText] = useState(false);
  const SIDEBAR_VISIBLE_KEY = "study-companion.sidebarVisible";
  const [sidebarVisible, setSidebarVisible] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const val = window.localStorage.getItem(SIDEBAR_VISIBLE_KEY);
      return val === null ? true : val === "true";
    } catch (e) {
      return true;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SIDEBAR_VISIBLE_KEY, String(sidebarVisible));
    } catch (e) {
      // ignore
    }
  }, [sidebarVisible]);
  const [chatVisible, setChatVisible] = useState(false);
  const [flashcardOpen, setFlashcardOpen] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [smartNotesOpen, setSmartNotesOpen] = useState(false);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [lastPageText, setLastPageText] = useState("");
  const editorRef = useRef<{ insertPageTag: () => void } | null>(null);
  const pptxViewerRef = useRef<PptxViewerHandle | null>(null);

  // Load workspaces and docs on mount
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [workspacesList, docsList] = await Promise.all([
      storage.listWorkspaces(),
      storage.listDocs()
    ]);
    setWorkspaces(workspacesList);
    setDocs(docsList);

    const storedWorkspaceId =
      typeof window !== "undefined" ? window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY) : null;
    const preferredWorkspaceId =
      storedWorkspaceId && workspacesList.some((workspace) => workspace.id === storedWorkspaceId)
        ? storedWorkspaceId
        : null;
    
    // If no workspaces exist, create a default one
    if (workspacesList.length === 0) {
      const defaultWorkspace = await storage.createWorkspace("Default Workspace");
      setWorkspaces([defaultWorkspace]);
      setActiveWorkspaceId(defaultWorkspace.id);
    } else {
      // Restore the last selected workspace, or fall back to the first one.
      setActiveWorkspaceId(preferredWorkspaceId || workspacesList[0].id);
    }
  };

  // Reset per-doc state when the active doc changes
  useEffect(() => {
    setLastPageText("");
    setPdfPageCount(0);
  }, [activeId]);

  // Load active doc + notes
  useEffect(() => {
    if (!activeId) {
      setActiveBlob(null);
      setActiveMeta(null);
      setNotesHtml("");
      setPptxSlideCount(0);
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
        setPptxSlideCount(0);

        if (meta?.type === "pptx" && blob) {
          extractPptxSlideCount(blob)
            .then((count) => {
              setPptxSlideCount(count);
              setPage((current) => Math.min(Math.max(1, current), Math.max(1, count)));
            })
            .catch(() => setPptxSlideCount(0));
        }

        setLoading(false);
      }
    );
  }, [activeId]);

  // Update docs when workspace changes
  useEffect(() => {
    if (!activeWorkspaceId) return;
    
    const workspaceDocs = docs.filter(doc => doc.workspaceId === activeWorkspaceId);
    if (workspaceDocs.length > 0 && !activeId) {
      setActiveId(workspaceDocs[0].id);
    }
  }, [activeWorkspaceId, docs, activeId]);

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

  // Persist selected workspace across refreshes.
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (activeWorkspaceId) {
      window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, activeWorkspaceId);
    } else {
      window.localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
    }
  }, [activeWorkspaceId]);

  const handleUpload = useCallback(async (file: File) => {
    if (!activeWorkspaceId) {
      toast.error("Please select a workspace first.");
      return;
    }

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const isPptx = file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || file.name.toLowerCase().endsWith(".pptx");
    const isHtml = file.type === "text/html" || file.name.toLowerCase().endsWith(".html") || file.name.toLowerCase().endsWith(".htm");
    
    if (!isPdf && !isPptx && !isHtml) {
      toast.error("Only PDF, PPTX, and HTML files are supported.");
      return;
    }

    const meta: DocMeta = {
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      type: isPdf ? 'pdf' : isPptx ? 'pptx' : 'html',
      workspaceId: activeWorkspaceId,
      addedAt: Date.now(),
      lastPage: 1,
    };

    if (isHtml) {
      // For HTML files, read content and set it as notes
      try {
        const htmlContent = await file.text();
        setNotesHtml(htmlContent);
        setPptxSlideCount(0);
        setPage(1);
        
        // Create a blob for storage
        const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
        await storage.addDoc(meta, htmlBlob);
        const all = await storage.listDocs();
        setDocs(all);
        setActiveId(meta.id);
        toast.success(`Loaded ${file.name}`);
      } catch (error) {
        console.error('Failed to load HTML file:', error);
        toast.error(`Failed to load ${file.name}`);
      }
    } else {
      // For PDF and PPTX files, use existing logic
      await storage.addDoc(meta, file);
      const all = await storage.listDocs();
      setDocs(all);
      setActiveId(meta.id);
      toast.success(`Loaded ${file.name}`);
    }
  }, [activeWorkspaceId]);

  const handleDelete = useCallback(
    async (id: string) => {
      await storage.deleteDoc(id);
      const all = await storage.listDocs();
      setDocs(all);
      if (activeId === id) {
        const workspaceDocs = all.filter(doc => doc.workspaceId === activeWorkspaceId);
        setActiveId(workspaceDocs[0]?.id || null);
      }
    },
    [activeId, activeWorkspaceId]
  );

  const handleCreateWorkspace = useCallback(async (name: string) => {
    const workspace = await storage.createWorkspace(name);
    setWorkspaces(prev => [...prev, workspace]);
    setActiveWorkspaceId(workspace.id);
    setActiveId(null);
    toast.success(`Created workspace: ${name}`);
  }, []);

  const handleUpdateWorkspace = useCallback(async (workspace: Workspace) => {
    await storage.updateWorkspace(workspace);
    setWorkspaces(prev => prev.map(w => w.id === workspace.id ? workspace : w));
    toast.success(`Renamed workspace: ${workspace.name}`);
  }, []);

  const handleDeleteWorkspace = useCallback(async (id: string) => {
    await storage.deleteWorkspace(id);
    setWorkspaces(prev => prev.filter(w => w.id !== id));
    const remainingDocs = await storage.listDocs();
    setDocs(remainingDocs);
    if (activeWorkspaceId === id) {
      const remainingWorkspaces = workspaces.filter(w => w.id !== id);
      setActiveWorkspaceId(remainingWorkspaces[0]?.id || null);
      setActiveId(null);
    }
    toast.success("Workspace deleted");
  }, [activeWorkspaceId, workspaces]);

  const handleSelectWorkspace = useCallback((workspaceId: string | null) => {
    setActiveWorkspaceId(workspaceId);
    setActiveId(null);
  }, []);

  const insertPageTag = useCallback(() => {
    // Append a tag at end of notes; lightweight approach
    const tag = `<p><strong>— Page ${page} —</strong></p>`;
    setNotesHtml((h) => (h ? h + tag : tag));
    toast(`Tagged page ${page}`);
  }, [page]);

  const insertAIContent = useCallback((content: string) => {
    const aiBlock =
      `<hr><p><strong>— AI Response —</strong></p>` +
      markdownToHtml(content) +
      `<hr>`;
    setNotesHtml((h) => (h ? h + aiBlock : aiBlock));
    toast('AI response added to notes');
  }, []);

  const handleExtractCurrentPageText = useCallback(async (pageNumber: number, visibleText?: string) => {
    if (!activeBlob || !activeMeta) return;

    setExtractingPageText(true);
    try {
      let extractedText = visibleText?.trim() || "";

      if (!extractedText && activeMeta.type === "pdf") {
        const pageElement = document.querySelector(`[data-pdf-page="${pageNumber}"]`) as HTMLElement | null;
        if (!pageElement) {
          throw new Error("Current PDF page is not visible yet.");
        }

        extractedText = await extractTextFromVisibleElement(pageElement);
        if (!extractedText.trim()) {
          extractedText = await extractPdfPageText(activeBlob, pageNumber);
        }
      } else if (!extractedText && activeMeta.type === "pptx") {
        extractedText = await extractPptxSlideText(activeBlob, pageNumber);
      }

      if (!extractedText.trim()) {
        toast.error(`No extractable text found on page ${pageNumber}.`);
        return;
      }

      setLastPageText(extractedText);
      const htmlText = plainTextToParagraphHtml(extractedText);
      const block = `<p><strong>— Page ${pageNumber} extracted text —</strong></p>${htmlText}`;
      setNotesHtml((current) => (current ? `${current}${block}` : block));
      toast.success(`Extracted text from page ${pageNumber}.`);
    } catch (error) {
      console.error(error);
      toast.error("Could not extract text from the current screen.");
    } finally {
      setExtractingPageText(false);
    }
  }, [activeBlob, activeMeta]);

  const handleConvertPptxToPdf = useCallback(async (docId: string) => {
    const doc = docs.find(d => d.id === docId);
    if (!doc || doc.type !== 'pptx') {
      throw new Error('Document is not a PPTX file');
    }

    // Get the blob for this document
    const blob = await storage.getBlob(docId);
    if (!blob) {
      throw new Error('Could not find document file');
    }

    // Create a temporary PptxViewer instance to handle the conversion
    const tempContainer = document.createElement('div');
    tempContainer.style.position = 'fixed';
    tempContainer.style.left = '-10000px';
    tempContainer.style.top = '0';
    tempContainer.style.width = '800px';
    tempContainer.style.height = '600px';
    document.body.appendChild(tempContainer);

    let previewer: any = null;
    try {
      const { init } = await import('pptx-preview');
      previewer = init(tempContainer, {
        width: 800,
        height: 600,
        mode: 'slide',
      });

      const arrayBuffer = await blob.arrayBuffer();
      await previewer.preview(arrayBuffer);
      
      const slideCount = previewer.slideCount || 0;
      if (slideCount === 0) {
        throw new Error('No slides found in presentation');
      }

      // Create PDF
      const jsPDF = await import('jspdf');
      const html2canvas = await import('html2canvas');
      const pdf = new jsPDF.default({ orientation: 'landscape', unit: 'px', compress: true });
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = pdf.internal.pageSize.getHeight();

      for (let i = 0; i < slideCount; i++) {
        previewer.renderSingleSlide(i);
        await new Promise((r) => setTimeout(r, 120));

        const slideEl = tempContainer.querySelector(`.pptx-preview-slide-wrapper-${i}`) as HTMLElement | null;
        if (!slideEl) continue;

        const canvas = await html2canvas.default(slideEl, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
        });

        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        const imgW = canvas.width;
        const imgH = canvas.height;
        const ratio = Math.min(pdfW / imgW, pdfH / imgH);
        const x = (pdfW - imgW * ratio) / 2;
        const y = (pdfH - imgH * ratio) / 2;

        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', x, y, imgW * ratio, imgH * ratio);
      }

      const baseName = doc.name.replace(/\.pptx$/i, '');
      pdf.save(`${baseName}.pdf`);
    } finally {
      previewer?.destroy();
      document.body.removeChild(tempContainer);
    }
  }, [docs]);

  const formatNotesForExport = () => {
    if (!activeMeta) return "";
    const lines = extractLinesForExport(notesHtml);

    // Process lines and organize by page
    const organizedNotes: { [page: number]: string[] } = {};
    let currentPage = 1;
    let currentNotes: string[] = [];

    lines.forEach((line) => {
      const trimmedLine = line.trim();

      if (!trimmedLine) return;

      // Check if this is a page marker
      const pageMatch = trimmedLine.match(/^[-–—]\s*Page\s+(\d+)\s*[-–—]$/i);
      if (pageMatch) {
        // Save previous page notes
        if (currentNotes.length > 0) {
          organizedNotes[currentPage] = currentNotes;
        }
        // Start new page
        currentPage = parseInt(pageMatch[1]);
        currentNotes = [];
      } else {
        currentNotes.push(trimmedLine);
      }
    });

    // Don't forget the last page
    if (currentNotes.length > 0) {
      organizedNotes[currentPage] = currentNotes;
    }

    // Generate formatted text preserving structure
    let formattedText = `Study Notes: ${activeMeta.name}\n`;
    formattedText += `Exported: ${new Date().toLocaleString()}\n`;
    formattedText += `${"=".repeat(80)}\n\n`;

    // Sort pages and format them
    const sortedPages = Object.keys(organizedNotes)
      .map(Number)
      .sort((a, b) => a - b);

    sortedPages.forEach((pageNum) => {
      const pageNotes = organizedNotes[pageNum];
      if (pageNotes && pageNotes.length > 0) {
        formattedText += `Page ${pageNum}\n`;
        formattedText += `${"-".repeat(40)}\n`;

        // Add notes preserving original structure
        pageNotes.forEach((note) => {
          formattedText += `${note}\n`;
        });
        formattedText += "\n";
      }
    });

    // Add any content that wasn't page-organized
    if (sortedPages.length === 0 && lines.length > 0) {
      formattedText += "Notes:\n";
      formattedText += `${"-".repeat(40)}\n`;
      lines.forEach((line) => {
        const trimmed = line.trim();
        if (trimmed) {
          formattedText += `${trimmed}\n`;
        }
      });
    }

    return formattedText;
  };

  const downloadAsText = () => {
    if (!activeMeta) return;

    const formattedText = formatNotesForExport();
    // Prefix BOM so macOS editors reliably detect UTF-8 and keep emoji/symbols intact.
    const textWithBom = `\uFEFF${formattedText}`;
    const blob = new Blob([textWithBom], { type: "text/plain; charset=utf-8" });
    triggerDownload(blob, `${stripExt(activeMeta.name)} — study-notes.txt`);
  };

  const downloadAsPdf = async () => {
    if (!activeMeta) return;

    const formattedText = formatNotesForExport();

    const liveContentHost = document.querySelector("[data-notes-export-content]") as HTMLElement | null;
    const liveEditorEl = liveContentHost?.querySelector(".ProseMirror") as HTMLElement | null;
    const liveRoot = document.querySelector("[data-notes-export-root]") as HTMLElement | null;
    const liveRootStyles = liveRoot ? window.getComputedStyle(liveRoot) : null;

    const exportContainer = document.createElement("div");
    exportContainer.style.position = "fixed";
    exportContainer.style.left = "-10000px";
    exportContainer.style.top = "0";
    const liveWidth = liveEditorEl ? Math.ceil(liveEditorEl.getBoundingClientRect().width) : 700;
    exportContainer.style.width = `${Math.max(480, liveWidth)}px`;
    exportContainer.style.background = liveRootStyles?.backgroundColor || "#ffffff";
    exportContainer.style.color = liveRootStyles?.color || "#0f172a";
    exportContainer.style.padding = "0";
    exportContainer.style.boxSizing = "border-box";
    exportContainer.style.pointerEvents = "none";
    exportContainer.style.fontFamily = liveRootStyles?.fontFamily || "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";

    if (liveEditorEl) {
      const clonedEditor = liveEditorEl.cloneNode(true) as HTMLElement;
      clonedEditor.style.minHeight = "0";
      clonedEditor.style.height = "auto";
      exportContainer.appendChild(clonedEditor);
    } else {
      const fallbackNotes = document.createElement("div");
      fallbackNotes.className = "prose-notes";
      fallbackNotes.innerHTML = notesHtml || "<p></p>";
      fallbackNotes.style.padding = "24px";
      exportContainer.appendChild(fallbackNotes);
    }
    document.body.appendChild(exportContainer);

    try {
      const canvas = await html2canvas(exportContainer, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#ffffff",
        windowWidth: exportContainer.scrollWidth,
        windowHeight: exportContainer.scrollHeight,
        ignoreElements: (element) => element.tagName.toLowerCase() === "canvas",
        onclone: (clonedDoc) => {
          // Remove canvases from the cloned DOM to avoid tainted-canvas clone failures.
          clonedDoc.querySelectorAll("canvas").forEach((canvasEl) => canvasEl.remove());
        },
      });

      const imgData = canvas.toDataURL("image/png");
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const marginTop = 40;
      const marginRight = 24;
      const marginBottom = 56;
      const marginLeft = 24;
      const printableWidth = pageWidth - marginLeft - marginRight;
      const printableHeight = pageHeight - marginTop - marginBottom;

      const sourceSliceHeight = Math.floor((canvas.width * printableHeight) / printableWidth);
      let sourceY = 0;
      let isFirstPage = true;

      while (sourceY < canvas.height) {
        const sliceHeight = Math.min(sourceSliceHeight, canvas.height - sourceY);
        const sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = sliceHeight;

        const sliceContext = sliceCanvas.getContext("2d");
        if (!sliceContext) {
          throw new Error("Unable to create PDF export canvas slice.");
        }

        sliceContext.drawImage(canvas, 0, sourceY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

        const sliceData = sliceCanvas.toDataURL("image/png");
        const sliceHeightInPdf = (sliceHeight * printableWidth) / canvas.width;

        if (!isFirstPage) {
          doc.addPage();
        }

        doc.addImage(sliceData, "PNG", marginLeft, marginTop, printableWidth, sliceHeightInPdf);

        sourceY += sliceHeight;
        isFirstPage = false;
      }

      doc.save(`${stripExt(activeMeta.name)} — study-notes.pdf`);
    } catch {
      // Fallback to text renderer if html capture fails in the current browser/runtime.
      const fallbackDoc = new jsPDF({ unit: "pt", format: "a4" });
      renderPdfFromText(fallbackDoc, activeMeta.name, formattedText);
      fallbackDoc.save(`${stripExt(activeMeta.name)} — study-notes.pdf`);
      toast.error("Used fallback PDF renderer due to an HTML export issue.");
    } finally {
      exportContainer.remove();
    }
  };

  const savedLabel = useMemo(() => {
    if (!savedAt) return "";
    const s = Math.round((Date.now() - savedAt) / 1000);
    return s < 5 ? "Saved" : `Saved ${s}s ago`;
  }, [savedAt, notesHtml]);

  const isPptx = activeMeta?.type === "pptx";

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-toolbar px-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarVisible(!sidebarVisible)}
            className="h-7 w-7"
          >
            {sidebarVisible ? <PanelLeft className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
          </Button>
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
          <Button
            variant="ghost"
            size="sm"
            disabled={!activeMeta}
            onClick={() => setFlashcardOpen(true)}
          >
            <Layers className="h-4 w-4 mr-1.5" /> Flashcards
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!activeMeta}
            onClick={() => setQuizOpen(true)}
          >
            <Sparkles className="h-4 w-4 mr-1.5" /> Quiz
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!activeMeta}
            onClick={() => setSmartNotesOpen(true)}
          >
            <BookOpen className="h-4 w-4 mr-1.5" /> Smart Notes
          </Button>
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
        {sidebarVisible && (
          <DocSidebar
            workspaces={workspaces}
            docs={docs}
            activeWorkspaceId={activeWorkspaceId}
            activeId={activeId}
            onSelect={setActiveId}
            onSelectWorkspace={handleSelectWorkspace}
            onUpload={handleUpload}
            onDelete={handleDelete}
            onCreateWorkspace={handleCreateWorkspace}
            onUpdateWorkspace={handleUpdateWorkspace}
            onDeleteWorkspace={handleDeleteWorkspace}
            onExportPdf={(id) => {
              if (id === activeId) pptxViewerRef.current?.exportPdf();
            }}
            onConvertPptxToPdf={handleConvertPptxToPdf}
          />
        )}
        <main className="flex-1 min-w-0">
          {loading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading…
            </div>
          ) : (
            <PanelGroup direction="horizontal" className="h-full">
              <Panel defaultSize={55} minSize={30} className="bg-surface">
                {activeMeta?.type === "pdf" ? (
                  <PdfViewer
                    file={activeBlob}
                    page={page}
                    onPageChange={setPage}
                    onNumPages={setPdfPageCount}
                    onExtractPageText={handleExtractCurrentPageText}
                    extractingPageText={extractingPageText}
                  />
                ) : activeMeta?.type === "pptx" ? (
                  <PptxViewer
                    ref={pptxViewerRef}
                    file={activeBlob}
                    fileName={activeMeta?.name}
                    page={page}
                    onPageChange={setPage}
                    onExtractPageText={handleExtractCurrentPageText}
                    extractingPageText={extractingPageText}
                    onNumPages={(count) => setPptxSlideCount(count)}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    Unsupported document type.
                  </div>
                )}
              </Panel>
              <PanelResizeHandle className="w-1.5 bg-border hover:bg-primary/40 transition-colors" />
              <Panel defaultSize={45} minSize={25} className="bg-card">
                <NotesEditor value={notesHtml} onChange={setNotesHtml} onInsertPageTag={activeMeta ? insertPageTag : undefined} />
              </Panel>
            </PanelGroup>
          )}
        </main>
      </div>
      
      {/* Chat AI Component */}
      <ChatAI
        isVisible={chatVisible}
        onToggle={() => setChatVisible(!chatVisible)}
        onInsertToNotes={insertAIContent}
      />

      {/* Flashcard Viewer */}
      <FlashcardViewer
        isOpen={flashcardOpen}
        onClose={() => setFlashcardOpen(false)}
        docId={activeId}
        notesHtml={notesHtml}
        pageText={lastPageText}
        currentPage={page}
      />

      {/* Quiz Viewer */}
      <QuizViewer
        isOpen={quizOpen}
        onClose={() => setQuizOpen(false)}
        notesHtml={notesHtml}
        pageText={lastPageText}
        currentPage={page}
      />

      {/* Smart Notes Generator */}
      <SmartNotesGenerator
        isOpen={smartNotesOpen}
        onClose={() => setSmartNotesOpen(false)}
        activeBlob={activeBlob}
        activeMeta={activeMeta}
        totalPages={activeMeta?.type === "pdf" ? pdfPageCount : pptxSlideCount}
        currentPage={page}
        onInsertToNotes={(html) => {
          setNotesHtml((h) => (h ? h + html : html));
          toast.success("Smart notes added to your notes!");
        }}
      />
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
