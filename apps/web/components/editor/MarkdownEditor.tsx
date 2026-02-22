"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type * as Y from "yjs";
import type YPartyKitProvider from "y-partykit/provider";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as monacoEditor } from "monaco-editor";
import type { MonacoBinding } from "y-monaco";
import { useTheme } from "next-themes";

import { useCellText } from "@/lib/ydoc-hooks";
import { useMonacoCursorStyles } from "@/lib/use-monaco-cursor-styles";

const MIN_EDITOR_HEIGHT = 60;
const MAX_EDITOR_HEIGHT = 800;
const PADDING = 30;

interface MarkdownEditorProps {
  cellId: string;
  ydoc: Y.Doc;
  provider: YPartyKitProvider | null;
  readOnly?: boolean;
}

export function MarkdownEditor({
  cellId,
  ydoc,
  provider,
  readOnly = false,
}: MarkdownEditorProps) {
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);
  const { resolvedTheme } = useTheme();
  const [editorHeight, setEditorHeight] = useState(MIN_EDITOR_HEIGHT);

  const ytext = useCellText(ydoc, cellId);

  // Set up cursor styles for collaboration
  useMonacoCursorStyles(provider?.awareness ?? null, editorRef.current);

  // Update editor height based on content
  const updateEditorHeight = useCallback(
    (editor: monacoEditor.IStandaloneCodeEditor) => {
      const contentHeight = editor.getContentHeight();
      const newHeight = Math.min(
        Math.max(contentHeight + PADDING, MIN_EDITOR_HEIGHT),
        MAX_EDITOR_HEIGHT,
      );
      setEditorHeight(newHeight);
    },
    [],
  );

  // Bind y-monaco when editor mounts
  const handleEditorMount: OnMount = useCallback(
    async (editor) => {
      editorRef.current = editor;

      // Set up content height listener for auto-sizing
      editor.onDidContentSizeChange(() => {
        updateEditorHeight(editor);
      });

      // Initial height calculation
      updateEditorHeight(editor);

      if (!ytext || !provider) return;

      const model = editor.getModel();
      if (!model) return;

      // Dynamically import y-monaco to avoid SSR issues
      const { MonacoBinding } = await import("y-monaco");

      // Create y-monaco binding with awareness for cursor sync
      bindingRef.current = new MonacoBinding(
        ytext,
        model,
        new Set([editor]),
        provider.awareness,
      );
    },
    [ytext, provider, updateEditorHeight],
  );

  // Clean up binding on unmount
  useEffect(() => {
    return () => {
      bindingRef.current?.destroy();
      bindingRef.current = null;
    };
  }, []);

  // Re-bind when ytext or provider becomes available after initial mount
  useEffect(() => {
    if (!ytext || !editorRef.current || !provider) return;

    // Destroy existing binding if any
    if (bindingRef.current) {
      bindingRef.current.destroy();
    }

    const model = editorRef.current.getModel();
    if (!model) return;

    // Dynamically import y-monaco to avoid SSR issues
    import("y-monaco").then(({ MonacoBinding }) => {
      bindingRef.current = new MonacoBinding(
        ytext,
        model,
        new Set([editorRef.current!]),
        provider.awareness,
      );
    });
  }, [ytext, provider]);

  if (!ytext) {
    return (
      <div className="text-sm text-muted-foreground">Loading editor...</div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-md border border-border/50"
      style={{ background: "var(--code-bg)" }}
    >
      <Editor
        height={`${editorHeight}px`}
        language="markdown"
        theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
        onMount={handleEditorMount}
        options={{
          readOnly,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          lineNumbers: "on",
          glyphMargin: false,
          folding: true,
          lineDecorationsWidth: 10,
          lineNumbersMinChars: 3,
          renderLineHighlight: "line",
          wordWrap: "on",
          padding: { top: 22, bottom: 8 },
          fontSize: 14,
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          scrollbar: {
            vertical: "auto",
            horizontal: "auto",
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
            useShadows: false,
          },
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          overviewRulerBorder: false,
          automaticLayout: true,
        }}
      />
    </div>
  );
}
