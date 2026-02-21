"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import * as Y from "yjs";
import type YPartyKitProvider from "y-partykit/provider";
import { Trash2 } from "lucide-react";

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
  workspaceId,
}: CellShellProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
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
      className="group relative flex"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onActivate}
    >
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
        {/* Presence indicator - show other users focused on this cell */}
        {hasOtherUsers && (
          <div className="absolute -top-2.5 right-2 z-10 flex -space-x-1">
            {usersInCell.slice(0, 3).map((user) => (
              <div
                key={user.clientId}
                className="rounded-full px-1.5 py-0.5 text-[9px] font-medium shadow-sm"
                style={{
                  backgroundColor: user.color,
                  color: getTextColorForBackground(user.color),
                }}
              >
                {user.name.split(" ")[0]}
              </div>
            ))}
            {usersInCell.length > 3 && (
              <div className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                +{usersInCell.length - 3}
              </div>
            )}
          </div>
        )}

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

      {/* Right gutter - controls appear on hover */}
      <div
        className={cn(
          "flex w-6 flex-shrink-0 flex-col items-center gap-1.5 pt-3 transition-opacity duration-100",
          !isHovered && "opacity-0",
        )}
      >
        {/* Agent badge */}
        {isAgent && metadata.agentRole && (
          <span
            className="rounded px-1 py-0.5 text-[8px] font-medium uppercase tracking-wide"
            style={{
              backgroundColor: `${agentColor}15`,
              color: agentColor,
            }}
          >
            {AGENT_ROLE_LABELS[metadata.agentRole].slice(0, 3)}
          </span>
        )}

        {/* Delete button */}
        {!isAgent && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDelete();
            }}
            className="rounded p-1.5 text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive"
            title="Delete"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
