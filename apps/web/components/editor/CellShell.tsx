"use client";

import { useState, useCallback } from "react";
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

import { RichTextCell } from "./RichTextCell";
import { CodeCell } from "./CodeCell";

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
  const [showMenu, setShowMenu] = useState(false);

  const isAgent = metadata.authorType === "agent";
  const isPending = metadata.status === "pending";
  const isPruned = metadata.status === "pruned";
  const isPromoted = metadata.status === "promoted";
  const isCode = metadata.type === "code";

  // Get agent color
  const agentColor = metadata.agentRole
    ? AGENT_COLORS[metadata.agentRole]
    : undefined;

  // Handle status changes
  const handlePromote = useCallback(() => {
    updateCellStatus(ydoc, cellId, "promoted");
    setShowMenu(false);
  }, [ydoc, cellId]);

  const handleArchive = useCallback(() => {
    updateCellStatus(ydoc, cellId, "pruned");
    setShowMenu(false);
  }, [ydoc, cellId]);

  const handleRestore = useCallback(() => {
    updateCellStatus(ydoc, cellId, "active");
    setShowMenu(false);
  }, [ydoc, cellId]);

  const handleDelete = useCallback(() => {
    deleteCell(ydoc, cellId);
    setShowMenu(false);
  }, [ydoc, cellId]);

  const handleChangeType = useCallback(
    (newType: CellType) => {
      updateCellType(ydoc, cellId, newType);
      setShowMenu(false);
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

  return (
    <div
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
      onMouseLeave={() => {
        setIsHovered(false);
        setShowMenu(false);
      }}
      onClick={onActivate}
    >
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
            "flex items-center gap-1",
            !isHovered && "opacity-0",
            "transition-opacity duration-150",
          )}
        >
          {!isPromoted && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handlePromote();
              }}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Promote"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleArchive();
            }}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Archive"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>

            {/* Dropdown menu */}
            {showMenu && (
              <div
                className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(
                      `${window.location.href}#cell-${cellId}`,
                    );
                    setShowMenu(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Copy link
                </button>

                {isAgent && (
                  <button
                    onClick={() => setShowMenu(false)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Re-run agent
                  </button>
                )}

                {!isAgent && (
                  <>
                    <div className="my-1 border-t border-border" />
                    <div className="px-2 py-1 text-xs text-muted-foreground">
                      Change type
                    </div>
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
                        <button
                          key={type}
                          onClick={() => handleChangeType(type)}
                          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          {CELL_TYPE_INFO[type].label}
                        </button>
                      ))}
                  </>
                )}

                {!isAgent && (
                  <>
                    <div className="my-1 border-t border-border" />
                    <button
                      onClick={handleDelete}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
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
        ) : (
          <RichTextCell
            cellId={cellId}
            ydoc={ydoc}
            provider={provider}
            cellType={metadata.type}
            onInsertCodeCell={() => onInsertBelow("code")}
          />
        )}
      </div>
    </div>
  );
}
