import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Upload, FileText, Trash2, Folder, FolderOpen,
  ChevronDown, ChevronRight, Edit2, Check, X,
  FileDown, Loader2, NotebookPen, StickyNote, Plus,
} from "lucide-react";
import { toast } from "sonner";
import type { Workspace, DocMeta, StandaloneNote } from "@/lib/storage";
import { CreateWorkspaceButton } from "@/components/WorkspaceDialog";

interface DocSidebarProps {
  workspaces: Workspace[];
  docs: DocMeta[];
  standaloneNotes: StandaloneNote[];
  activeWorkspaceId: string | null;
  activeId: string | null;
  activeStandaloneNoteId: string | null;
  onSelect: (id: string) => void;
  onSelectStandaloneNote: (id: string) => void;
  onSelectWorkspace: (id: string | null) => void;
  onUpload: (file: File) => void;
  onDelete: (id: string) => void;
  onDeleteStandaloneNote: (id: string) => void;
  onNewNote: () => void;
  onNewPage: (subject: string) => void;
  onCreateWorkspace: (name: string) => Promise<void>;
  onUpdateWorkspace: (workspace: Workspace) => Promise<void>;
  onDeleteWorkspace: (id: string) => Promise<void>;
  onExportPdf?: (docId: string) => void;
  onConvertPptxToPdf?: (docId: string) => Promise<void>;
}

