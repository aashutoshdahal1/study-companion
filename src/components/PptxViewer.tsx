import { useEffect, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { init } from "pptx-preview";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, FileText, Loader2, Maximize2, ZoomIn, ZoomOut } from "lucide-react";

interface PptxViewerProps {
  file: Blob | null;
  page: number;
  onPageChange: (p: number) => void;
  onNumPages?: (n: number) => void;
  onExtractPageText?: (pageNumber: number, visibleText?: string) => void;
  extractingPageText?: boolean;
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

export function PptxViewer({
  file,
  page,
  onPageChange,
  onNumPages,
  onExtractPageText,
  extractingPageText,
}: PptxViewerProps) {
  const [slideCount, setSlideCount] = useState(0);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  const previewHostRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewerRef = useRef<ReturnType<typeof init> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      setContainerSize({
        width: Math.max(480, Math.floor(entry.contentRect.width)),
        height: Math.max(360, Math.floor(entry.contentRect.height - 56)),
      });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const host = previewHostRef.current;
    if (!host || !file) return;

    let cancelled = false;

    (async () => {
      host.innerHTML = "";

      const previewer = init(host, {
        width: containerSize.width,
        height: containerSize.height,
        mode: "slide",
      });
      previewerRef.current = previewer;

      const arrayBuffer = await file.arrayBuffer();
      await previewer.preview(arrayBuffer);

      if (cancelled) return;

      const count = previewer.slideCount || 0;
      setSlideCount(count);
      onNumPages?.(count);
      if (count > 0) {
        onPageChange(Math.min(Math.max(1, page), count));
      }
    })().catch((error) => {
      console.error("Failed to render PPTX preview", error);
      host.innerHTML = `<div class="flex h-full items-center justify-center text-sm text-muted-foreground">Failed to load PPTX preview.</div>`;
    });

    return () => {
      cancelled = true;
      previewerRef.current?.destroy();
      previewerRef.current = null;
      host.innerHTML = "";
    };
  }, [file, containerSize.width, containerSize.height]);

  useEffect(() => {
    if (!previewerRef.current || !slideCount) return;
    const currentIndex = Math.min(Math.max(1, page), slideCount) - 1;
    previewerRef.current.renderSingleSlide(currentIndex);
  }, [page, slideCount]);

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        Upload a PPTX to start studying.
      </div>
    );
  }

  const handleExtract = async () => {
    if (!onExtractPageText) return;

    const slideElement = previewHostRef.current?.querySelector(`.pptx-preview-slide-wrapper-${Math.max(1, page) - 1}`) as HTMLElement | null;
    if (!slideElement) {
      onExtractPageText(page);
      return;
    }

    try {
      const extractedText = await extractTextFromVisibleElement(slideElement);
      onExtractPageText(page, extractedText || undefined);
    } catch (error) {
      console.error(error);
      onExtractPageText(page);
    }
  };

  return (
    <div ref={containerRef} className="flex h-full flex-col bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-toolbar px-3 py-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1 || slideCount <= 1}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm tabular-nums text-muted-foreground">
            {page} / {slideCount || "—"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onPageChange(slideCount > 0 ? Math.min(slideCount, page + 1) : page + 1)}
            disabled={slideCount > 0 ? page >= slideCount : true}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          {onExtractPageText && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleExtract}
              disabled={extractingPageText}
              className="gap-1"
              title="Extract text from the current slide"
            >
              {extractingPageText ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              <span className="hidden sm:inline">Extract screen text</span>
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => setContainerSize((s) => ({ ...s, width: Math.max(320, Math.round(s.width - 80)) }))}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs tabular-nums w-10 text-center text-muted-foreground">100%</span>
          <Button variant="ghost" size="icon" onClick={() => setContainerSize((s) => ({ ...s, width: Math.min(1400, Math.round(s.width + 80)) }))}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setContainerSize({ width: 800, height: 600 })} title="Reset">
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-surface px-4 py-6">
        <div className="mx-auto max-w-full overflow-auto">
          <div style={{ width: containerSize.width, height: containerSize.height, margin: "0 auto" }}>
            <div ref={previewHostRef} className="pptx-preview-host" />
          </div>
        </div>
        <div className="mt-3 text-center text-[11px] text-muted-foreground">
          PPTX slide preview is rendered in the browser, then OCR can read the current slide screen.
        </div>
      </div>
    </div>
  );
}