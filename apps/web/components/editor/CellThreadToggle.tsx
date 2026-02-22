"use client";

import { useState } from "react";
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
  const [isPrefetching, setIsPrefetching] = useState(false);

  const count = useQuery(api.threads.getCount, { yjsCellId }) ?? 0;
  const hasThreads = count > 0;

  // Prefetch threads data when hovering so the panel animation is smooth
  // The query result gets cached by Convex, so CellThreadPanel will have it ready
  useQuery(
    api.threads.listByCell,
    isPrefetching || isExpanded ? { yjsCellId } : "skip",
  );

  if (!hasThreads && !isHovered && !isExpanded) return null;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onMouseEnter={() => setIsPrefetching(true)}
      onMouseLeave={() => {
        // Keep prefetching if expanded, otherwise stop after a delay
        if (!isExpanded) {
          setTimeout(() => setIsPrefetching(false), 1000);
        }
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
