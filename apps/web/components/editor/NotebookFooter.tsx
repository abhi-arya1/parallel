"use client";

import { Plus } from "lucide-react";
import type { CellType } from "@/types/cells";

interface NotebookFooterProps {
  onInsertCell: (type: CellType) => void;
}

const CELL_BUTTONS: { type: CellType; label: string }[] = [
  { type: "hypothesis", label: "hypothesis" },
  { type: "note", label: "note" },
  { type: "code", label: "code" },
  { type: "synthesis", label: "synthesis" },
];

export function NotebookFooter({ onInsertCell }: NotebookFooterProps) {
  return (
    <div className="mt-8 border-t border-border/50 pt-6">
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Your turn
        </span>
        <div className="h-px flex-1 bg-border/50" />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {CELL_BUTTONS.map(({ type, label }) => (
          <button
            key={type}
            onClick={() => onInsertCell(type)}
            className="flex items-center gap-1.5 rounded-md border border-border/50 bg-cell-bg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-border hover:bg-cell-bg-hover hover:text-foreground"
            style={{
              background: "var(--cell-bg)",
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
