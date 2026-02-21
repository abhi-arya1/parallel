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
    const content = getCellContentIfReady(ydoc, cellId);
    return content instanceof Y.Text ? content : null;
  });

  useEffect(() => {
    const content = getCellContentIfReady(ydoc, cellId);
    if (content instanceof Y.Text) {
      setText(content);
      return;
    }

    // Not ready yet - wait for next frame
    let cancelled = false;
    const tryAgain = () => {
      if (cancelled) return;
      const content = getCellContentIfReady(ydoc, cellId);
      if (content instanceof Y.Text) {
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
 * Hook to safely retrieve a Y.XmlFragment from cell data.
 * Waits for the content to be fully attached to the Y.Doc before returning it.
 */
export function useCellFragment(
  ydoc: Y.Doc,
  cellId: string,
): Y.XmlFragment | null {
  const [fragment, setFragment] = useState<Y.XmlFragment | null>(() => {
    const content = getCellContentIfReady(ydoc, cellId);
    return content instanceof Y.XmlFragment ? content : null;
  });

  useEffect(() => {
    const content = getCellContentIfReady(ydoc, cellId);
    if (content instanceof Y.XmlFragment) {
      setFragment(content);
      return;
    }

    // Not ready yet - wait for next frame
    let cancelled = false;
    const tryAgain = () => {
      if (cancelled) return;
      const content = getCellContentIfReady(ydoc, cellId);
      if (content instanceof Y.XmlFragment) {
        setFragment(content);
      } else {
        requestAnimationFrame(tryAgain);
      }
    };
    requestAnimationFrame(tryAgain);

    return () => {
      cancelled = true;
    };
  }, [ydoc, cellId]);

  return fragment;
}

/**
 * Get cell content only if it's ready (attached to the doc).
 * Returns null if the cell or content doesn't exist or isn't attached yet.
 */
function getCellContentIfReady(
  ydoc: Y.Doc,
  cellId: string,
): Y.XmlFragment | Y.Text | null {
  const cellData = getCellData(ydoc);
  const cell = cellData.get(cellId);
  if (!cell) return null;

  const content = cell.get("content") as Y.XmlFragment | Y.Text | undefined;
  // Ensure content exists and is attached to the doc
  if (content && content.doc) {
    return content;
  }
  return null;
}
