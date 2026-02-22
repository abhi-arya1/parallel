"use client";

import { Check } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Copy01Icon } from "@hugeicons-pro/core-duotone-rounded";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Output {
  type: string;
  content: string;
}

interface CellOutputProps {
  outputs: Output[];
  onClear?: () => void;
  isRunning?: boolean;
  elapsedTime?: number;
  lastRunTime?: number | null;
}

// Format milliseconds to readable string
function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = (seconds % 60).toFixed(0);
  return `${minutes}m ${remainingSeconds}s`;
}

export function CellOutput({
  outputs,
  onClear,
  isRunning,
  elapsedTime,
  lastRunTime,
}: CellOutputProps) {
  // Show timer even if no outputs yet (when running)
  const hasTimer = isRunning || lastRunTime !== null;

  if (outputs.length === 0 && !hasTimer) return null;

  // Separate images/dataframes from terminal output
  const terminalOutputs = outputs.filter(
    (o) => o.type !== "image" && o.type !== "dataframe",
  );
  const images = outputs.filter((o) => o.type === "image");
  const dataframes = outputs.filter((o) => o.type === "dataframe");

  // Combine all terminal output into a single stream
  const terminalContent = terminalOutputs
    .map((o) => ({ type: o.type, content: o.content }))
    .filter((o) => o.content.trim() !== "");

  // Copy all text outputs to clipboard
  const handleCopy = () => {
    const text = terminalContent.map((o) => o.content).join("\n");
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  return (
    <div className="group/output relative border-t border-border/30">
      {/* Header with timer and action buttons */}
      <div className="flex items-center justify-between px-4 py-1.5">
        {/* Timer */}
        <div className="flex items-center gap-2">
          {isRunning ? (
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-muted-foreground border-t-transparent" />
          ) : hasTimer ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : null}
          {hasTimer && (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {isRunning
                ? formatTime(elapsedTime ?? 0)
                : formatTime(lastRunTime!)}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/output:opacity-100">
          {terminalContent.length > 0 && (
            <button
              onClick={handleCopy}
              className="rounded p-1 text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground"
              title="Copy output"
            >
              <HugeiconsIcon icon={Copy01Icon} size={14} />
            </button>
          )}
          {onClear && (
            <button
              onClick={onClear}
              className="rounded p-1 text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground"
              title="Clear outputs"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={14} />
            </button>
          )}
        </div>
      </div>

      {/* No output indicator */}
      {outputs.length === 0 && !isRunning && hasTimer && (
        <div className="px-4 py-2 text-[11px] text-muted-foreground/60 italic">
          No output
        </div>
      )}

      {/* Terminal output area */}
      {terminalContent.length > 0 && (
        <div className="max-h-[1000px] overflow-y-auto px-4 py-2 font-mono text-[11px] leading-normal">
          {terminalContent.map((output, index) => (
            <TerminalLine key={index} output={output} />
          ))}
        </div>
      )}

      {/* Images - rendered below terminal */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-3 px-4 py-3">
          {images.map((img, index) => {
            const imgSrc = img.content.startsWith("data:")
              ? img.content
              : `data:image/png;base64,${img.content}`;
            return (
              <img
                key={index}
                src={imgSrc}
                alt="Output"
                className="max-h-[400px] rounded-md"
              />
            );
          })}
        </div>
      )}

      {/* Dataframes - rendered as tables */}
      {dataframes.map((df, index) => (
        <DataframeTable key={index} content={df.content} />
      ))}
    </div>
  );
}

interface TerminalLineProps {
  output: { type: string; content: string };
}

function TerminalLine({ output }: TerminalLineProps) {
  const isError = output.type === "stderr" || output.type === "error";
  const isResult = output.type === "result";

  // Render content with preserved whitespace
  return (
    <span
      className={cn(
        "whitespace-pre-wrap",
        isError && "text-red-500 dark:text-red-400",
        isResult && "text-blue-600 dark:text-blue-400",
        !isError && !isResult && "text-foreground/80",
      )}
    >
      {output.content}
    </span>
  );
}

interface DataframeTableProps {
  content: string;
}

function DataframeTable({ content }: DataframeTableProps) {
  try {
    const data = JSON.parse(content);
    if (!Array.isArray(data) || data.length === 0) return null;

    return (
      <div className="overflow-x-auto px-4 py-3">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b border-border/50">
              {Object.keys(data[0] || {}).map((key) => (
                <th
                  key={key}
                  className="px-3 py-2 text-left font-medium text-muted-foreground"
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
                <tr
                  key={i}
                  className="border-b border-border/20 transition-colors hover:bg-muted/30"
                >
                  {Object.values(row).map((val, j) => (
                    <td key={j} className="px-3 py-1.5">
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
    return null;
  }
}
