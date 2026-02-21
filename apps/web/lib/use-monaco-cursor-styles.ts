"use client";

import { useEffect } from "react";
import type { editor } from "monaco-editor";

// Awareness type from y-partykit
interface Awareness {
  clientID: number;
  getStates(): Map<number, Record<string, unknown>>;
  on(event: "update", handler: () => void): void;
  off(event: "update", handler: () => void): void;
}

/**
 * Utility function to determine text color for background
 */
function getTextColorForBackground(backgroundColor: string): string {
  const hex = backgroundColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

/**
 * Hook to inject y-monaco cursor styles and handle dynamic user colors
 */
export function useMonacoCursorStyles(
  awareness: Awareness | null,
  editorInstance: editor.IStandaloneCodeEditor | null,
) {
  // Inject base cursor styles
  useEffect(() => {
    const styleId = "y-monaco-cursor-styles";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .yRemoteSelection {
        background-color: rgba(250, 129, 0, 0.5);
        pointer-events: none;
        user-select: none;
      }
      .yRemoteSelectionHead {
        position: absolute;
        margin-left: -1px;
        margin-right: -1px;
        border-left: 2px solid orange;
        border-right: 2px solid orange;
        height: 100%;
        box-sizing: border-box;
        pointer-events: none;
      }
      .yRemoteSelectionHead::after {
        content: '';
        position: absolute;
        top: 0;
        left: -1px;
        width: 2px;
        height: 1.2em;
        background: currentColor;
      }
    `;
    document.head.appendChild(style);

    return () => {
      const existingStyle = document.getElementById(styleId);
      if (existingStyle) {
        existingStyle.remove();
      }
    };
  }, []);

  // Update cursor styles based on connected users
  useEffect(() => {
    if (!awareness) return;

    const updateCursorStyles = () => {
      const states = awareness.getStates();
      const localClientId = awareness.clientID;
      const styleId = "y-monaco-user-styles";
      let existingStyle = document.getElementById(styleId);

      if (!existingStyle) {
        existingStyle = document.createElement("style");
        existingStyle.id = styleId;
        document.head.appendChild(existingStyle);
      }

      // Hide local user's cursor
      let css = `
        .yRemoteSelection-${localClientId},
        .yRemoteSelectionHead-${localClientId} {
          display: none !important;
        }
      `;

      states.forEach((state: Record<string, unknown>, clientId: number) => {
        if (clientId === localClientId) return;

        const user = state.user as { color?: string } | undefined;
        if (user?.color) {
          css += `
            .yRemoteSelection-${clientId} {
              background-color: ${user.color}80 !important;
            }
            .yRemoteSelectionHead-${clientId} {
              border-left-color: ${user.color} !important;
              border-right-color: ${user.color} !important;
            }
            .yRemoteSelectionHead-${clientId}::after {
              background-color: ${user.color} !important;
            }
          `;
        }
      });

      existingStyle.textContent = css;
    };

    awareness.on("update", updateCursorStyles);
    updateCursorStyles();

    return () => {
      awareness.off("update", updateCursorStyles);
    };
  }, [awareness]);

  // Add user name labels to remote cursors using MutationObserver
  useEffect(() => {
    if (!awareness || !editorInstance) return;

    const editorContainer = editorInstance.getDomNode();
    if (!editorContainer) return;

    const labeledCursors = new WeakSet<Element>();

    const addNameLabels = () => {
      const states = awareness.getStates();
      const localClientId = awareness.clientID;

      states.forEach((state: Record<string, unknown>, clientId: number) => {
        if (clientId === localClientId) return;

        const user = state.user as
          | { name?: string; color?: string }
          | undefined;
        if (!user?.name) return;

        const cursorHead = editorContainer.querySelector(
          `.yRemoteSelectionHead-${clientId}`,
        );

        if (cursorHead && !labeledCursors.has(cursorHead)) {
          labeledCursors.add(cursorHead);

          const userColor = user.color || "#6366F1";
          const textColor = getTextColorForBackground(userColor);

          const nameLabel = document.createElement("div");
          nameLabel.className = "yRemoteCursorLabel";
          nameLabel.textContent = user.name;
          nameLabel.style.cssText = `
            position: absolute;
            bottom: 100%;
            left: -2px;
            background-color: ${userColor};
            color: ${textColor};
            padding: 2px 6px;
            border-radius: 3px 3px 3px 0;
            font-size: 11px;
            font-weight: 600;
            white-space: nowrap;
            pointer-events: none;
            z-index: 10000;
            line-height: 1.2;
            user-select: none;
            transform: translateY(-2px);
          `;

          cursorHead.appendChild(nameLabel);
        }
      });
    };

    const handleAwarenessUpdate = () => {
      addNameLabels();
    };

    // Run initially
    addNameLabels();

    // Watch for DOM changes
    const observer = new MutationObserver(() => {
      addNameLabels();
    });

    observer.observe(editorContainer, {
      childList: true,
      subtree: true,
    });

    awareness.on("update", handleAwarenessUpdate);

    return () => {
      observer.disconnect();
      awareness.off("update", handleAwarenessUpdate);
    };
  }, [awareness, editorInstance]);
}
