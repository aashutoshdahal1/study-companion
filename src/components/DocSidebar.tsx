import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, FileText, Trash2 } from "lucide-react";
import type { DocMeta } from "@/lib/storage";

interface DocSidebarProps {
  docs: DocMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onUpload: (file: File) => void;
  onDelete: (id: string) => void;
}

export function DocSidebar({ docs, activeId, onSelect, onUpload, onDelete }: DocSidebarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <aside className="w-64 shrink-0 border-r border-border bg-surface flex flex-col">
      <div className="p-3 border-b border-border">
        <Button className="w-full" onClick={() => inputRef.current?.click()}>
          <Upload className="h-4 w-4 mr-2" />
          Upload PDF
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {docs.length === 0 && (
          <p className="text-xs text-muted-foreground px-2 py-4 text-center">
            No documents yet. Upload a PDF to begin.
          </p>
        )}
        <ul className="space-y-1">
          {docs.map((d) => (
            <li key={d.id}>
              <button
                onClick={() => onSelect(d.id)}
                className={`group w-full flex items-start gap-2 rounded-md px-2 py-2 text-left text-sm transition ${
                  activeId === d.id
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted text-foreground"
                }`}
              >
                <FileText className="h-4 w-4 mt-0.5 shrink-0 opacity-70" />
                <span className="flex-1 truncate" title={d.name}>{d.name}</span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete "${d.name}" and its notes?`)) onDelete(d.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-0.5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
