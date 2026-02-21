"use client";

import { Streamdown } from "streamdown";
import { createMathPlugin } from "@streamdown/math";
import { useEffect, useState } from "react";
import { codeToHtml } from "shiki";
import "katex/dist/katex.min.css";

// Enable single dollar sign math syntax ($...$) in addition to double ($$...$$)
const math = createMathPlugin({
  singleDollarTextMath: true,
});

// Shiki-powered code block component
function ShikiCodeBlock({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  const [html, setHtml] = useState<string | null>(null);

  // Extract language from className (e.g., "language-python" -> "python")
  const lang = className?.replace("language-", "") || "text";
  const code = typeof children === "string" ? children : String(children || "");

  useEffect(() => {
    let cancelled = false;

    codeToHtml(code.trim(), {
      lang,
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
    })
      .then((result) => {
        if (!cancelled) setHtml(result);
      })
      .catch(() => {
        // Fallback to plain text on error
        if (!cancelled) setHtml(null);
      });

    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  if (html) {
    // Strip inline background-color from Shiki output
    const cleanedHtml = html
      .replace(/background-color:[^;]+;?/g, "")
      .replace(/--shiki-dark-bg:[^;]+;?/g, "")
      .replace(/--shiki-light-bg:[^;]+;?/g, "");

    return (
      <div
        className="shiki-code rounded-lg overflow-x-auto my-3 text-[0.875em] leading-relaxed bg-[var(--code-bg)] p-3 [&_pre]:!p-0 [&_pre]:!m-0 [&_pre]:!border-0"
        dangerouslySetInnerHTML={{ __html: cleanedHtml }}
      />
    );
  }

  // Fallback while loading or on error
  return (
    <pre className="bg-[var(--code-bg)] rounded-lg p-3 overflow-x-auto my-3 text-[0.875em] leading-relaxed">
      <code>{code}</code>
    </pre>
  );
}

// Simple pre wrapper that renders code children with Shiki
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CodeBlockWrapper(props: any) {
  const child = props.children;

  // Check if the child is a <code> element with a language class
  if (child?.props?.className?.startsWith("language-")) {
    return (
      <ShikiCodeBlock className={child.props.className}>
        {child.props.children}
      </ShikiCodeBlock>
    );
  }

  // Fallback for plain pre blocks
  return (
    <pre className="bg-[var(--code-bg)] rounded-lg p-3 overflow-x-auto my-3 text-[0.875em] leading-relaxed">
      {props.children}
    </pre>
  );
}

interface MarkdownPreviewProps {
  content: string;
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  if (!content.trim()) {
    return <p className="text-sm italic text-muted-foreground">Empty text</p>;
  }

  return (
    <div className="markdown-preview prose prose-sm dark:prose-invert max-w-none px-1">
      <Streamdown
        plugins={{ math }}
        components={{
          pre: CodeBlockWrapper,
        }}
      >
        {content}
      </Streamdown>
    </div>
  );
}
