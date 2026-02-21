"use client";

import {
  Node,
  mergeAttributes,
  InputRule,
  type NodeViewProps,
} from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { useState, useEffect, useRef } from "react";
import katex from "katex";

// Import KaTeX CSS
import "katex/dist/katex.min.css";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockMath: {
      setBlockMath: (latex?: string) => ReturnType;
    };
  }
}

/**
 * BlockMath TipTap Node Extension
 *
 * Renders LaTeX math as a centered block using KaTeX.
 * Triggered by typing $$...$$ on its own line or via /math command.
 */
export const BlockMath = Node.create({
  name: "blockMath",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      latex: {
        default: "E = mc^2",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-latex") || "E = mc^2",
        renderHTML: (attributes: { latex: string }) => ({
          "data-latex": attributes.latex,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="block-math"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, string> }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "block-math" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockMathView);
  },

  addInputRules() {
    return [
      new InputRule({
        // Match $$...$$ on its own line
        find: /^\$\$([^$]+)\$\$$/,
        handler: ({ state, range, match }) => {
          const latex = match[1];
          if (!latex) return null;

          const paragraphNode = state.schema.nodes.paragraph;
          if (!paragraphNode) return null;

          const { tr } = state;
          tr.replaceWith(range.from, range.to, [
            this.type.create({ latex: latex.trim() }),
            paragraphNode.create(),
          ]);
          return null;
        },
      }),
    ];
  },

  addCommands() {
    return {
      setBlockMath:
        (latex: string = "E = mc^2") =>
        ({ commands }: { commands: any }) => {
          return commands.insertContent([
            {
              type: this.name,
              attrs: { latex },
            },
            {
              type: "paragraph",
            },
          ]);
        },
    };
  },
});

/**
 * React component for rendering block math
 */
function BlockMathView(props: NodeViewProps) {
  const { node, updateAttributes, selected } = props;
  const latex = (node.attrs.latex as string) || "E = mc^2";

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(latex);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const renderRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // Render KaTeX for display
  useEffect(() => {
    if (!isEditing && renderRef.current) {
      try {
        katex.render(latex, renderRef.current, {
          throwOnError: false,
          displayMode: true,
          output: "html",
        });
      } catch {
        renderRef.current.innerHTML = `<span class="math-error">[LaTeX Error: ${latex}]</span>`;
      }
    }
  }, [latex, isEditing]);

  // Render live preview while editing
  useEffect(() => {
    if (isEditing && previewRef.current && editValue.trim()) {
      try {
        katex.render(editValue, previewRef.current, {
          throwOnError: false,
          displayMode: true,
          output: "html",
        });
      } catch {
        previewRef.current.innerHTML = `<span class="math-error">[Invalid LaTeX]</span>`;
      }
    }
  }, [editValue, isEditing]);

  // Focus and select textarea when editing
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  // Sync edit value when node changes
  useEffect(() => {
    setEditValue(latex);
  }, [latex]);

  const handleSave = () => {
    if (editValue.trim()) {
      updateAttributes({ latex: editValue.trim() });
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      setEditValue(latex);
      setIsEditing(false);
    }
  };

  return (
    <NodeViewWrapper>
      {isEditing ? (
        <div className="my-4 rounded-lg border border-border bg-muted/30 p-4">
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              LaTeX (press Enter to save, Shift+Enter for newline)
            </label>
            <textarea
              ref={textareaRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              className="w-full rounded border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary"
              rows={3}
              placeholder="Enter LaTeX expression..."
            />
          </div>
          <div className="border-t border-border pt-3">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Preview
            </label>
            <div
              ref={previewRef}
              className="math-block min-h-[40px] rounded bg-background p-3"
            />
          </div>
        </div>
      ) : (
        <div
          ref={renderRef}
          onClick={() => setIsEditing(true)}
          className={`math-block my-4 cursor-pointer rounded-lg p-4 transition-colors hover:bg-muted/30 ${
            selected ? "ring-2 ring-primary ring-offset-2" : ""
          }`}
          title="Click to edit"
        />
      )}
    </NodeViewWrapper>
  );
}

export default BlockMath;
