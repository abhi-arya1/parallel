"use client";

import {
  useEffect,
  useState,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import type YPartyKitProvider from "y-partykit/provider";
import { usePreloadedQuery } from "convex/react";
import type { Preloaded } from "convex/react";

import {
  createYDoc,
  getCellOrder,
  getCellData,
  createCell,
  moveCell,
  exportToMarkdown,
} from "@/lib/ydoc";
import { createProvider, createAwarenessUser } from "@/lib/yjs-provider";
import { useBroadcastCellFocus } from "@/lib/use-cell-presence";
import type { CellType, CellMetadata, AwarenessUser } from "@/types/cells";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

import { CellShell } from "./CellShell";
import { NotebookFooter } from "./NotebookFooter";
import { executeCellStreaming } from "@/lib/sandbox";

export interface NotebookEditorRef {
  runAll: () => void;
  exportMarkdown: () => string;
}

interface NotebookEditorProps {
  workspaceId: string;
  preloadedUser: Preloaded<typeof api.users.currentUser>;
  preloadedWorkspace: Preloaded<typeof api.workspaces.get>;
  onRunAllStart?: () => void;
  onRunAllEnd?: () => void;
}

export const NotebookEditor = forwardRef<
  NotebookEditorRef,
  NotebookEditorProps
>(function NotebookEditor(
  {
    workspaceId,
    preloadedUser,
    preloadedWorkspace,
    onRunAllStart,
    onRunAllEnd,
  },
  ref,
) {
  const user = usePreloadedQuery(preloadedUser);
  const workspace = usePreloadedQuery(preloadedWorkspace);

  // Y.js state
  const [ydoc] = useState(() => createYDoc());
  const [provider, setProvider] = useState<YPartyKitProvider | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [cellIds, setCellIds] = useState<string[]>([]);
  const [connectedUsers, setConnectedUsers] = useState<AwarenessUser[]>([]);
  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [runningCellId, setRunningCellId] = useState<string | null>(null);

  // Broadcast which cell is focused to other users
  useBroadcastCellFocus(provider, activeCellId);

  // Create awareness user from Convex user
  const awarenessUser = useMemo(() => {
    if (!user) return null;
    return createAwarenessUser(
      user._id,
      user.name ?? "Anonymous",
      user.email ?? undefined,
      user.image ?? undefined,
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
        type: (cell.get("type") as CellType) ?? "markdown",
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

  // Move a cell up (swap with the cell above)
  const handleMoveUp = useCallback(
    (cellId: string) => {
      const currentIndex = cellIds.indexOf(cellId);
      if (currentIndex <= 0) return;

      // To move up, we place this cell after the cell that is 2 positions above
      // (or at the beginning if it's the second cell)
      const afterCellId =
        currentIndex === 1 ? null : (cellIds[currentIndex - 2] ?? null);

      // Use requestAnimationFrame to ensure any pending Monaco renders complete
      // before we trigger the Y.js update that will reorder cells
      requestAnimationFrame(() => {
        moveCell(ydoc, cellId, afterCellId);
      });
    },
    [ydoc, cellIds],
  );

  // Move a cell down (swap with the cell below)
  const handleMoveDown = useCallback(
    (cellId: string) => {
      const currentIndex = cellIds.indexOf(cellId);
      if (currentIndex === -1 || currentIndex >= cellIds.length - 1) return;

      // To move down, we place this cell after the cell below it
      const afterCellId = cellIds[currentIndex + 1];
      if (afterCellId === undefined) return;

      // Use requestAnimationFrame to ensure any pending Monaco renders complete
      // before we trigger the Y.js update that will reorder cells
      requestAnimationFrame(() => {
        moveCell(ydoc, cellId, afterCellId);
      });
    },
    [ydoc, cellIds],
  );

  // Run all cells sequentially using streaming
  const handleRunAll = useCallback(async () => {
    if (isRunningAll) return;

    setIsRunningAll(true);
    onRunAllStart?.();

    try {
      // Get all code cells in order
      const cellData = getCellData(ydoc);
      const codeCellIds = cellIds.filter((id) => {
        const cell = cellData.get(id);
        return cell?.get("type") === "code";
      });

      // Execute each code cell sequentially
      for (const cellId of codeCellIds) {
        setRunningCellId(cellId);
        await new Promise<void>((resolve) => {
          executeCellStreaming(workspaceId, cellId, {
            onDone: () => resolve(),
            onError: (error) => {
              console.error(`Error in cell ${cellId}:`, error);
              resolve(); // Continue to next cell even on error
            },
          });
        });
      }
    } catch (error) {
      console.error("Failed to run all cells:", error);
    } finally {
      setRunningCellId(null);
      setIsRunningAll(false);
      onRunAllEnd?.();
    }
  }, [workspaceId, cellIds, ydoc, isRunningAll, onRunAllStart, onRunAllEnd]);

  // Keyboard shortcut: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows/Linux) to run all cells
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows/Linux)
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key === "r"
      ) {
        event.preventDefault();
        handleRunAll();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleRunAll]);

  // Export to markdown
  const handleExportMarkdown = useCallback(() => {
    return exportToMarkdown(ydoc);
  }, [ydoc]);

  // Expose methods via ref
  useImperativeHandle(
    ref,
    () => ({
      runAll: handleRunAll,
      exportMarkdown: handleExportMarkdown,
    }),
    [handleRunAll, handleExportMarkdown],
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
      {/* Cell list */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 pt-[60px] pb-6">
          {/* Cells */}
          <div className="space-y-1">
            {cellIds.map((cellId, index) => {
              const metadata = getCellMetadataById(cellId);
              if (!metadata) return null;

              // Use cellId + index as key to force remount when position changes
              // This prevents Monaco editor DOM corruption when cells are reordered
              return (
                <CellShell
                  key={`${cellId}-${index}`}
                  cellId={cellId}
                  metadata={metadata}
                  ydoc={ydoc}
                  provider={provider}
                  isActive={activeCellId === cellId}
                  onActivate={() => setActiveCellId(cellId)}
                  onInsertBelow={(type) => handleInsertCell(type, cellId)}
                  onMoveUp={() => handleMoveUp(cellId)}
                  onMoveDown={() => handleMoveDown(cellId)}
                  canMoveUp={index > 0}
                  canMoveDown={index < cellIds.length - 1}
                  workspaceId={workspaceId as Id<"workspaces">}
                  isRunningExternal={runningCellId === cellId}
                />
              );
            })}
          </div>

          {/* Footer with add buttons */}
          <NotebookFooter
            onInsertCell={handleInsertCell}
            isEmpty={cellIds.length === 0}
          />
        </div>
      </div>
    </div>
  );
});
