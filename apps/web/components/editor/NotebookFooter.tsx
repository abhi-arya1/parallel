"use client";

import type { CellType } from "@/types/cells";

interface NotebookFooterProps {
  onInsertCell: (type: CellType) => void;
  isEmpty?: boolean;
}

export function NotebookFooter({ onInsertCell, isEmpty }: NotebookFooterProps) {
  return (
    <div className="mt-3 flex flex-col items-center py-2">
      {isEmpty && (
        <p className="mb-5 text-2xl text-muted-foreground font-serif">
          What should we research today?
        </p>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => onInsertCell("markdown")}
          className="rounded-md border border-border/50 px-3 py-1 text-sm text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
        >
          + Markdown
        </button>
        <button
          onClick={() => onInsertCell("code")}
          className="rounded-md border border-border/50 px-3 py-1 text-sm text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
        >
          + Code
        </button>
      </div>
    </div>
  );
}
