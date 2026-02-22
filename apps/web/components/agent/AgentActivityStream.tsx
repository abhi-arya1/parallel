"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  BrainIcon,
  CheckmarkCircle02Icon,
  Alert02Icon,
  Loading03Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  GlobalSearchIcon,
  SourceCodeIcon,
  ComputerTerminal01Icon,
  FileSearchIcon,
} from "@hugeicons-pro/core-duotone-rounded";
import { MarkdownPreview } from "@/components/editor/MarkdownPreview";

interface Activity {
  id: string;
  type: string;
  content: unknown;
  streamId?: string;
  isPartial?: boolean;
  createdAt: number;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface AgentActivityStreamProps {
  activity: Activity[];
  messages: Message[];
  streamingText?: string;
  isLoading?: boolean;
}

type ToolCard = {
  id: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  status: "pending" | "complete" | "error";
  timestamp: number;
};

type TimelineItem =
  | { type: "activity"; data: Activity; timestamp: number }
  | { type: "tool"; data: ToolCard; timestamp: number }
  | { type: "message"; data: Message; timestamp: number };

function groupActivitiesIntoToolCards(activities: Activity[]): {
  toolCards: Map<string, ToolCard>;
  otherActivities: Activity[];
} {
  const toolCards = new Map<string, ToolCard>();
  const otherActivities: Activity[] = [];
  // Fallback matching for legacy activities without toolCallId
  const toolNameFallbackKeys = new Map<string, string>();

  for (const activity of activities) {
    const content = activity.content as Record<string, unknown> | null;

    if (
      activity.type === "tool-input-start" ||
      activity.type === "tool-call" ||
      activity.type === "tool-result"
    ) {
      const toolName = String(content?.toolName || "unknown");
      const toolCallId = content?.toolCallId ? String(content.toolCallId) : null;
      const fallbackKey = toolNameFallbackKeys.get(toolName);

      if (activity.type === "tool-input-start") {
        // tool-input-start may not have toolCallId — use fallback key
        const key = toolCallId || `${toolName}-${activity.createdAt}`;
        toolNameFallbackKeys.set(toolName, key);
        toolCards.set(key, {
          id: key,
          toolName,
          input: undefined,
          status: "pending",
          timestamp: activity.createdAt,
        });
      } else if (activity.type === "tool-call") {
        // Merge into existing pending card (from tool-input-start) if one exists
        const pendingCard = fallbackKey ? toolCards.get(fallbackKey) : null;
        if (pendingCard && pendingCard.status === "pending") {
          pendingCard.input = content?.input ?? content?.args;
          // Re-key with toolCallId so tool-result can find it
          if (toolCallId && fallbackKey && fallbackKey !== toolCallId) {
            toolCards.delete(fallbackKey);
            pendingCard.id = toolCallId;
            toolCards.set(toolCallId, pendingCard);
            toolNameFallbackKeys.set(toolName, toolCallId);
          }
        } else {
          const key = toolCallId || fallbackKey || `${toolName}-${activity.createdAt}`;
          toolNameFallbackKeys.set(toolName, key);
          toolCards.set(key, {
            id: key,
            toolName,
            input: content?.input ?? content?.args,
            status: "pending",
            timestamp: activity.createdAt,
          });
        }
      } else {
        // tool-result — merge into existing card
        const key = toolCallId || fallbackKey || `${toolName}-${activity.createdAt}`;
        const existing = toolCards.get(key);
        if (existing) {
          existing.output = content?.output ?? content?.result;
          existing.status = "complete";
        } else {
          toolCards.set(key, {
            id: key,
            toolName,
            input: undefined,
            output: content?.output ?? content?.result,
            status: "complete",
            timestamp: activity.createdAt,
          });
        }
        // Clear fallback so next call to same tool gets its own card
        toolNameFallbackKeys.delete(toolName);
      }
    } else {
      otherActivities.push(activity);
    }
  }

  return { toolCards, otherActivities };
}

export function AgentActivityStream({
  activity,
  messages,
  streamingText,
  isLoading,
}: AgentActivityStreamProps) {
  const { toolCards, otherActivities } = groupActivitiesIntoToolCards(activity);

  const items: TimelineItem[] = [];

  for (const act of otherActivities) {
    items.push({ type: "activity", data: act, timestamp: act.createdAt });
  }
  for (const tool of toolCards.values()) {
    items.push({ type: "tool", data: tool, timestamp: tool.timestamp });
  }
  for (const msg of messages) {
    items.push({ type: "message", data: msg, timestamp: msg.timestamp });
  }

  items.sort((a, b) => a.timestamp - b.timestamp);

  if (items.length === 0 && !streamingText && !isLoading) {
    return (
      <div className="flex flex-col h-full p-4">
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <p className="text-sm">No activity yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      {items.map((item, idx) => {
        if (item.type === "activity") {
          return <ActivityItem key={item.data.id} activity={item.data} />;
        }
        if (item.type === "tool") {
          return <ToolCardItem key={item.data.id} tool={item.data} />;
        }
        return <MessageItem key={`msg-${idx}`} message={item.data} />;
      })}

      {streamingText && (
        <div className="relative">
          <MarkdownPreview content={streamingText} compact />
          <span className="inline-block w-1.5 h-4 bg-foreground/70 ml-0.5 animate-pulse align-middle" />
        </div>
      )}

      {isLoading && !streamingText && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <HugeiconsIcon
            icon={Loading03Icon}
            size={14}
            className="animate-spin"
          />
          <span className="text-sm">Thinking...</span>
        </div>
      )}
    </div>
  );
}

function MessageItem({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="bg-muted/50 rounded-lg px-3 py-2">
        <p className="text-sm">{message.content}</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <MarkdownPreview content={message.content} compact />
    </div>
  );
}

const TOOL_META: Record<string, { icon: typeof GlobalSearchIcon; label: string; color: string }> = {
  searchWeb: { icon: GlobalSearchIcon, label: "Web Search", color: "text-blue-500" },
  searchArxiv: { icon: FileSearchIcon, label: "arXiv Search", color: "text-purple-500" },
  extract: { icon: GlobalSearchIcon, label: "Extract", color: "text-cyan-500" },
  executeCode: { icon: SourceCodeIcon, label: "Execute Code", color: "text-amber-500" },
  bash: { icon: ComputerTerminal01Icon, label: "Terminal", color: "text-emerald-500" },
};

function formatData(data: unknown): string {
  if (data === null || data === undefined) return "";
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function ToolInputSummary({ toolName, input }: { toolName: string; input: unknown }) {
  const data = input as Record<string, unknown> | null;
  if (!data) return null;

  switch (toolName) {
    case "searchWeb": {
      const queries = data.queries as string[] | undefined;
      const objective = data.objective as string | undefined;
      return (
        <div className="mt-1.5 space-y-1">
          {objective && <p className="text-[11px] text-muted-foreground italic">{objective}</p>}
          {queries && queries.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {queries.map((q, i) => (
                <span key={i} className="text-[10px] bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded">
                  {q}
                </span>
              ))}
            </div>
          )}
        </div>
      );
    }
    case "searchArxiv": {
      const query = data.query as string | undefined;
      return query ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          <span className="text-purple-500 font-medium">Query:</span> {query}
        </p>
      ) : null;
    }
    case "extract": {
      const urls = data.urls as string[] | undefined;
      const objective = data.objective as string | undefined;
      return (
        <div className="mt-1.5 space-y-1">
          {objective && <p className="text-[11px] text-muted-foreground italic">{objective}</p>}
          {urls && urls.length > 0 && (
            <div className="space-y-0.5">
              {urls.slice(0, 3).map((url, i) => (
                <p key={i} className="text-[10px] text-cyan-600 dark:text-cyan-400 truncate">{url}</p>
              ))}
              {urls.length > 3 && (
                <p className="text-[10px] text-muted-foreground">+{urls.length - 3} more</p>
              )}
            </div>
          )}
        </div>
      );
    }
    case "executeCode": {
      const code = data.code as string | undefined;
      return code ? (
        <pre className="mt-1.5 text-[10px] text-muted-foreground bg-background/50 rounded p-2 overflow-x-auto max-h-24 overflow-y-auto whitespace-pre-wrap break-words font-mono">
          {code.slice(0, 400)}
          {code.length > 400 && "..."}
        </pre>
      ) : null;
    }
    case "bash": {
      const command = data.command as string | undefined;
      return command ? (
        <div className="mt-1.5 flex items-center gap-1.5 bg-background/50 rounded p-1.5">
          <span className="text-emerald-500 text-[10px] font-mono">$</span>
          <code className="text-[10px] text-muted-foreground font-mono truncate">{command}</code>
        </div>
      ) : null;
    }
    default:
      return null;
  }
}

