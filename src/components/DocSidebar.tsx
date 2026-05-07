import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, FileText, Trash2, Folder, FolderOpen, ChevronDown, ChevronRight, Edit2, Check, X, FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Workspace, DocMeta } from "@/lib/storage";
import { CreateWorkspaceButton } from "@/components/WorkspaceDialog";

interface DocSidebarProps {
  workspaces: Workspace[];
  docs: DocMeta[];
  activeWorkspaceId: string | null;
  activeId: string | null;
  onSelect: (id: string) => void;
  onSelectWorkspace: (id: string | null) => void;
  onUpload: (file: File) => void;
  onDelete: (id: string) => void;
  onCreateWorkspace: (name: string) => Promise<void>;
  onUpdateWorkspace: (workspace: Workspace) => Promise<void>;
  onDeleteWorkspace: (id: string) => Promise<void>;
  onExportPdf?: (docId: string) => void;
  onConvertPptxToPdf?: (docId: string) => Promise<void>;
}

export function DocSidebar({
  workspaces,
  docs,
  activeWorkspaceId,
  activeId,
  onSelect,
  onSelectWorkspace,
  onUpload,
  onDelete,
  onCreateWorkspace,
  onUpdateWorkspace,
  onDeleteWorkspace,
  onExportPdf,
  onConvertPptxToPdf,
}: DocSidebarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set());
  const [editingWorkspace, setEditingWorkspace] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [convertingPptx, setConvertingPptx] = useState(false);

  const toggleWorkspace = (workspaceId: string) => {
    const newExpanded = new Set(expandedWorkspaces);
    if (newExpanded.has(workspaceId)) {
      newExpanded.delete(workspaceId);
    } else {
      newExpanded.add(workspaceId);
    }
    setExpandedWorkspaces(newExpanded);
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

  const getDocsForWorkspace = (workspaceId: string) => {
    return docs.filter(doc => doc.workspaceId === workspaceId);
  };

  const handleDeleteWorkspace = async (workspace: Workspace) => {
    if (confirm(`Delete workspace "${workspace.name}" and all its documents?`)) {
      await onDeleteWorkspace(workspace.id);
      if (activeWorkspaceId === workspace.id) {
        onSelectWorkspace(null);
      }
    }
  };

  const handleConvertPptxToPdf = async () => {
    if (!activeId || !onConvertPptxToPdf) return;
    
    const activeDoc = docs.find(doc => doc.id === activeId);
    if (!activeDoc || activeDoc.type !== 'pptx') {
      toast.error("Please select a PPTX file to convert.");
      return;
    }

    setConvertingPptx(true);
    try {
      await onConvertPptxToPdf(activeId);
      toast.success("PPTX converted to PDF successfully!");
    } catch (error) {
      console.error("Failed to convert PPTX to PDF:", error);
      toast.error("Failed to convert PPTX to PDF. Please try again.");
    } finally {
      setConvertingPptx(false);
    }
  };

  return (
    <aside className="w-64 shrink-0 border-r border-border bg-surface flex flex-col">
      <div className="p-3 border-b border-border">
        {activeWorkspaceId ? (
          <div className="space-y-2">
            <Button 
              className="w-full" 
              onClick={() => inputRef.current?.click()}
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
            {activeId && docs.find(doc => doc.id === activeId)?.type === 'pptx' && (
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
        ) : (
          <CreateWorkspaceButton onCreateWorkspace={onCreateWorkspace} />
        )}
      </div>
      
      <div className="flex-1 overflow-y-auto p-2">
        {workspaces.length === 0 && (
          <p className="text-xs text-muted-foreground px-2 py-4 text-center">
            No workspaces yet. Create one to get started.
          </p>
        )}
        
        <div className="space-y-1">
          {workspaces.map((workspace) => {
            const isExpanded = expandedWorkspaces.has(workspace.id);
            const isActive = activeWorkspaceId === workspace.id;
            const workspaceDocs = getDocsForWorkspace(workspace.id);
            const isEditing = editingWorkspace === workspace.id;

            return (
              <div key={workspace.id} className="space-y-1">
                <div
                  className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition cursor-pointer ${
                    isActive ? "bg-accent text-accent-foreground" : "hover:bg-muted text-foreground"
                  }`}
                  onClick={() => onSelectWorkspace(workspace.id)}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleWorkspace(workspace.id);
                    }}
                  >
                    {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </Button>
                  
                  {isExpanded ? (
                    <FolderOpen className="h-4 w-4 opacity-70" />
                  ) : (
                    <Folder className="h-4 w-4 opacity-70" />
                  )}
                  
                  {isEditing ? (
                    <div className="flex-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveWorkspaceName(workspace);
                          if (e.key === 'Escape') cancelEditing();
                        }}
                        className="h-6 text-xs"
                        autoFocus
                      />
                      <Button size="icon" variant="ghost" className="h-5 w-5 p-0" onClick={() => saveWorkspaceName(workspace)}>
                        <Check className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-5 w-5 p-0" onClick={cancelEditing}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <span className="flex-1 truncate">{workspace.name}</span>
                      <span className="text-xs text-muted-foreground">({workspaceDocs.length})</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditingWorkspace(workspace);
                        }}
                      >
                        <Edit2 className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteWorkspace(workspace);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </div>

                {isExpanded && isActive && workspaceDocs.length > 0 && (
                  <ul className="ml-6 space-y-1">
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

                {isExpanded && isActive && workspaceDocs.length === 0 && (
                  <p className="text-xs text-muted-foreground ml-6 px-2 py-2 italic">
                    No documents in this workspace
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {activeWorkspaceId && (
          <div className="mt-4 pt-2 border-t border-border">
            <CreateWorkspaceButton onCreateWorkspace={onCreateWorkspace} />
          </div>
        )}
      </div>
    </aside>
  );
}
