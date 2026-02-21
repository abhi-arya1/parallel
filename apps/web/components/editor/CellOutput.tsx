"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Output {
  type: string;
  content: string;
}

interface CellOutputProps {
  outputs: Output[];
  onClear?: () => void;
}

export function CellOutput({ outputs, onClear }: CellOutputProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [expandedOutputs, setExpandedOutputs] = useState<Set<number>>(
    new Set([0]),
  );

  const toggleOutput = (index: number) => {
    const newExpanded = new Set(expandedOutputs);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedOutputs(newExpanded);
  };

  if (outputs.length === 0) return null;

  return (
    <div
      className="rounded-md border border-border/50 overflow-hidden"
      style={{ background: "var(--code-bg)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-1.5">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          Output ({outputs.length})
        </button>
        {onClear && (
          <button
            onClick={onClear}
            className="text-muted-foreground hover:text-foreground"
            title="Clear outputs"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Output content */}
      {isExpanded && (
        <div className="max-h-[400px] overflow-y-auto">
          {outputs.map((output, index) => (
            <OutputBlock
              key={index}
              output={output}
              isExpanded={expandedOutputs.has(index)}
              onToggle={() => toggleOutput(index)}
              isLast={index === outputs.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface OutputBlockProps {
  output: Output;
  isExpanded: boolean;
  onToggle: () => void;
  isLast: boolean;
}

function OutputBlock({
  output,
  isExpanded,
  onToggle,
  isLast,
}: OutputBlockProps) {
  const isError = output.type === "stderr" || output.type === "error";
  const isImage = output.type === "image";
  const isDataframe = output.type === "dataframe";

  // Count lines
  const lines = output.content.split("\n");
  const lineCount = lines.length;
  const shouldTruncate = lineCount > 20;
  const displayContent =
    shouldTruncate && !isExpanded
      ? lines.slice(0, 20).join("\n") + "\n..."
      : output.content;

  if (isImage) {
    return (
      <div className={cn("p-3", !isLast && "border-b border-border/30")}>
        <img
          src={`data:image/png;base64,${output.content}`}
          alt="Output"
          className="max-h-[300px] rounded"
        />
      </div>
    );
  }

  if (isDataframe) {
    try {
      const data = JSON.parse(output.content);
      return (
        <div
          className={cn(
            "overflow-x-auto p-3",
            !isLast && "border-b border-border/30",
          )}
        >
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50">
                {Object.keys(data[0] || {}).map((key) => (
                  <th
                    key={key}
                    className="px-2 py-1 text-left font-medium text-muted-foreground"
                  >
                    {key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data
                .slice(0, 10)
                .map((row: Record<string, unknown>, i: number) => (
                  <tr key={i} className="border-b border-border/30">
                    {Object.values(row).map((val, j) => (
                      <td key={j} className="px-2 py-1">
                        {String(val)}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
          {data.length > 10 && (
            <div className="mt-2 text-xs text-muted-foreground">
              Showing 10 of {data.length} rows
            </div>
          )}
        </div>
      );
    } catch {
      // Fall through to text rendering
    }
  }

  return (
    <div className={cn(!isLast && "border-b border-border/30")}>
      <pre
        className={cn(
          "overflow-x-auto p-3 text-xs font-mono whitespace-pre-wrap",
          isError && "text-red-400 border-l-2 border-red-500",
        )}
      >
        {displayContent}
      </pre>
      {shouldTruncate && (
        <button
          onClick={onToggle}
          className="w-full border-t border-border/30 px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent/50"
        >
          {isExpanded ? "Show less" : `Show all ${lineCount} lines`}
        </button>
      )}
    </div>
  );
}