function ToolOutputSummary({ toolName, output }: { toolName: string; output: unknown }) {
  const data = output as Record<string, unknown> | null;
  if (!data) return null;

  if (toolName === "searchWeb" || toolName === "searchArxiv") {
    const answer = data.answer as Record<string, unknown> | undefined;
    const results = (answer?.results ?? answer?.web_results ?? answer?.data) as Array<Record<string, unknown>> | undefined;
    if (results && results.length > 0) {
      return (
        <div className="mt-2 space-y-1.5">
          <p className="text-[10px] text-muted-foreground font-medium">{results.length} results</p>
          {results.slice(0, 3).map((r, i) => (
            <div key={i} className="bg-background/50 rounded p-1.5">
              <p className="text-[10px] font-medium truncate">{String(r.title || r.name || "")}</p>
              {r.url ? <p className="text-[9px] text-muted-foreground truncate">{String(r.url)}</p> : null}
            </div>
          ))}
          {results.length > 3 && (
            <p className="text-[10px] text-muted-foreground">+{results.length - 3} more</p>
          )}
        </div>
      );
    }
  }

  if (toolName === "executeCode" || toolName === "bash") {
    const stdout = data.stdout as string | undefined;
    const stderr = data.stderr as string | undefined;
    const output_text = stdout || stderr || (typeof data.output === "string" ? data.output : null);
    if (output_text) {
      return (
        <pre className="mt-2 text-[10px] bg-background/50 rounded p-2 overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono">
          {output_text.slice(0, 1000)}
          {output_text.length > 1000 && "..."}
        </pre>
      );
    }
  }

  return null;
}

