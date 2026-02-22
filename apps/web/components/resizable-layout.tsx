"use client";

import { useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { AgentDetailPanel } from "@/components/agent/AgentDetailPanel";
import { RunsPanel } from "@/components/editor/RunsPanel";
import type { Id } from "@/convex/_generated/dataModel";
import type { AgentRole, AgentState } from "@/components/agent/types";

const MIN_SIDEBAR_WIDTH = 15;
const MAX_SIDEBAR_WIDTH = 40;
const DEFAULT_SIDEBAR_WIDTH = 18;
const MIN_SECONDARY_PANEL_WIDTH = 280;
const MAX_SECONDARY_PANEL_WIDTH = 480;
const DEFAULT_SECONDARY_PANEL_WIDTH = 360;

interface ResizableLayoutProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  selectedAgentRole?: AgentRole | null;
  agents?: Record<AgentRole, AgentState>;
  onCloseAgentPanel?: () => void;
  onSteer?: (role: AgentRole, content: string) => void;
  onClear?: (role: AgentRole) => void;
  onApprove?: (role: AgentRole) => void;
  onReject?: (role: AgentRole, feedback?: string) => void;
  showRunsPanel?: boolean;
  onCloseRunsPanel?: () => void;
  workspaceId?: Id<"workspaces">;
}

export function ResizableLayout({
  sidebar,
  children,
  className,
  selectedAgentRole,
  agents,
  onCloseAgentPanel,
  onSteer,
  onClear,
  showRunsPanel,
  onCloseRunsPanel,
  workspaceId,
}: ResizableLayoutProps) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [secondaryPanelWidth, setSecondaryPanelWidth] = useState(
    DEFAULT_SECONDARY_PANEL_WIDTH,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingSidebar = useRef(false);
  const isDraggingSecondaryPanel = useRef(false);

  const selectedAgent =
    selectedAgentRole && agents ? agents[selectedAgentRole] : null;
  const showSecondaryPanel = selectedAgent || (showRunsPanel && workspaceId);

  const handleSidebarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingSidebar.current = true;
    document.body.style.userSelect = "none";

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingSidebar.current || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth =
        ((e.clientX - containerRect.left) / containerRect.width) * 100;
      setSidebarWidth(
        Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, newWidth)),
      );
    };

    const onMouseUp = () => {
      isDraggingSidebar.current = false;
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, []);

  const handleSecondaryPanelMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingSecondaryPanel.current = true;
      document.body.style.userSelect = "none";

      const startX = e.clientX;
      const startWidth = secondaryPanelWidth;

      const onMouseMove = (e: MouseEvent) => {
        if (!isDraggingSecondaryPanel.current) return;
        const delta = e.clientX - startX;
        const newWidth = startWidth + delta;
        setSecondaryPanelWidth(
          Math.min(
            MAX_SECONDARY_PANEL_WIDTH,
            Math.max(MIN_SECONDARY_PANEL_WIDTH, newWidth),
          ),
        );
      };

      const onMouseUp = () => {
        isDraggingSecondaryPanel.current = false;
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [secondaryPanelWidth],
  );

  return (
    <div ref={containerRef} className={cn("flex h-screen", className)}>
      <aside
        style={{ width: `${sidebarWidth}%` }}
        className="flex-shrink-0 flex flex-col overflow-hidden bg-muted/60 border-r border-border"
      >
        {sidebar}
      </aside>
      <div
        onMouseDown={handleSidebarMouseDown}
        className="w-1 flex-shrink-0 cursor-col-resize hover:bg-accent transition-colors"
      />

      <aside
        style={{ width: showSecondaryPanel ? secondaryPanelWidth : 0 }}
        className={cn(
          "flex-shrink-0 flex flex-col overflow-hidden bg-background border-r border-border transition-[width] duration-200 ease-out",
          !showSecondaryPanel && "border-r-0",
        )}
      >
        {selectedAgent && selectedAgentRole && (
          <AgentDetailPanel
            role={selectedAgentRole}
            status={selectedAgent.status}
            activity={selectedAgent.activity}
            messages={selectedAgent.messages}
            streamingText={selectedAgent.streamingText}
            onSteer={(content) => onSteer?.(selectedAgentRole, content)}
            onClear={() => onClear?.(selectedAgentRole)}
            onClose={onCloseAgentPanel}
          />
        )}
        {showRunsPanel && workspaceId && !selectedAgent && (
          <>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold">Runs</h3>
              <button
                onClick={onCloseRunsPanel}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <RunsPanel workspaceId={workspaceId} />
            </div>
          </>
        )}
      </aside>
      {showSecondaryPanel && (
        <div
          onMouseDown={handleSecondaryPanelMouseDown}
          className="w-1 flex-shrink-0 cursor-col-resize hover:bg-accent transition-colors"
        />
      )}

      <main className="flex-1 overflow-hidden min-w-0 bg-background">
        {children}
      </main>
    </div>
  );
}
