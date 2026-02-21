"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type * as Y from "yjs";
import type YPartyKitProvider from "y-partykit/provider";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as monacoEditor } from "monaco-editor";
import { MonacoBinding } from "y-monaco";
import { useTheme } from "next-themes";
import { Play, ChevronDown } from "lucide-react";

import { getCellData } from "@/lib/ydoc";
import { useCellText } from "@/lib/ydoc-hooks";
import { CODE_LANGUAGES, type CodeLanguage } from "@/types/cells";
import type { Id } from "@/convex/_generated/dataModel";
import { CellOutput } from "./CellOutput";
import { useMonacoCursorStyles } from "@/lib/use-monaco-cursor-styles";

interface CodeCellProps {
  cellId: string;
  ydoc: Y.Doc;
  provider: YPartyKitProvider | null;
  language: string;
  workspaceId: Id<"workspaces">;
}

export function CodeCell({
  cellId,
  ydoc,
  provider,
  language: initialLanguage,
  workspaceId,
}: CodeCellProps) {
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);
  const { resolvedTheme } = useTheme();

  const [language, setLanguage] = useState<CodeLanguage>(
    (initialLanguage as CodeLanguage) || "python",
  );
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [outputs, setOutputs] = useState<
    Array<{ type: string; content: string }>
  >([]);

  const ytext = useCellText(ydoc, cellId);

  // Set up cursor styles for collaboration
  useMonacoCursorStyles(provider?.awareness ?? null, editorRef.current);

  // Update language in Y.js when changed
  const handleLanguageChange = useCallback(
    (newLang: CodeLanguage) => {
      setLanguage(newLang);
      setShowLanguageMenu(false);

      const cellData = getCellData(ydoc);
      const cell = cellData.get(cellId);
      if (cell) {
        cell.set("language", newLang);
      }
    },
    [ydoc, cellId],
  );

  // Run cell handler (placeholder)
  const handleRun = useCallback(() => {
    if (!ytext) return;

    setIsRunning(true);
    setOutputs([]);

    const code = ytext.toString();
    setTimeout(() => {
      setOutputs([
        {
          type: "stdout",
          content: `# Running ${language} code...\n${code}\n\n[Execution not implemented - connect to Modal for real execution]`,
        },
      ]);
      setIsRunning(false);
    }, 500);
  }, [ytext, language]);

  // Bind y-monaco when editor mounts
  const handleEditorMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;

      if (!ytext || !provider) return;

      const model = editor.getModel();
      if (!model) return;

      // Create y-monaco binding with awareness for cursor sync
      bindingRef.current = new MonacoBinding(
        ytext,
        model,
        new Set([editor]),
        provider.awareness,
      );

      // Add keyboard shortcuts for running
      editor.addAction({
        id: "run-cell",
        label: "Run Cell",
        keybindings: [
          monaco.KeyMod.Shift | monaco.KeyCode.Enter,
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        ],
        run: () => handleRun(),
      });
    },
    [ytext, provider, handleRun],
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

    bindingRef.current = new MonacoBinding(
      ytext,
      model,
      new Set([editorRef.current]),
      provider.awareness,
    );
  }, [ytext, provider]);

  if (!ytext) {
    return (
      <div className="text-sm text-muted-foreground">Loading editor...</div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        {/* Language selector */}
        <div className="relative">
          <button
            onClick={() => setShowLanguageMenu(!showLanguageMenu)}
            className="flex items-center gap-1 rounded border border-border/50 bg-transparent px-2 py-1 text-xs text-muted-foreground hover:border-border hover:text-foreground"
          >
            {CODE_LANGUAGES.find((l) => l.value === language)?.label ??
              language}
            <ChevronDown className="h-3 w-3" />
          </button>

          {showLanguageMenu && (
            <div className="absolute left-0 top-full z-50 mt-1 rounded-md border border-border bg-popover p-1 shadow-lg">
              {CODE_LANGUAGES.map((lang) => (
                <button
                  key={lang.value}
                  onClick={() => handleLanguageChange(lang.value)}
                  className="block w-full rounded-sm px-3 py-1.5 text-left text-sm hover:bg-accent"
                >
                  {lang.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Run button */}
        <button
          onClick={handleRun}
          disabled={isRunning}
          className="flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {isRunning ? (
            <>
              <div className="h-3 w-3 animate-spin rounded-full border border-white border-t-transparent" />
              Running...
            </>
          ) : (
            <>
              <Play className="h-3 w-3" />
              Run
            </>
          )}
        </button>
      </div>

      {/* Monaco Editor */}
      <div
        className="overflow-hidden rounded-md border border-border/50"
        style={{ background: "var(--code-bg)" }}
      >
        <Editor
          height="200px"
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
              horizontal: "hidden",
              verticalScrollbarSize: 8,
            },
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            overviewRulerBorder: false,
            automaticLayout: true,
          }}
        />
      </div>

      {/* Outputs */}
      {outputs.length > 0 && <CellOutput outputs={outputs} />}
    </div>
  );
}