function hasCustomInputContent(toolName: string, input: unknown): boolean {
  if (!input) return false;
  const data = input as Record<string, unknown>;
  switch (toolName) {
    case "searchWeb": return !!(data.queries || data.objective);
    case "searchArxiv": return !!data.query;
    case "extract": return !!(data.urls || data.objective);
    case "executeCode": return !!data.code;
    case "bash": return !!data.command;
    default: return false;
  }
}

function hasCustomOutputContent(toolName: string, output: unknown): boolean {
  if (!output) return false;
  const data = output as Record<string, unknown>;
  if (toolName === "searchWeb" || toolName === "searchArxiv") {
    const answer = data.answer as Record<string, unknown> | undefined;
    const results = answer?.results ?? answer?.web_results ?? answer?.data;
    return Array.isArray(results) && results.length > 0;
  }
  if (toolName === "executeCode" || toolName === "bash") {
    return !!(data.stdout || data.stderr || (typeof data.output === "string"));
  }
  return false;
}

function ToolCardItem({ tool }: { tool: ToolCard }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isPending = tool.status === "pending";
  const meta = TOOL_META[tool.toolName];
  const ToolIcon = meta?.icon;
  const label = meta?.label || tool.toolName;
  const iconColor = meta?.color || "text-muted-foreground";

  const outputStr = formatData(tool.output);
  const hasOutput = outputStr.length > 0;

  const hasCustomInput = hasCustomInputContent(tool.toolName, tool.input);
  const hasCustomOutput = hasCustomOutputContent(tool.toolName, tool.output);

  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors",
        isPending
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-border bg-muted/30",
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isPending ? (
            <HugeiconsIcon
              icon={Loading03Icon}
              size={14}
              className="text-amber-500 animate-spin"
            />
          ) : ToolIcon ? (
            <HugeiconsIcon
              icon={ToolIcon}
              size={14}
              className={iconColor}
            />
          ) : (
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              size={14}
              className="text-emerald-500"
            />
          )}
          <span className="text-xs font-medium">{label}</span>
          {isPending && (
            <span className="text-[10px] text-amber-500">running...</span>
          )}
        </div>
        {hasOutput && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            <HugeiconsIcon
              icon={isExpanded ? ArrowUp01Icon : ArrowDown01Icon}
              size={10}
            />
            {isExpanded ? "raw" : "expand"}
          </button>
        )}
      </div>

      {/* Input summary — always show while pending or if no output yet */}
      {(!hasOutput || isPending) && (
        <ToolInputSummary toolName={tool.toolName} input={tool.input} />
      )}
      {/* Fallback for tools without custom input renderer */}
      {!hasCustomInput && !hasOutput && !!tool.input && (
        <pre className="mt-2 text-[10px] text-muted-foreground bg-background/50 rounded p-2 overflow-x-auto max-h-20 overflow-y-auto whitespace-pre-wrap break-words">
          {formatData(tool.input).slice(0, 200)}
        </pre>
      )}

      {/* Output — custom summary or raw */}
      {hasOutput && !isExpanded && hasCustomOutput && (
        <ToolOutputSummary toolName={tool.toolName} output={tool.output} />
      )}
      {hasOutput && !isExpanded && !hasCustomOutput && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          {outputStr.length} chars
        </p>
      )}
      {hasOutput && isExpanded && (
        <pre className="mt-2 text-[10px] bg-background/50 rounded p-2 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap break-words">
          {outputStr}
        </pre>
      )}
    </div>
  );
}

