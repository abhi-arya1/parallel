"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type * as Y from "yjs";
import type YPartyKitProvider from "y-partykit/provider";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as monacoEditor } from "monaco-editor";
import type { MonacoBinding } from "y-monaco";
import { useTheme } from "next-themes";
import { Play } from "lucide-react";
import { useQuery, useMutation } from "convex/react";

import { useCellText } from "@/lib/ydoc-hooks";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { CellOutput } from "./CellOutput";
import { useMonacoCursorStyles } from "@/lib/use-monaco-cursor-styles";
import { executeCellStreaming } from "@/lib/sandbox";
import { Kbd } from "@/components/ui/kbd";
import { toast } from "sonner";

const MIN_EDITOR_HEIGHT = 60;
const MAX_EDITOR_HEIGHT = 800;
const PADDING = 30; // top + bottom padding

// Hook for live elapsed time counter
function useElapsedTime(isRunning: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (isRunning) {
      startTimeRef.current = Date.now();
      setElapsed(0);

      const interval = setInterval(() => {
        if (startTimeRef.current) {
          setElapsed(Date.now() - startTimeRef.current);
        }
      }, 100);

      return () => clearInterval(interval);
    } else {
      startTimeRef.current = null;
    }
  }, [isRunning]);

  return elapsed;
}

interface CodeCellProps {
  cellId: string;
  ydoc: Y.Doc;
  provider: YPartyKitProvider | null;
  language: string;
  workspaceId: Id<"workspaces">;
  isRunningExternal?: boolean;
}