export function DocSidebar({
  workspaces,
  docs,
  standaloneNotes,
  activeWorkspaceId,
  activeId,
  activeStandaloneNoteId,
  onSelect,
  onSelectStandaloneNote,
  onSelectWorkspace,
  onUpload,
  onDelete,
  onDeleteStandaloneNote,
  onNewNote,
  onNewPage,
  onCreateWorkspace,
  onUpdateWorkspace,
  onDeleteWorkspace,
  onExportPdf,
  onConvertPptxToPdf,
}: DocSidebarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set());
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [editingWorkspace, setEditingWorkspace] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [convertingPptx, setConvertingPptx] = useState(false);

  const toggleWorkspace = (id: string) => {
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleNote = (id: string) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const startEditingWorkspace = (workspace: Workspace) => {
    setEditingWorkspace(workspace.id);
    setEditingName(workspace.name);
  };

  const saveWorkspaceName = async (workspace: Workspace) => {
    if (editingName.trim() && editingName !== workspace.name) {
      await onUpdateWorkspace({ ...workspace, name: editingName.trim() });
    }
    setEditingWorkspace(null);
    setEditingName("");
  };

  const cancelEditing = () => {
    setEditingWorkspace(null);
    setEditingName("");
  };

  const handleDeleteWorkspace = async (workspace: Workspace) => {
    if (confirm(`Delete workspace "${workspace.name}" and all its documents?`)) {
      await onDeleteWorkspace(workspace.id);
      if (activeWorkspaceId === workspace.id) onSelectWorkspace(null);
    }
  };

  const handleConvertPptxToPdf = async () => {
    if (!activeId || !onConvertPptxToPdf) return;
    const activeDoc = docs.find((doc) => doc.id === activeId);
    if (!activeDoc || activeDoc.type !== "pptx") {
      toast.error("Please select a PPTX file to convert.");
      return;
    }
    setConvertingPptx(true);
    try {
      await onConvertPptxToPdf(activeId);
      toast.success("PPTX converted to PDF successfully!");
    } catch {
      toast.error("Failed to convert PPTX to PDF. Please try again.");
    } finally {
      setConvertingPptx(false);
    }
  };

  return (
    <aside className="w-64 shrink-0 border-r border-border bg-surface flex flex-col">
      {/* Action buttons */}
      <div className="p-3 border-b border-border space-y-2">
        <Button className="w-full" onClick={onNewNote}>
          <NotebookPen className="h-4 w-4 mr-2" />
          New Note
        </Button>
        <Button
          className="w-full"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={!activeWorkspaceId}
        >
          <Upload className="h-4 w-4 mr-2" />
          Upload File
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
        {activeId && docs.find((doc) => doc.id === activeId)?.type === "pptx" && (
          <Button
            className="w-full"
            variant="outline"
            onClick={handleConvertPptxToPdf}
            disabled={convertingPptx || !onConvertPptxToPdf}
          >
            {convertingPptx ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4 mr-2" />
            )}
            {convertingPptx ? "Converting..." : "Convert to PDF"}
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {/* ── Standalone notes grouped by subject ── */}
        {(() => {
          // Group notes by subject, preserve insertion order of first note per subject
          const groups = new Map<string, typeof standaloneNotes>();
          for (const note of standaloneNotes) {
            const key = note.subject || note.title;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(note);
          }

          return Array.from(groups.entries()).map(([subject, pages]) => {
            // Use the oldest note's id as the stable folder key
            const folderId = pages[pages.length - 1].id;
            const isExpanded = expandedNotes.has(folderId);
            const isFolderActive = pages.some((p) => p.id === activeStandaloneNoteId);
            // Sort pages newest first
            const sortedPages = [...pages].sort((a, b) => b.createdAt - a.createdAt);

            return (
              <div key={folderId}>
                {/* Folder row */}
                <div
                  className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition cursor-pointer ${
                    isFolderActive && !isExpanded ? "bg-accent text-accent-foreground" : "hover:bg-muted text-foreground"
                  }`}
                  onClick={() => {
                    toggleNote(folderId);
                    onSelectStandaloneNote(sortedPages[0].id);
                  }}
                >
                  <button
                    className="h-4 w-4 p-0 flex items-center justify-center shrink-0"
                    onClick={(e) => { e.stopPropagation(); toggleNote(folderId); }}
                  >
                    {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>

                  {isExpanded
                    ? <FolderOpen className="h-4 w-4 shrink-0 text-primary/70" />
                    : <NotebookPen className="h-4 w-4 shrink-0 text-primary/70" />}

                  <span className="flex-1 truncate font-medium">{subject}</span>
                  <span className="text-xs text-muted-foreground opacity-60 group-hover:opacity-0 transition-opacity">
                    {pages.length}
                  </span>

                  <button
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary p-0.5 shrink-0"
                    title="Add new page"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNewPage(subject);
                      setExpandedNotes((prev) => new Set(prev).add(folderId));
                    }}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                  <button
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-0.5 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete all pages in "${subject}"?`))
                        pages.forEach((p) => onDeleteStandaloneNote(p.id));
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>

                {/* Pages under folder */}
                {isExpanded && (
                  <div className="ml-6 mt-0.5 space-y-0.5">
                    {sortedPages.map((page) => {
                      const isPageActive = activeStandaloneNoteId === page.id;
                      return (
                        <div key={page.id} className="group/page flex items-center gap-1">
                          <button
                            onClick={() => onSelectStandaloneNote(page.id)}
                            className={`flex-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
                              isPageActive
                                ? "bg-accent/50 text-accent-foreground"
                                : "hover:bg-muted/50 text-foreground"
                            }`}
                          >
                            <StickyNote className="h-3 w-3 shrink-0 opacity-70" />
                            <span className="truncate">{page.title}</span>
                          </button>
                          <button
                            className="opacity-0 group-hover/page:opacity-100 text-muted-foreground hover:text-destructive p-0.5 shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Delete page "${page.title}"?`))
                                onDeleteStandaloneNote(page.id);
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          });
        })()}

        {/* Divider between notes and workspaces */}
        {standaloneNotes.length > 0 && workspaces.length > 0 && (
          <div className="border-t border-border my-1" />
        )}

        {/* ── Workspaces ── */}
        {workspaces.length === 0 && standaloneNotes.length === 0 && (
          <p className="text-xs text-muted-foreground px-2 py-4 text-center">
            No workspaces yet. Create one to get started.
          </p>
        )}

        {workspaces.map((workspace) => {
          const isExpanded = expandedWorkspaces.has(workspace.id);
          const isActive = activeWorkspaceId === workspace.id;
          const workspaceDocs = docs.filter((d) => d.workspaceId === workspace.id);
          const isEditing = editingWorkspace === workspace.id;

          return (
            <div key={workspace.id} className="space-y-0.5">
              <div
                className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition cursor-pointer ${
                  isActive ? "bg-accent text-accent-foreground" : "hover:bg-muted text-foreground"
                }`}
                onClick={() => { onSelectWorkspace(workspace.id); if (!isExpanded) toggleWorkspace(workspace.id); }}
              >
                <button
                  className="h-4 w-4 p-0 flex items-center justify-center shrink-0"
                  onClick={(e) => { e.stopPropagation(); toggleWorkspace(workspace.id); }}
                >
                  {isExpanded
                    ? <ChevronDown className="h-3 w-3" />
                    : <ChevronRight className="h-3 w-3" />}
                </button>

                {isExpanded
                  ? <FolderOpen className="h-4 w-4 shrink-0 opacity-70" />
                  : <Folder className="h-4 w-4 shrink-0 opacity-70" />}

                {isEditing ? (
                  <div className="flex-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveWorkspaceName(workspace);
                        if (e.key === "Escape") cancelEditing();
                      }}
                      className="h-6 text-xs"
                      autoFocus
                    />
                    <button className="p-0.5" onClick={() => saveWorkspaceName(workspace)}>
                      <Check className="h-3 w-3" />
                    </button>
                    <button className="p-0.5" onClick={cancelEditing}>
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="flex-1 truncate">{workspace.name}</span>
                    <span className="text-xs text-muted-foreground">({workspaceDocs.length})</span>
                    <button
                      className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 flex items-center justify-center"
                      onClick={(e) => { e.stopPropagation(); startEditingWorkspace(workspace); }}
                    >
                      <Edit2 className="h-3 w-3" />
                    </button>
                    <button
                      className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive flex items-center justify-center"
                      onClick={(e) => { e.stopPropagation(); handleDeleteWorkspace(workspace); }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>

              {isExpanded && (
                <ul className="ml-6 space-y-0.5">
                  {workspaceDocs.length === 0 && (
                    <li className="text-xs text-muted-foreground px-2 py-1 italic">
                      No documents yet
                    </li>
                  )}
                  {workspaceDocs.map((doc) => (
                    <li key={doc.id}>
                      <button
                        onClick={() => onSelect(doc.id)}
                        className={`group w-full flex items-start gap-2 rounded-md px-2 py-2 text-left text-xs transition ${
                          activeId === doc.id
                            ? "bg-accent/50 text-accent-foreground"
                            : "hover:bg-muted/50 text-foreground"
                        }`}
                      >
                        <FileText className="h-3 w-3 mt-0.5 shrink-0 opacity-70" />
                        <span className="flex-1 truncate" title={doc.name}>{doc.name}</span>
                        {doc.type === "pptx" && onExportPdf && (
                          <span
                            role="button"
                            tabIndex={0}
                            title="Export as PDF"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelect(doc.id);
                              onExportPdf(doc.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary p-0.5"
                          >
                            <FileDown className="h-3 w-3" />
                          </span>
                        )}
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Delete "${doc.name}" and its notes?`)) onDelete(doc.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-0.5"
                        >
                          <Trash2 className="h-3 w-3" />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        <div className="mt-3 pt-2 border-t border-border">
          <CreateWorkspaceButton onCreateWorkspace={onCreateWorkspace} />
        </div>
      </div>
    </aside>
  );
}
