import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface NewNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (subject: string) => void;
}

export function NewNoteDialog({ open, onOpenChange, onConfirm }: NewNoteDialogProps) {
  const [subject, setSubject] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setSubject("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onConfirm(subject.trim());
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New Class Note</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="subject">Subject / Course name</Label>
            <Input
              id="subject"
              ref={inputRef}
              placeholder="e.g. Physics, Maths, Chemistry"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Create Note</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