export function CodeCell({
  cellId,
  ydoc,
  provider,
  language: initialLanguage,
  workspaceId,
  isRunningExternal = false,
}: CodeCellProps) {
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);
  const [isEditorMounted, setIsEditorMounted] = useState(false);
  const { resolvedTheme } = useTheme();

  const language = "python";
  const [isRunning, setIsRunning] = useState(false);
  const [localOutputs, setLocalOutputs] = useState<
    Array<{ type: string; content: string }>
  >([]);
  const [lastRunTime, setLastRunTime] = useState<number | null>(null);
  const [editorHeight, setEditorHeight] = useState(MIN_EDITOR_HEIGHT);

  const ytext = useCellText(ydoc, cellId);

  // Combined running state (local run or external Run All)
  const isExecuting = isRunning || isRunningExternal;

  // Live elapsed time counter while running
  const elapsed = useElapsedTime(isExecuting);

  // Subscribe to cell outputs from Convex (real-time updates)
  const convexData = useQuery(api.cells.getOutputs, { yjsCellId: cellId });
  const clearOutputsMutation = useMutation(api.cells.clearOutputs);
  const updateRunTimeMutation = useMutation(api.cells.updateRunTime);

  // Extract outputs and persisted run time from Convex
  const convexOutputs = convexData?.outputs ?? [];
  const persistedRunTime = convexData?.lastRunTimeMs ?? null;

  // Merge local outputs (immediate feedback) with Convex outputs (persisted)
  // Local outputs take priority while running, then Convex takes over after sync
  const outputs =
    localOutputs.length > 0
      ? localOutputs
      : convexOutputs.map((o) => ({
          type: o.type,
          content: o.content,
        }));

  // Use local run time while running, otherwise use persisted
  const displayRunTime = lastRunTime ?? persistedRunTime;

  // Clear outputs handler
  const handleClearOutputs = useCallback(() => {
    setLocalOutputs([]);
    clearOutputsMutation({ yjsCellId: cellId });
    toast.success("Outputs cleared");
  }, [cellId, clearOutputsMutation]);

  // Set up cursor styles for collaboration
  useMonacoCursorStyles(provider?.awareness ?? null, editorRef.current);

  // Run cell handler - calls the sandbox server with streaming
  const handleRun = useCallback(async () => {
    if (!ytext) return;

    // Skip empty cells
    const code = ytext.toString().trim();
    if (!code) {
      toast.info("Cell is empty");
      return;
    }

    const startTime = Date.now();
    setIsRunning(true);
    setLocalOutputs([]);
    setLastRunTime(null);

    // Accumulator for streaming stdout
    let stdoutAccumulator = "";

    try {
      await executeCellStreaming(workspaceId, cellId, {
        onStdout: (data) => {
          stdoutAccumulator += data;
          setLocalOutputs((prev) => {
            // Update or create stdout output
            const existing = prev.find((o) => o.type === "stdout");
            if (existing) {
              return prev.map((o) =>
                o.type === "stdout" ? { ...o, content: stdoutAccumulator } : o,
              );
            }
            return [...prev, { type: "stdout", content: stdoutAccumulator }];
          });
        },
        onStderr: (data) => {
          setLocalOutputs((prev) => [
            ...prev,
            { type: "stderr", content: data },
          ]);
        },
        onImage: (dataUrl) => {
          setLocalOutputs((prev) => [
            ...prev,
            { type: "image", content: dataUrl },
          ]);
        },
        onResult: (result) => {
          setLocalOutputs((prev) => [
            ...prev,
            { type: result.type, content: result.content },
          ]);
        },
        onError: (error) => {
          setLocalOutputs((prev) => [
            ...prev,
            { type: "error", content: error },
          ]);
        },
        onDone: () => {
          const runTime = Date.now() - startTime;
          setLastRunTime(runTime);
          setIsRunning(false);
          // Persist run time to Convex
          updateRunTimeMutation({ yjsCellId: cellId, runTimeMs: runTime });
        },
      });
    } catch (error) {
      setLocalOutputs((prev) => [
        ...prev,
        {
          type: "error",
          content: `Failed to execute: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      ]);
      setLastRunTime(Date.now() - startTime);
      setIsRunning(false);
    }
  }, [ytext, workspaceId, cellId, updateRunTimeMutation]);

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

  // Set up editor when it mounts (binding handled separately in useEffect)
  const handleEditorMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      setIsEditorMounted(true);

      // Set up content height listener for auto-sizing
      editor.onDidContentSizeChange(() => {
        updateEditorHeight(editor);
      });

      // Initial height calculation
      updateEditorHeight(editor);

      // Add keyboard shortcuts for running
      editor.addAction({
        id: "run-cell",
        label: "Run Cell",
        keybindings: [
          monaco.KeyMod.Shift | monaco.KeyCode.Enter,
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyR,
        ],
        run: () => {
          handleRun();
        },
      });
    },
    [handleRun, updateEditorHeight],
  );

  // Clean up binding and editor on unmount
  useEffect(() => {
    return () => {
      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }
      if (editorRef.current) {
        editorRef.current.dispose();
        editorRef.current = null;
      }
      setIsEditorMounted(false);
    };
  }, []);

  // Create y-monaco binding when ytext, provider, and editor are all available
  useEffect(() => {
    if (!ytext || !isEditorMounted || !editorRef.current || !provider) return;

    // Skip if binding already exists for this ytext
    if (bindingRef.current) return;

    const model = editorRef.current.getModel();
    if (!model) return;

    // Dynamically import y-monaco to avoid SSR issues
    import("y-monaco").then(({ MonacoBinding }) => {
      // Double-check we still need to create it (async race condition)
      if (bindingRef.current) return;
      if (!editorRef.current) return;

      bindingRef.current = new MonacoBinding(
        ytext,
        model,
        new Set([editorRef.current]),
        provider.awareness,
      );
    });
  }, [ytext, provider, isEditorMounted]);

  // Clear local outputs when Convex outputs update (they're now persisted)
  useEffect(() => {
    if (convexOutputs?.length) {
      setLocalOutputs([]);
    }
  }, [convexOutputs]);

  if (!ytext) {
    return (
      <div className="text-sm text-muted-foreground">Loading editor...</div>
    );
  }

  return (
    <div className="group space-y-2">
      {/* Toolbar */}
      <div className="flex items-center justify-end gap-2">
        {/* Run button */}
        <button
          onClick={handleRun}
          disabled={isExecuting}
          className="flex h-6 items-center gap-1 rounded bg-emerald-600 px-2.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {isExecuting ? (
            <>
              <div className="h-3 w-3 animate-spin rounded-full border border-white border-t-transparent" />
              Running...
            </>
          ) : (
            <>
              <Play className="h-3 w-3" />
              Run
              <Kbd
                keys="command"
                className="ml-1 bg-white/15 border-white/20 text-white/90"
              >
                R
              </Kbd>
            </>
          )}
        </button>
      </div>

      {/* Monaco Editor + Output - single container */}
      <div
        className="overflow-hidden rounded-md border border-border/50"
        style={{ background: "var(--code-bg)" }}
      >
        <Editor
          height={`${editorHeight}px`}
          language={language}
          theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
          onMount={handleEditorMount}
          options={{
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
        {(outputs.length > 0 || isExecuting || displayRunTime !== null) && (
          <CellOutput
            outputs={outputs}
            onClear={handleClearOutputs}
            isRunning={isExecuting}
            elapsedTime={elapsed}
            lastRunTime={displayRunTime}
          />
        )}
      </div>
    </div>
  );
}
