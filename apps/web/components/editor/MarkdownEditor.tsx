"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
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
const LINE_HEIGHT = 19; // Monaco default line height at 14px font

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
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [isEditorMounted, setIsEditorMounted] = useState(false);

  const ytext = useCellText(ydoc, cellId);

  // Calculate initial height from ytext content to prevent flash
  const initialHeight = useMemo(() => {
    if (!ytext) return MIN_EDITOR_HEIGHT;
    const text = ytext.toString();
    const lineCount = Math.max(1, (text.match(/\n/g) || []).length + 1);
    const contentHeight = lineCount * LINE_HEIGHT + PADDING + 22; // +22 for top padding
    return Math.min(
      Math.max(contentHeight, MIN_EDITOR_HEIGHT),
      MAX_EDITOR_HEIGHT,
    );
  }, [ytext]);

  const [editorHeight, setEditorHeight] = useState(initialHeight);

  // Sync editorHeight with initialHeight when ytext first loads
  useEffect(() => {
    if (!isEditorReady) {
      setEditorHeight(initialHeight);
    }
  }, [initialHeight, isEditorReady]);

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
    (editor) => {
      editorRef.current = editor;
      setIsEditorMounted(true);

      // Set up content height listener for auto-sizing
      editor.onDidContentSizeChange(() => {
        updateEditorHeight(editor);
      });

      // Initial height calculation
      updateEditorHeight(editor);
    },
    [updateEditorHeight],
  );

  // Clean up binding on unmount
  useEffect(() => {
    return () => {
      bindingRef.current?.destroy();
      bindingRef.current = null;
      setIsEditorMounted(false);
    };
  }, []);

  // Create y-monaco binding when ytext, provider, and editor are all available
  useEffect(() => {
    if (!ytext || !isEditorMounted || !editorRef.current || !provider) return;

    // Destroy existing binding if any
    if (bindingRef.current) {
      bindingRef.current.destroy();
    }

    const model = editorRef.current.getModel();
    if (!model) return;

    // Dynamically import y-monaco to avoid SSR issues
    import("y-monaco").then(({ MonacoBinding }) => {
      if (!editorRef.current) return;

      bindingRef.current = new MonacoBinding(
        ytext,
        model,
        new Set([editorRef.current]),
        provider.awareness,
      );

      // Mark editor as ready after binding is set up
      setIsEditorReady(true);
    });
  }, [ytext, provider, isEditorMounted]);

  // Skeleton loader that matches editor dimensions
  const editorSkeleton = (
    <div
      className="animate-pulse"
      style={{ height: `${initialHeight}px`, background: "var(--code-bg)" }}
    >
      <div className="flex h-full items-start pt-6 pl-12 gap-2">
        <div className="space-y-2 flex-1 pr-4">
          <div className="h-3 bg-muted-foreground/10 rounded w-3/4" />
          <div className="h-3 bg-muted-foreground/10 rounded w-1/2" />
          <div className="h-3 bg-muted-foreground/10 rounded w-2/3" />
        </div>
      </div>
    </div>
  );

  if (!ytext) {
    return (
      <div
        className="overflow-hidden rounded-md border border-border/50"
        style={{ background: "var(--code-bg)" }}
      >
        {editorSkeleton}
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-md border border-border/50 relative"
      style={{ background: "var(--code-bg)" }}
    >
      {/* Skeleton shown until editor is ready */}
      <div
        className="absolute inset-0 z-10 transition-opacity duration-150"
        style={{
          opacity: isEditorReady ? 0 : 1,
          pointerEvents: isEditorReady ? "none" : "auto",
        }}
      >
        {editorSkeleton}
      </div>

      {/* Editor fades in when ready */}
      <div
        className="transition-opacity duration-150"
        style={{ opacity: isEditorReady ? 1 : 0 }}
      >
        <Editor
          height={`${editorHeight}px`}
          language="markdown"
          theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
          onMount={handleEditorMount}
          loading={<div style={{ height: `${initialHeight}px` }} />}
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
    </div>
  );
}
