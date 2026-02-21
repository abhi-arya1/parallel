"use client";

import { useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";

const MIN_SIDEBAR_WIDTH = 15; // % of screen
const MAX_SIDEBAR_WIDTH = 40; // % of screen
const DEFAULT_SIDEBAR_WIDTH = 18;

export function ResizableLayout({
  sidebar,
  children,
  className,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.userSelect = "none";

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth =
        ((e.clientX - containerRect.left) / containerRect.width) * 100;
      setSidebarWidth(
        Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, newWidth)),
      );
    };

    const onMouseUp = () => {
      isDragging.current = false;
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, []);

  return (
    <div ref={containerRef} className={cn("flex h-screen", className)}>
      <aside
        style={{ width: `${sidebarWidth}%` }}
        className="flex-shrink-0 flex flex-col overflow-hidden bg-muted/40 border-r border-border/50"
      >
        {sidebar}
      </aside>
      <div
        onMouseDown={handleMouseDown}
        className="w-1 flex-shrink-0 cursor-col-resize"
      />
      <main className="flex-1 overflow-hidden min-w-0">{children}</main>
    </div>
  );
}
