import { useEffect, useRef, useState } from "react";
import { Document, Page } from "react-pdf";
import "@/lib/pdfWorker";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, FileText, Loader2, Maximize2, ZoomIn, ZoomOut } from "lucide-react";

interface PdfViewerProps {
  file: Blob | null;
  page: number;
  onPageChange: (p: number) => void;
  onNumPages?: (n: number) => void;
  onExtractPageText?: (pageNumber: number) => void;
  extractingPageText?: boolean;
}

export function PdfViewer({
  file,
  page,
  onPageChange,
  onNumPages,
  onExtractPageText,
  extractingPageText,
}: PdfViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [containerWidth, setContainerWidth] = useState<number | undefined>();
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const getVisiblePageNumber = () => {
    const root = containerRef.current;
    if (!root || !numPages) return page;

    const rootRect = root.getBoundingClientRect();
    const viewportTop = rootRect.top;
    const viewportBottom = rootRect.bottom;

    let bestPage = page;
    let bestVisibleHeight = -1;
    let nearestTopDistance = Number.POSITIVE_INFINITY;

    for (let i = 1; i <= numPages; i++) {
      const el = pageRefs.current[i];
      if (!el) continue;

      const rect = el.getBoundingClientRect();
      const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportBottom) - Math.max(rect.top, viewportTop));
      const topDistance = Math.abs(rect.top - viewportTop);

      if (visibleHeight > bestVisibleHeight || (visibleHeight === bestVisibleHeight && topDistance < nearestTopDistance)) {
        bestVisibleHeight = visibleHeight;
        nearestTopDistance = topDistance;
        bestPage = i;
      }
    }

    return bestPage;
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([e]) => setContainerWidth(e.contentRect.width - 32));
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // NOTE: Disabled scroll-into-view to prevent auto-scrolling issues
  // useEffect(() => {
  //   const el = pageRefs.current[page];
  //   if (el) {
  //     const container = containerRef.current;
  //     if (container) {
  //       const currentScrollTop = container.scrollTop;
  //       const pageTop = el.offsetTop;
  //       
  //       // Only scroll if the page is not already in view and the change wasn't from scrolling
  //       if (Math.abs(currentScrollTop - pageTop) > 200) {
  //         el.scrollIntoView({ behavior: "smooth", block: "start" });
  //       }
  //     }
  //   }
  // }, [page, numPages]);

  // Detect current page based on scroll position
  useEffect(() => {
    const root = containerRef.current;
    if (!root || !numPages) return;
    let scrollTimeout: NodeJS.Timeout;
    
    const onScroll = () => {
      // Debounce scroll detection to avoid excessive updates
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const top = root.scrollTop + 80;
        let current = 1;
        for (let i = 1; i <= numPages; i++) {
          const el = pageRefs.current[i];
          if (el && el.offsetTop <= top) current = i;
        }
        if (current !== page) onPageChange(current);
      }, 150); // 150ms debounce
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      clearTimeout(scrollTimeout);
    };
  }, [numPages, page, onPageChange]);

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        Upload a PDF to start studying.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-toolbar px-3 py-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm tabular-nums text-muted-foreground">
            {page} / {numPages || "—"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onPageChange(Math.min(numPages, page + 1))}
            disabled={page >= numPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          {onExtractPageText && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onExtractPageText(getVisiblePageNumber())}
              disabled={extractingPageText}
              className="gap-1"
              title="Extract text from the current page"
            >
              {extractingPageText ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              <span className="hidden sm:inline">Extract page text</span>
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => setScale((s) => Math.max(0.5, s - 0.1))}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs tabular-nums w-10 text-center text-muted-foreground">{Math.round(scale * 100)}%</span>
          <Button variant="ghost" size="icon" onClick={() => setScale((s) => Math.min(3, s + 0.1))}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setScale(1.0)} title="Reset">
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 overflow-auto bg-surface px-4 py-6">
        <Document
          file={file}
          onLoadSuccess={({ numPages: n }) => {
            setNumPages(n);
            onNumPages?.(n);
          }}
          loading={<div className="text-sm text-muted-foreground">Loading PDF…</div>}
          error={<div className="text-sm text-destructive">Failed to load PDF.</div>}
        >
          <div className="flex flex-col items-center gap-6">
            {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
              <div
                key={p}
                ref={(el) => (pageRefs.current[p] = el)}
                data-pdf-page={p}
                className={`rounded-md overflow-hidden bg-card shadow-[var(--shadow-soft)] ring-1 transition ${
                  p === page ? "ring-primary/60" : "ring-border"
                }`}
              >
                <Page pageNumber={p} width={containerWidth} scale={scale} renderAnnotationLayer renderTextLayer />
                <div className="text-[11px] text-muted-foreground text-center py-1.5 border-t border-border bg-muted/30">
                  Page {p}
                </div>
              </div>
            ))}
          </div>
        </Document>
      </div>
    </div>
  );
}
