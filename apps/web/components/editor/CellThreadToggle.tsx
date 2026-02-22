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

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "relative rounded p-1 text-muted-foreground transition-all duration-150",
        "hover:bg-muted hover:text-foreground",
        isExpanded && "bg-muted text-foreground",
        !hasThreads && !isHovered && !isExpanded && "opacity-0",
      )}
      title={
        hasThreads ? `${count} comment${count !== 1 ? "s" : ""}` : "Add comment"
      }
    >
      <HugeiconsIcon icon={Comment01Icon} size={14} />
      {hasThreads && (
        <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-medium text-primary-foreground">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}
