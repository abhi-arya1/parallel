"use client";

import { useRef, useState, useCallback } from "react";
import { ThemeToggle } from "../../components/theme-toggle";

const MIN_SIDEBAR_WIDTH = 15; // % of screen
const MAX_SIDEBAR_WIDTH = 40; // % of screen
const DEFAULT_SIDEBAR_WIDTH = 30;

export default function IdLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth =
        ((e.clientX - containerRect.left) / containerRect.width) * 100;
      setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, newWidth)));
    };

    const onMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, []);

  return (
    <div ref={containerRef} style={{ display: "flex", height: "100vh" }}>
      <aside
        style={{
          width: `${sidebarWidth}%`,
          borderRight: "1px solid color-mix(in srgb, var(--foreground) 20%, transparent)",
          padding: "1rem",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h2>Sidebar</h2>
          <ThemeToggle />
        </div>
      </aside>
      <div
        onMouseDown={handleMouseDown}
        style={{
          width: "4px",
          cursor: "col-resize",
          flexShrink: 0,
          background: "transparent",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background =
            "color-mix(in srgb, var(--foreground) 15%, transparent)")
        }
        onMouseLeave={(e) => {
          if (!isDragging.current)
            e.currentTarget.style.background = "transparent";
        }}
      />
      <main
        style={{
          flex: 1,
          padding: "1rem",
          overflowY: "auto",
          minWidth: 0,
        }}
      >
        {children}
      </main>
    </div>
  );
}
