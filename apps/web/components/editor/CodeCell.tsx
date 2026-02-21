"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type * as Y from "yjs";
import type YPartyKitProvider from "y-partykit/provider";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
} from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { yCollab } from "y-codemirror.next";
import { Play, ChevronDown } from "lucide-react";

import { getCellData } from "@/lib/ydoc";
import { useCellText } from "@/lib/ydoc-hooks";
import { CODE_LANGUAGES, type CodeLanguage } from "@/types/cells";
import type { Id } from "@/convex/_generated/dataModel";
import { CellOutput } from "./CellOutput";

interface CodeCellProps {
  cellId: string;
  ydoc: Y.Doc;
  provider: YPartyKitProvider | null;
  language: string;
  workspaceId: Id<"workspaces">;
}

// Language extension mapping
const languageExtensions: Record<string, () => ReturnType<typeof python>> = {
  python: python,
  javascript: javascript,
  r: () => markdown(), // R doesn't have a built-in extension, use markdown as fallback
};

export function CodeCell({
  cellId,
  ydoc,
  provider,
  language: initialLanguage,
  workspaceId,
}: CodeCellProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const mountedRef = useRef(false);

  const [language, setLanguage] = useState<CodeLanguage>(
    (initialLanguage as CodeLanguage) || "python",
  );
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [outputs, setOutputs] = useState<
    Array<{ type: string; content: string }>
  >([]);

  // Safely retrieve Y.Text, waiting for it to be attached to the doc
  const ytext = useCellText(ydoc, cellId);

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

  // Run cell handler (placeholder - actual execution would go through Modal)
  const handleRun = useCallback(() => {
    if (!ytext) return;

    setIsRunning(true);
    setOutputs([]);

    // Simulate execution (in production this would call Modal)
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

  // Initialize CodeMirror
  useEffect(() => {
    if (!containerRef.current || !ytext || !provider || mountedRef.current)
      return;
    mountedRef.current = true;

    const langExtension = languageExtensions[language] ?? python;

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          // Shift+Enter to run
          {
            key: "Shift-Enter",
            run: () => {
              handleRun();
              return true;
            },
          },
          // Cmd/Ctrl+Enter to run
          {
            key: "Mod-Enter",
            run: () => {
              handleRun();
              return true;
            },
          },
        ]),
        langExtension(),
        oneDark,
        EditorView.lineWrapping,
        EditorView.theme({
          "&": {
            fontSize: "14px",
            backgroundColor: "var(--code-bg)",
          },
          ".cm-content": {
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
            padding: "12px 0",
          },
          ".cm-gutters": {
            backgroundColor: "var(--code-bg)",
            borderRight: "1px solid var(--border)",
          },
          ".cm-activeLine": {
            backgroundColor: "rgba(255, 255, 255, 0.03)",
          },
          ".cm-activeLineGutter": {
            backgroundColor: "rgba(255, 255, 255, 0.05)",
          },
        }),
        // Y.js collaboration
        yCollab(ytext, provider.awareness),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      mountedRef.current = false;
    };
  }, [ytext, provider, language, handleRun]);

  if (!ytext) {
    return (
      <div className="text-sm text-muted-foreground">
        Loading code editor...
      </div>
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

      {/* Editor */}
      <div
        ref={containerRef}
        className="overflow-hidden rounded-md border border-border/50"
        style={{ background: "var(--code-bg)" }}
      />

      {/* Outputs */}
      {outputs.length > 0 && <CellOutput outputs={outputs} />}
    </div>
  );
}
