"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { Comment01Icon } from "@hugeicons-pro/core-duotone-rounded";

interface CellThreadToggleProps {
  yjsCellId: string;
  isExpanded: boolean;
  onToggle: () => void;
  isHovered: boolean;
}

export function CellThreadToggle({
  yjsCellId,
  isExpanded,
  onToggle,
  isHovered,
}: CellThreadToggleProps) {
  const count = useQuery(api.threads.getCount, { yjsCellId }) ?? 0;
  const hasThreads = count > 0;

  if (!hasThreads && !isHovered && !isExpanded) return null;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "flex items-center gap-0.5 text-muted-foreground transition-colors",
        "hover:text-foreground",
        isExpanded && "text-foreground",
      )}
      title={
        hasThreads ? `${count} comment${count !== 1 ? "s" : ""}` : "Comment"
      }
    >
      <HugeiconsIcon icon={Comment01Icon} size={14} />
      {hasThreads && <span className="text-[10px] tabular-nums">{count}</span>}
    </button>
  );
}
