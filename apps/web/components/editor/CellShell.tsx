"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import * as Y from "yjs";
import type YPartyKitProvider from "y-partykit/provider";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Delete02Icon,
  ArrowUp01Icon,
  ArrowDown01Icon,
} from "@hugeicons-pro/core-duotone-rounded";

import { deleteCell } from "@/lib/ydoc";
import { useCellText } from "@/lib/ydoc-hooks";
import {
  type CellMetadata,
  type CellType,
  AGENT_COLORS,
  AGENT_ROLE_LABELS,
} from "@/types/cells";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

import { CodeCell } from "./CodeCell";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { useCellPresence } from "@/lib/use-cell-presence";
import { CellThreadToggle } from "./CellThreadToggle";
import { CellThreadPanel } from "./CellThreadPanel";

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
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  workspaceId: Id<"workspaces">;
  isRunningExternal?: boolean;
}

export function CellShell({
  cellId,
  metadata,
  ydoc,
  provider,
  isActive,
  onActivate,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  workspaceId,
  isRunningExternal,
}: CellShellProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isThreadExpanded, setIsThreadExpanded] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);

  const isAgent = metadata.authorType === "agent";
  const isPending = metadata.status === "pending";
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

  const handleDelete = useCallback(() => {
    deleteCell(ydoc, cellId);
  }, [ydoc, cellId]);

  const hasOtherUsers = usersInCell.length > 0;

  return (
    <div
      ref={shellRef}
      className="group relative flex flex-col animate-in fade-in duration-150"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onActivate}
    >
      <div className="flex">
        {/* Cell content area */}
        <div
          className={cn(
            "relative min-w-0 flex-1 rounded-lg transition-all duration-150",
            isPending && "cell-shimmer",
          )}
          style={{
            borderLeftColor: isAgent && agentColor ? agentColor : undefined,
            borderLeftWidth: isAgent ? "3px" : undefined,
            borderLeftStyle: isAgent ? "solid" : undefined,
          }}
        >
          {/* Content */}
          <div className="px-4 py-3">
            {isPending ? (
              <div className="flex items-center gap-2 py-3">
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {isAgent ? "Thinking..." : "Loading..."}
                </span>
              </div>
            ) : isCode ? (
              <CodeCell
                cellId={cellId}
                ydoc={ydoc}
                provider={provider}
                language={metadata.language ?? "python"}
                workspaceId={workspaceId}
                isRunningExternal={isRunningExternal}
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

        {/* Right gutter - always visible presence, controls on hover */}
        <div className="flex w-6 flex-shrink-0 flex-col items-center gap-2 py-3">
          {/* Active users in this cell - always visible */}
          {hasOtherUsers && (
            <div className="flex flex-col items-center -space-y-1.5">
              {usersInCell.slice(0, 3).map((user) => (
                <div key={user.clientId} className="group/avatar relative">
                  {user.image ? (
                    <img
                      src={user.image}
                      alt={user.name}
                      className="size-5 rounded-full object-cover ring-2 ring-background"
                    />
                  ) : (
                    <div
                      className="size-5 rounded-full text-[8px] font-semibold leading-5 text-center ring-2 ring-background"
                      style={{
                        backgroundColor: user.color,
                        color: getTextColorForBackground(user.color),
                      }}
                    >
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div
                    className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium opacity-0 transition-opacity group-hover/avatar:opacity-100"
                    style={{
                      backgroundColor: user.color,
                      color: getTextColorForBackground(user.color),
                    }}
                  >
                    {user.name}
                  </div>
                </div>
              ))}
              {usersInCell.length > 3 && (
                <div className="group/avatar relative">
                  <div className="size-5 rounded-full bg-muted text-[8px] font-semibold leading-5 text-center text-muted-foreground">
                    +{usersInCell.length - 3}
                  </div>
                  <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground opacity-0 transition-opacity group-hover/avatar:opacity-100">
                    {usersInCell.length - 3} more
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Thread toggle - always visible when has threads */}
          <CellThreadToggle
            yjsCellId={cellId}
            isExpanded={isThreadExpanded}
            onToggle={() => setIsThreadExpanded((prev) => !prev)}
            isHovered={isHovered}
          />

          {/* Agent badge - visible on hover */}
          {isAgent && metadata.agentRole && (
            <span
              className={cn(
                "rounded px-1 py-0.5 text-[8px] font-medium uppercase tracking-wide transition-opacity duration-100",
                !isHovered && "opacity-0",
              )}
              style={{
                backgroundColor: `${agentColor}15`,
                color: agentColor,
              }}
            >
              {AGENT_ROLE_LABELS[metadata.agentRole].slice(0, 3)}
            </span>
          )}

          {/* Move up/down buttons - visible on hover */}
          {!isAgent && (
            <div
              className={cn(
                "flex flex-col transition-opacity duration-150",
                !isHovered && "opacity-0",
              )}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (canMoveUp) onMoveUp();
                }}
                disabled={!canMoveUp}
                className={cn(
                  "rounded p-1 text-foreground/70 transition-colors hover:bg-muted hover:text-foreground",
                  !canMoveUp && "cursor-not-allowed text-muted-foreground/30",
                )}
                title="Move up"
              >
                <HugeiconsIcon icon={ArrowUp01Icon} size={14} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (canMoveDown) onMoveDown();
                }}
                disabled={!canMoveDown}
                className={cn(
                  "rounded p-1 text-foreground/70 transition-colors hover:bg-muted hover:text-foreground",
                  !canMoveDown && "cursor-not-allowed text-muted-foreground/30",
                )}
                title="Move down"
              >
                <HugeiconsIcon icon={ArrowDown01Icon} size={14} />
              </button>
            </div>
          )}

          {/* Delete button - visible on hover */}
          {!isAgent && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDelete();
              }}
              className={cn(
                "rounded p-1 text-muted-foreground transition-opacity duration-150 hover:bg-destructive/10 hover:text-destructive",
                !isHovered && "opacity-0",
              )}
              title="Delete"
            >
              <HugeiconsIcon icon={Delete02Icon} size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Thread panel - shown below cell when expanded */}
      {isThreadExpanded && (
        <div className="ml-4 mr-10">
          <CellThreadPanel yjsCellId={cellId} workspaceId={workspaceId} />
        </div>
      )}
    </div>
  );
}
