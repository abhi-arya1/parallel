"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Upload04Icon } from "@hugeicons-pro/core-duotone-rounded";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  parseJupyterNotebook,
  readFileAsText,
  type ParsedNotebook,
} from "@/lib/jupyter";

interface ImportNotebookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportNotebookDialog({
  open,
  onOpenChange,
}: ImportNotebookDialogProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedNotebook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const createFromImport = useMutation(api.workspaces.createFromImport);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setParsed(null);

    try {
      const content = await readFileAsText(file);
      const notebook = parseJupyterNotebook(content, file.name);
      setParsed(notebook);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse notebook");
    }
  };

  const handleImport = async () => {
    if (!parsed) return;

    setImporting(true);
    setError(null);

    try {
      const workspaceId = await createFromImport({
        title: parsed.title,
        cells: parsed.cells,
      });
      onOpenChange(false);
      router.push(`/projects/${workspaceId}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to import notebook",
      );
      setImporting(false);
    }
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      setParsed(null);
      setError(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
    onOpenChange(open);
  };

  const codeCount = parsed?.cells.filter((c) => c.type === "code").length ?? 0;
  const markdownCount =
    parsed?.cells.filter((c) => c.type === "markdown").length ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Jupyter Notebook</DialogTitle>
          <DialogDescription>
            Upload a .ipynb file to create a new project with its cells.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept=".ipynb"
          onChange={handleFileChange}
          className="hidden"
        />

        {!parsed ? (
          <Button
            variant="outline"
            className="w-full h-24 border-dashed"
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="flex flex-col items-center gap-2">
              <HugeiconsIcon
                icon={Upload04Icon}
                size={24}
                className="text-muted-foreground"
              />
              <span className="text-sm text-muted-foreground">
                Click to select .ipynb file
              </span>
            </div>
          </Button>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-md bg-muted/50">
              <Image
                src="/jupyter.png"
                alt="Jupyter"
                width={20}
                height={20}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{parsed.title}</p>
                <p className="text-xs text-muted-foreground">
                  {codeCount} code cell{codeCount !== 1 ? "s" : ""},{" "}
                  {markdownCount} markdown cell{markdownCount !== 1 ? "s" : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  Language: {parsed.language}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setParsed(null);
                  if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                  }
                }}
              >
                Change
              </Button>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button onClick={handleImport} disabled={importing}>
                {importing ? "Importing..." : "Import"}
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
