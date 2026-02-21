"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import type YPartyKitProvider from "y-partykit/provider";
import { usePreloadedQuery } from "convex/react";
import type { Preloaded } from "convex/react";

import { createYDoc, getCellOrder, getCellData, createCell } from "@/lib/ydoc";
import { createProvider, createAwarenessUser } from "@/lib/yjs-provider";
import type { CellType, CellMetadata, AwarenessUser } from "@/types/cells";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

import { CellShell } from "./CellShell";
import { NotebookFooter } from "./NotebookFooter";

interface NotebookEditorProps {
  workspaceId: string;
  preloadedUser: Preloaded<typeof api.users.currentUser>;
  preloadedWorkspace: Preloaded<typeof api.workspaces.get>;
}

export function NotebookEditor({
  workspaceId,
  preloadedUser,
  preloadedWorkspace,
}: NotebookEditorProps) {
  const user = usePreloadedQuery(preloadedUser);
  const workspace = usePreloadedQuery(preloadedWorkspace);

  // Y.js state
  const [ydoc] = useState(() => createYDoc());
  const [provider, setProvider] = useState<YPartyKitProvider | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [cellIds, setCellIds] = useState<string[]>([]);
  const [connectedUsers, setConnectedUsers] = useState<AwarenessUser[]>([]);
  const [activeCellId, setActiveCellId] = useState<string | null>(null);

  // Create awareness user from Convex user
  const awarenessUser = useMemo(() => {
    if (!user) return null;
    return createAwarenessUser(
      user._id,
      user.name ?? "Anonymous",
      user.email ?? undefined,
    );
  }, [user]);

  // Initialize Y.js provider
  useEffect(() => {
    if (!awarenessUser) return;

    const newProvider = createProvider(workspaceId, ydoc, awarenessUser);

    // Wait for initial sync
    const handleSync = (synced: boolean) => {
      if (synced) {
        setIsReady(true);
        // Initialize cell IDs from Y.js
        const order = getCellOrder(ydoc);
        setCellIds([...order.toArray()]);
      }
    };

    newProvider.on("sync", handleSync);

    // Track connected users
    const handleAwareness = () => {
      const states = newProvider.awareness.getStates();
      const users: AwarenessUser[] = [];
      states.forEach((state) => {
        if (state.user && state.user.id && state.user.id !== awarenessUser.id) {
          // Ensure user has required fields
          users.push({
            id: state.user.id,
            name: state.user.name ?? "Anonymous",
            color: state.user.color ?? "#60A5FA",
            email: state.user.email,
          });
        }
      });
      setConnectedUsers(users);
    };

    newProvider.awareness.on("change", handleAwareness);

    setProvider(newProvider);

    return () => {
      newProvider.off("sync", handleSync);
      newProvider.awareness.off("change", handleAwareness);
      newProvider.destroy();
    };
  }, [ydoc, workspaceId, awarenessUser]);

  // Subscribe to cell order changes
  useEffect(() => {
    if (!isReady) return;

    const cellOrder = getCellOrder(ydoc);
    const observer = () => {
      setCellIds([...cellOrder.toArray()]);
    };

    cellOrder.observe(observer);
    return () => cellOrder.unobserve(observer);
  }, [ydoc, isReady]);

  // Get cell metadata from Y.js
  const getCellMetadataById = useCallback(
    (cellId: string): CellMetadata | null => {
      const cellData = getCellData(ydoc);
      const cell = cellData.get(cellId);
      if (!cell) return null;

      return {
        id: cellId,
        type: (cell.get("type") as CellType) ?? "note",
        authorType: (cell.get("authorType") as "human" | "agent") ?? "human",
        authorId: (cell.get("authorId") as string) ?? "",
        agentRole: cell.get("agentRole") as CellMetadata["agentRole"],
        status: (cell.get("status") as CellMetadata["status"]) ?? "active",
        createdAt: (cell.get("createdAt") as number) ?? Date.now(),
        language: cell.get("language") as string | undefined,
      };
    },
    [ydoc],
  );

  // Insert a new cell
  const handleInsertCell = useCallback(
    (type: CellType, afterCellId?: string) => {
      if (!user) return;

      const newCellId = createCell(
        ydoc,
        {
          type,
          authorType: "human",
          authorId: user._id,
          language: type === "code" ? "python" : undefined,
        },
        afterCellId,
      );

      // Focus the new cell
      setActiveCellId(newCellId);
    },
    [ydoc, user],
  );

  // Loading state
  if (!isReady || !user || !workspace) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading notebook...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col"
      style={{ background: "var(--notebook-bg)" }}
    >
      {/* Connected users indicator */}
      {connectedUsers.length > 0 && (
        <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2">
          <span className="text-xs text-muted-foreground">
            {connectedUsers.length} other{connectedUsers.length > 1 ? "s" : ""}{" "}
            viewing
          </span>
          <div className="flex -space-x-1">
            {connectedUsers.slice(0, 5).map((u) => (
              <div
                key={u.id}
                className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium text-white"
                style={{ backgroundColor: u.color ?? "#60A5FA" }}
                title={u.name ?? "Anonymous"}
              >
                {(u.name ?? "?").charAt(0).toUpperCase()}
              </div>
            ))}
            {connectedUsers.length > 5 && (
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
                +{connectedUsers.length - 5}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cell list */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 py-6">
          {/* Workspace title */}
          <h1 className="mb-6 font-serif text-2xl font-semibold text-foreground">
            {workspace.title}
          </h1>

          {/* Cells */}
          <div className="space-y-4">
            {cellIds.map((cellId) => {
              const metadata = getCellMetadataById(cellId);
              if (!metadata) return null;

              return (
                <CellShell
                  key={cellId}
                  cellId={cellId}
                  metadata={metadata}
                  ydoc={ydoc}
                  provider={provider}
                  isActive={activeCellId === cellId}
                  onActivate={() => setActiveCellId(cellId)}
                  onInsertBelow={(type) => handleInsertCell(type, cellId)}
                  workspaceId={workspaceId as Id<"workspaces">}
                />
              );
            })}
          </div>

          {/* Empty state */}
          {cellIds.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="mb-4 text-muted-foreground">
                Start your research by adding a hypothesis or note.
              </p>
            </div>
          )}

          {/* Footer with add buttons */}
          <NotebookFooter onInsertCell={handleInsertCell} />
        </div>
      </div>
    </div>
  );
}
