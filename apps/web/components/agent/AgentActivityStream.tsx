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
} from "@hugeicons-pro/core-duotone-rounded";
import { MarkdownPreview } from "@/components/editor/MarkdownPreview";
import { Button } from "@/components/ui/button";

interface Activity {
  id: string;
  type: string;
  content: unknown;
  streamId?: string;
  isPartial?: boolean;
  createdAt: number;
}

interface AgentActivityStreamProps {
  activity: Activity[];
  streamingText?: string;
  pendingCode?: string;
  isAwaitingApproval?: boolean;
  onApprove?: () => void;
  onReject?: (feedback?: string) => void;
}

type ToolCard = {
  id: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  status: "pending" | "complete" | "error";
  timestamp: number;
};

function groupActivitiesIntoToolCards(activities: Activity[]): {
  toolCards: Map<string, ToolCard>;
  otherActivities: Activity[];
} {
  const toolCards = new Map<string, ToolCard>();
  const otherActivities: Activity[] = [];
  const toolCallTimestamps = new Map<string, number>();

  for (const activity of activities) {
    const content = activity.content as Record<string, unknown> | null;

    if (activity.type === "tool-call") {
      const toolName = String(content?.toolName || "unknown");
      const key = `${toolName}-${activity.createdAt}`;
      toolCallTimestamps.set(toolName, activity.createdAt);
      toolCards.set(key, {
        id: key,
        toolName,
        input: content?.input ?? content?.args,
        status: "pending",
        timestamp: activity.createdAt,
      });
    } else if (activity.type === "tool-result") {
      const toolName = String(content?.toolName || "unknown");
      const callTimestamp = toolCallTimestamps.get(toolName);
      const key = callTimestamp
        ? `${toolName}-${callTimestamp}`
        : `${toolName}-${activity.createdAt}`;

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
    } else {
      otherActivities.push(activity);
    }
  }

  return { toolCards, otherActivities };
}

export function AgentActivityStream({
  activity,
  streamingText,
  pendingCode,
  isAwaitingApproval,
  onApprove,
  onReject,
}: AgentActivityStreamProps) {
  const { toolCards, otherActivities } = groupActivitiesIntoToolCards(activity);

  const items: Array<
    | { type: "activity"; data: Activity; timestamp: number }
    | { type: "tool"; data: ToolCard; timestamp: number }
  > = [];

  for (const act of otherActivities) {
    items.push({ type: "activity", data: act, timestamp: act.createdAt });
  }
  for (const tool of toolCards.values()) {
    items.push({ type: "tool", data: tool, timestamp: tool.timestamp });
  }

  items.sort((a, b) => a.timestamp - b.timestamp);

  if (items.length === 0 && !streamingText && !isAwaitingApproval) {
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
      {isAwaitingApproval && onApprove && onReject && (
        <div className="sticky top-0 z-10 -mx-4 -mt-4 px-4 pt-4 pb-3 bg-background/95 backdrop-blur border-b border-border mb-3">
          <p className="text-xs font-medium text-orange-500 mb-2">
            Action requires approval
          </p>
          <ApprovalCard
            code={pendingCode}
            onApprove={onApprove}
            onReject={onReject}
          />
        </div>
      )}

      {items.map((item) => {
        if (item.type === "activity") {
          return <ActivityItem key={item.data.id} activity={item.data} />;
        }
        return <ToolCardItem key={item.data.id} tool={item.data} />;
      })}

      {streamingText && (
        <div className="relative">
          <MarkdownPreview content={streamingText} compact />
          <span className="inline-block w-1.5 h-4 bg-foreground/70 ml-0.5 animate-pulse align-middle" />
        </div>
      )}
    </div>
  );
}

function ToolCardItem({ tool }: { tool: ToolCard }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isPending = tool.status === "pending";

  const formatOutput = (data: unknown): string => {
    if (data === null || data === undefined) return "";
    if (typeof data === "string") return data;
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  };

  const outputStr = formatOutput(tool.output);
  const inputStr = formatOutput(tool.input);
  const hasOutput = outputStr.length > 0;

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
          ) : (
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              size={14}
              className="text-emerald-500"
            />
          )}
          <span className="text-xs font-medium">{tool.toolName}</span>
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
            {isExpanded ? "collapse" : "expand"}
          </button>
        )}
      </div>

      {inputStr && !hasOutput && (
        <pre className="mt-2 text-[10px] text-muted-foreground bg-background/50 rounded p-2 overflow-x-auto max-h-20 overflow-y-auto whitespace-pre-wrap break-words">
          {inputStr.slice(0, 200)}
          {inputStr.length > 200 && "..."}
        </pre>
      )}

      {hasOutput && isExpanded && (
        <pre className="mt-2 text-[10px] bg-background/50 rounded p-2 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap break-words">
          {outputStr}
        </pre>
      )}

      {hasOutput && !isExpanded && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          {outputStr.length} chars
        </p>
      )}
    </div>
  );
}

function ApprovalCard({
  code,
  onApprove,
  onReject,
}: {
  code?: string;
  onApprove: () => void;
  onReject: (feedback?: string) => void;
}) {
  const [feedback, setFeedback] = useState("");
  const [isRejecting, setIsRejecting] = useState(false);

  const handleReject = () => {
    if (!isRejecting) {
      setIsRejecting(true);
      return;
    }
    onReject(feedback || undefined);
    setIsRejecting(false);
    setFeedback("");
  };

  return (
    <div className="bg-orange-500/5 border border-orange-500/20 rounded-lg p-3">
      {code && (
        <pre className="text-xs bg-muted rounded p-2 overflow-x-auto max-h-32 overflow-y-auto mb-3">
          <code>{code}</code>
        </pre>
      )}
      {isRejecting && (
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Why are you rejecting? (optional)"
          className="w-full text-sm rounded border border-input bg-background px-2 py-1.5 mb-2 resize-none"
          rows={2}
          autoFocus
        />
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={onApprove}
          className="flex-1 bg-emerald-600 hover:bg-emerald-700 h-7 text-xs"
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant={isRejecting ? "destructive" : "outline"}
          onClick={handleReject}
          className="flex-1 h-7 text-xs"
        >
          {isRejecting ? "Confirm Reject" : "Reject"}
        </Button>
        {isRejecting && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIsRejecting(false)}
            className="h-7 text-xs"
          >
            Cancel
          </Button>
        )}
      </div>
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