function ActivityItem({ activity }: { activity: Activity }) {
  const content = activity.content as Record<string, unknown> | null;

  switch (activity.type) {
    case "reasoning": {
      const reasoningText = String(content?.content || "");
      return (
        <div className="relative">
          <MarkdownPreview content={reasoningText} compact />
          {activity.isPartial && (
            <span className="inline-block w-1.5 h-4 bg-foreground/70 ml-0.5 animate-pulse align-middle" />
          )}
        </div>
      );
    }

    case "thinking": {
      const thinkingText = String(
        content?.content || content?.message || "Thinking...",
      );
      return (
        <div className="flex items-start gap-2">
          <HugeiconsIcon
            icon={BrainIcon}
            size={14}
            className="text-blue-500 mt-0.5 flex-shrink-0"
          />
          <p className="text-sm text-muted-foreground">
            {thinkingText}
            {activity.isPartial && (
              <span className="inline-block w-1.5 h-3 bg-current ml-0.5 animate-pulse" />
            )}
          </p>
        </div>
      );
    }

    case "error":
      return (
        <div className="flex items-start gap-2">
          <HugeiconsIcon
            icon={Alert02Icon}
            size={14}
            className="text-red-500 mt-0.5 flex-shrink-0"
          />
          <p className="text-sm text-red-500">
            {String(content?.message || content?.error || "An error occurred")}
          </p>
        </div>
      );

    case "approval": {
      const approved = Boolean(content?.approved);
      return (
        <div className="flex items-center gap-2 text-xs">
          <HugeiconsIcon
            icon={approved ? CheckmarkCircle02Icon : Alert02Icon}
            size={12}
            className={approved ? "text-emerald-500" : "text-orange-500"}
          />
          <span className={approved ? "text-emerald-600" : "text-orange-600"}>
            {approved ? "Approved" : "Rejected"}
          </span>
          {content?.feedback ? (
            <span className="text-muted-foreground">
              — {String(content.feedback)}
            </span>
          ) : null}
        </div>
      );
    }

    case "stopped":
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <HugeiconsIcon icon={Alert02Icon} size={12} />
          <span>{String(content?.message || "Stopped")}</span>
        </div>
      );

    default:
      return null;
  }
}
