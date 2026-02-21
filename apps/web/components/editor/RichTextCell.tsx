"use client";

import { useEffect, useMemo } from "react";
import type * as Y from "yjs";
import type YPartyKitProvider from "y-partykit/provider";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";

import { InlineMath } from "./extensions/InlineMath";
import { BlockMath } from "./extensions/BlockMath";
import { SlashCommand } from "./extensions/SlashCommand";
import { useCellFragment } from "@/lib/ydoc-hooks";
import { type CellType, CELL_TYPE_INFO } from "@/types/cells";

interface RichTextCellProps {
  cellId: string;
  ydoc: Y.Doc;
  provider: YPartyKitProvider | null;
  cellType: CellType;
  onInsertCodeCell?: () => void;
}

export function RichTextCell({
  cellId,
  ydoc,
  provider,
  cellType,
  onInsertCodeCell,
}: RichTextCellProps) {
  // Safely retrieve fragment, waiting for it to be attached to the doc
  const fragment = useCellFragment(ydoc, cellId);

  const placeholderText =
    CELL_TYPE_INFO[cellType]?.placeholder ?? "Write something...";

  // Build extensions
  const extensions = useMemo(() => {
    if (!fragment) return [];

    const exts = [
      StarterKit.configure({}),
      Collaboration.configure({ fragment }),
      Placeholder.configure({
        placeholder: placeholderText,
        emptyNodeClass: "is-editor-empty",
      }),
      Typography,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-primary underline" },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      InlineMath,
      BlockMath,
      SlashCommand,
    ];

    if (provider) {
      exts.push(CollaborationCursor.configure({ provider }));
    }

    return exts;
  }, [fragment, provider, placeholderText]);

  const editor = useEditor(
    {
      extensions,
      editorProps: {
        attributes: {
          class: "tiptap focus:outline-none min-h-[1.5em]",
        },
        handleKeyDown: (_view, event) => {
          // Handle triple backtick to insert code cell
          if (event.key === "`" && onInsertCodeCell) {
            const { state } = _view;
            const { $from } = state.selection;
            const textBefore = $from.parent.textContent.slice(
              0,
              $from.parentOffset,
            );
            if (textBefore.endsWith("``")) {
              const tr = state.tr.delete($from.pos - 2, $from.pos);
              _view.dispatch(tr);
              onInsertCodeCell();
              return true;
            }
          }
          return false;
        },
      },
      immediatelyRender: false,
    },
    [extensions],
  );

  // Cleanup editor on unmount
  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  if (!fragment) {
    return (
      <div className="text-sm text-muted-foreground italic">
        Loading editor...
      </div>
    );
  }

  return (
    <EditorContent
      editor={editor}
      className="prose prose-sm dark:prose-invert max-w-none"
    />
  );
}
