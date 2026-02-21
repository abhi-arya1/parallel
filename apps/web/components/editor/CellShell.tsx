"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import * as Y from "yjs";
import type YPartyKitProvider from "y-partykit/provider";
import {
  MoreHorizontal,
  ArrowUp,
  ArrowDown,
  Trash2,
  RefreshCw,
  Link2,
  Pencil,
} from "lucide-react";

import { updateCellStatus, updateCellType, deleteCell } from "@/lib/ydoc";
import { useCellText } from "@/lib/ydoc-hooks";
import {
  type CellMetadata,
  type CellType,
  type CellStatus,
  AGENT_COLORS,
  AGENT_ROLE_LABELS,
  CELL_TYPE_INFO,
} from "@/types/cells";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { CodeCell } from "./CodeCell";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { useCellPresence } from "@/lib/use-cell-presence";

// Utility to get contrasting text color for a background
function getTextColorForBackground(backgroundColor: string): string {
  const hex = backgroundColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

interface CellShellProps {
  cellId: string;
  metadata: CellMetadata;
  ydoc: Y.Doc;
  provider: YPartyKitProvider | null;
  isActive: boolean;
  onActivate: () => void;
  onInsertBelow: (type: CellType) => void;
  workspaceId: Id<"workspaces">;
}

export function CellShell({
  cellId,
  metadata,
  ydoc,
  provider,
  isActive,
  onActivate,
  onInsertBelow,
  workspaceId,
}: CellShellProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);

  const isAgent = metadata.authorType === "agent";
  const isPending = metadata.status === "pending";
  const isPruned = metadata.status === "pruned";
  const isPromoted = metadata.status === "promoted";
  const isCode = metadata.type === "code";

  // Track other users focused on this cell
  const usersInCell = useCellPresence(provider, cellId);

  // Get Y.Text content for preview mode
  const ytext = useCellText(ydoc, cellId);
  const [previewContent, setPreviewContent] = useState("");

  // Sync preview content from Y.Text
  useEffect(() => {
    if (!ytext) return;
    setPreviewContent(ytext.toString());

    const observer = () => setPreviewContent(ytext.toString());
    ytext.observe(observer);
    return () => ytext.unobserve(observer);
  }, [ytext]);

  // Click outside to exit edit mode (for non-code cells)
  useEffect(() => {
    if (!isEditing || isCode) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (shellRef.current && !shellRef.current.contains(e.target as Node)) {
        setIsEditing(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isEditing, isCode]);

  // Get agent color
  const agentColor = metadata.agentRole
    ? AGENT_COLORS[metadata.agentRole]
    : undefined;

  // Handle status changes
  const handlePromote = useCallback(() => {
    updateCellStatus(ydoc, cellId, "promoted");
  }, [ydoc, cellId]);

  const handleArchive = useCallback(() => {
    updateCellStatus(ydoc, cellId, "pruned");
  }, [ydoc, cellId]);

  const handleRestore = useCallback(() => {
    updateCellStatus(ydoc, cellId, "active");
  }, [ydoc, cellId]);

  const handleDelete = useCallback(() => {
    deleteCell(ydoc, cellId);
  }, [ydoc, cellId]);

  const handleChangeType = useCallback(
    (newType: CellType) => {
      updateCellType(ydoc, cellId, newType);
    },
    [ydoc, cellId],
  );

  // Format timestamp
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  // Pruned state - collapsed view
  if (isPruned) {
    return (
      <div
        className="group relative rounded-lg border border-border/30 p-3 opacity-60"
        style={{ background: "var(--pruned-bg)" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground line-through">
              {CELL_TYPE_INFO[metadata.type].label}
            </span>
            <span className="text-xs text-muted-foreground">(archived)</span>
          </div>
          <button
            onClick={handleRestore}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Restore
          </button>
        </div>
      </div>
    );
  }

  const hasOtherUsers = usersInCell.length > 0 && !isActive;

  return (
    <div
      ref={shellRef}
      className={cn(
        "group relative rounded-lg border transition-all duration-200",
        isActive
          ? "border-border/80 shadow-sm"
          : "border-border/30 hover:border-border/50",
        isPromoted && "border-l-4",
        isPending && "cell-shimmer",
      )}
      style={{
        background: isPromoted ? "var(--promoted-bg)" : "var(--cell-bg)",
        borderLeftColor: isAgent && agentColor ? agentColor : undefined,
        borderLeftWidth: isAgent ? "4px" : undefined,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onActivate}
    >
      {/* Presence indicator - show other users focused on this cell */}
      {hasOtherUsers && (
        <div className="absolute -top-3 right-3 z-10 flex -space-x-1">
          {usersInCell.slice(0, 3).map((user) => (
            <div
              key={user.clientId}
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium shadow-sm"
              style={{
                backgroundColor: user.color,
                color: getTextColorForBackground(user.color),
              }}
            >
              {user.name}
            </div>
          ))}
          {usersInCell.length > 3 && (
            <div className="flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">
              +{usersInCell.length - 3}
            </div>
          )}
        </div>
      )}
      {/* Header - always visible for agent cells, hover for human */}
      <div
        className={cn(
          "flex items-center justify-between border-b border-border/30 px-4 py-2 text-xs",
          !isAgent && !isHovered && "opacity-0",
          "transition-opacity duration-150",
        )}
      >
        <div className="flex items-center gap-2">
          {/* Agent badge */}
          {isAgent && metadata.agentRole && (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{
                backgroundColor: `${agentColor}20`,
                color: agentColor,
              }}
            >
              {AGENT_ROLE_LABELS[metadata.agentRole]}
            </span>
          )}

          {/* Cell type */}
          <span className="text-muted-foreground">
            {CELL_TYPE_INFO[metadata.type].label}
          </span>

          {/* Promoted badge */}
          {isPromoted && (
            <span className="text-[10px] text-emerald-500">promoted</span>
          )}

          {/* Timestamp */}
          <span className="text-muted-foreground/60">
            {formatTime(metadata.createdAt)}
          </span>
        </div>

        {/* Controls */}
        <div
          className={cn(
            "flex items-center gap-0.5",
            !isHovered && "opacity-0",
            "transition-opacity duration-150",
          )}
        >
          {!isPromoted && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                handlePromote();
              }}
              className="text-muted-foreground hover:text-foreground"
              title="Promote"
            >
              <ArrowUp className="size-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              handleArchive();
            }}
            className="text-muted-foreground hover:text-foreground"
            title="Archive"
          >
            <ArrowDown className="size-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                className="text-muted-foreground hover:text-foreground"
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <DropdownMenuItem
                onClick={() => {
                  navigator.clipboard.writeText(
                    `${window.location.href}#cell-${cellId}`,
                  );
                }}
              >
                <Link2 className="size-3.5" />
                Copy link
              </DropdownMenuItem>

              {isAgent && (
                <DropdownMenuItem>
                  <RefreshCw className="size-3.5" />
                  Re-run agent
                </DropdownMenuItem>
              )}

              {!isAgent && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Change type</DropdownMenuLabel>
                  {(
                    [
                      "hypothesis",
                      "finding",
                      "note",
                      "synthesis",
                      "dead-end",
                    ] as CellType[]
                  )
                    .filter((t) => t !== metadata.type && t !== "code")
                    .map((type) => (
                      <DropdownMenuItem
                        key={type}
                        onClick={() => handleChangeType(type)}
                      >
                        <Pencil className="size-3.5" />
                        {CELL_TYPE_INFO[type].label}
                      </DropdownMenuItem>
                    ))}
                </>
              )}

              {!isAgent && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={handleDelete}
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-3">
        {isPending ? (
          <div className="flex items-center gap-2 py-4">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            <span className="text-sm text-muted-foreground">
              {isAgent ? "Agent is thinking..." : "Loading..."}
            </span>
          </div>
        ) : isCode ? (
          <CodeCell
            cellId={cellId}
            ydoc={ydoc}
            provider={provider}
            language={metadata.language ?? "python"}
            workspaceId={workspaceId}
          />
        ) : isEditing ? (
          <MarkdownEditor cellId={cellId} ydoc={ydoc} provider={provider} />
        ) : (
          <div onClick={() => setIsEditing(true)} className="cursor-text">
            <MarkdownPreview content={previewContent} />
          </div>
        )}
      </div>
    </div>
  );
}
