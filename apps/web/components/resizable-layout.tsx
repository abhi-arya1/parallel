"use client";

import { useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { AgentDetailPanel } from "@/components/agent/AgentDetailPanel";
import type { Id } from "@/convex/_generated/dataModel";

const MIN_SIDEBAR_WIDTH = 15;
const MAX_SIDEBAR_WIDTH = 40;
const DEFAULT_SIDEBAR_WIDTH = 18;
const MIN_AGENT_PANEL_WIDTH = 280;
const MAX_AGENT_PANEL_WIDTH = 480;
const DEFAULT_AGENT_PANEL_WIDTH = 360;

interface ResizableLayoutProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  selectedAgentId?: Id<"agents"> | null;
  onCloseAgentPanel?: () => void;
}

export function ResizableLayout({
  sidebar,
  children,
  className,
  selectedAgentId,
  onCloseAgentPanel,
}: ResizableLayoutProps) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [agentPanelWidth, setAgentPanelWidth] = useState(
    DEFAULT_AGENT_PANEL_WIDTH,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingSidebar = useRef(false);
  const isDraggingAgentPanel = useRef(false);

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

  const handleAgentPanelMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingAgentPanel.current = true;
      document.body.style.userSelect = "none";

      const startX = e.clientX;
      const startWidth = agentPanelWidth;

      const onMouseMove = (e: MouseEvent) => {
        if (!isDraggingAgentPanel.current) return;
        const delta = e.clientX - startX;
        const newWidth = startWidth + delta;
        setAgentPanelWidth(
          Math.min(
            MAX_AGENT_PANEL_WIDTH,
            Math.max(MIN_AGENT_PANEL_WIDTH, newWidth),
          ),
        );
      };

      const onMouseUp = () => {
        isDraggingAgentPanel.current = false;
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [agentPanelWidth],
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

      {selectedAgentId && (
        <>
          <aside
            style={{ width: agentPanelWidth }}
            className="flex-shrink-0 flex flex-col overflow-hidden bg-background border-r border-border"
          >
            <AgentDetailPanel
              agentId={selectedAgentId}
              onClose={onCloseAgentPanel}
            />
          </aside>
          <div
            onMouseDown={handleAgentPanelMouseDown}
            className="w-1 flex-shrink-0 cursor-col-resize hover:bg-accent transition-colors"
          />
        </>
      )}

      <main className="flex-1 overflow-hidden min-w-0 bg-background">
        {children}
      </main>
    </div>
  );
}
