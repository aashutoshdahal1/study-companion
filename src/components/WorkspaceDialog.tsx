import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";

interface WorkspaceDialogProps {
  onCreateWorkspace: (name: string) => Promise<void>;
  children: React.ReactNode;
}

export function WorkspaceDialog({ onCreateWorkspace, children }: WorkspaceDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    setLoading(true);
    try {
      await onCreateWorkspace(name.trim());
      setName("");
      setOpen(false);
    } catch (error) {
      console.error("Failed to create workspace:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create New Workspace</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Create a new workspace to organize your study materials
          </p>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Workspace Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Study Materials, Research Papers"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || loading}>
              {loading ? "Creating..." : "Create Workspace"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CreateWorkspaceButton({ onCreateWorkspace }: { onCreateWorkspace: (name: string) => Promise<void> }) {
  return (
    <WorkspaceDialog onCreateWorkspace={onCreateWorkspace}>
      <Button variant="ghost" size="sm" className="w-full justify-start">
        <Plus className="h-4 w-4 mr-2" />
        New Workspace
      </Button>
    </WorkspaceDialog>
  );
}
