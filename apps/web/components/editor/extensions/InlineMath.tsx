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
    inlineMath: {
      setInlineMath: (latex: string) => ReturnType;
    };
  }
}

/**
 * InlineMath TipTap Node Extension
 *
 * Renders LaTeX math inline using KaTeX.
 * Triggered by typing $...$ followed by a space.
 */
export const InlineMath = Node.create({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-latex") || "",
        renderHTML: (attributes: { latex: string }) => ({
          "data-latex": attributes.latex,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="inline-math"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, string> }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-type": "inline-math" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineMathView);
  },

  addInputRules() {
    return [
      new InputRule({
        // Match $...$ followed by a space
        find: /\$([^$\n]+)\$\s$/,
        handler: ({ state, range, match }) => {
          const latex = match[1];
          if (!latex) return null;

          const { tr } = state;
          tr.replaceWith(range.from, range.to, this.type.create({ latex }));
          return null;
        },
      }),
    ];
  },

  addCommands() {
    return {
      setInlineMath:
        (latex: string) =>
        ({ commands }: { commands: any }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { latex },
          });
        },
    };
  },
});

/**
 * React component for rendering inline math
 */
function InlineMathView(props: NodeViewProps) {
  const { node, updateAttributes, selected } = props;
  const latex = (node.attrs.latex as string) || "";

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(latex);
  const inputRef = useRef<HTMLInputElement>(null);
  const renderRef = useRef<HTMLSpanElement>(null);

  // Render KaTeX
  useEffect(() => {
    if (!isEditing && renderRef.current) {
      try {
        katex.render(latex, renderRef.current, {
          throwOnError: false,
          displayMode: false,
          output: "html",
        });
      } catch {
        renderRef.current.innerHTML = `<span class="math-error">[${latex}]</span>`;
      }
    }
  }, [latex, isEditing]);

  // Focus input when editing
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
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
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      setEditValue(latex);
      setIsEditing(false);
    }
  };

  return (
    <NodeViewWrapper as="span" className="inline">
      {isEditing ? (
        <span className="inline-flex items-center gap-1 rounded bg-muted px-1">
          <span className="text-muted-foreground">$</span>
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            className="w-auto min-w-[60px] bg-transparent text-sm outline-none font-mono"
            style={{ width: `${Math.max(60, editValue.length * 8)}px` }}
          />
          <span className="text-muted-foreground">$</span>
        </span>
      ) : (
        <span
          ref={renderRef}
          onClick={() => setIsEditing(true)}
          className={`math-inline cursor-pointer ${selected ? "ring-2 ring-primary ring-offset-1" : ""}`}
          title="Click to edit"
        />
      )}
    </NodeViewWrapper>
  );
}

export default InlineMath;
