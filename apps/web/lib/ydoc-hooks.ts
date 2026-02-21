"use client";

import { useEffect, useState } from "react";
import * as Y from "yjs";
import { getCellData } from "./ydoc";

/**
 * Hook to safely retrieve a Y.Text from cell data.
 * Waits for the content to be fully attached to the Y.Doc before returning it.
 */
export function useCellText(ydoc: Y.Doc, cellId: string): Y.Text | null {
  const [text, setText] = useState<Y.Text | null>(() => {
    return getCellTextIfReady(ydoc, cellId);
  });

  useEffect(() => {
    const content = getCellTextIfReady(ydoc, cellId);
    if (content) {
      setText(content);
      return;
    }

    // Not ready yet - wait for next frame
    let cancelled = false;
    const tryAgain = () => {
      if (cancelled) return;
      const content = getCellTextIfReady(ydoc, cellId);
      if (content) {
        setText(content);
      } else {
        requestAnimationFrame(tryAgain);
      }
    };
    requestAnimationFrame(tryAgain);

    return () => {
      cancelled = true;
    };
  }, [ydoc, cellId]);

  return text;
}

/**
 * Get cell Y.Text content only if it's ready (attached to the doc).
 */
function getCellTextIfReady(ydoc: Y.Doc, cellId: string): Y.Text | null {
  const cellData = getCellData(ydoc);
  const cell = cellData.get(cellId);
  if (!cell) return null;

  const content = cell.get("content");
  if (content instanceof Y.Text && content.doc) {
    return content;
  }
  return null;
}
