"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  BrainIcon,
  CodeIcon,
  CheckmarkCircle02Icon,
  Alert02Icon,
  File01Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
} from "@hugeicons-pro/core-duotone-rounded";
import { formatDistanceToNow } from "date-fns";
import { MarkdownPreview } from "@/components/editor/MarkdownPreview";
import { Button } from "@/components/ui/button";

interface AgentActivityStreamProps {
  agentId: Id<"agents">;
}

export function AgentActivityStream({ agentId }: AgentActivityStreamProps) {
  const activities = useQuery(api.agents.getActivityStream, {
    agentId,
    limit: 50,
  });
  const agent = useQuery(api.agents.get, { agentId });

  const isAwaitingApproval = agent?.status === "awaiting_approval";

  if (!activities || activities.length === 0) {
    return (
      <div className="flex flex-col h-full p-4">
        {isAwaitingApproval && (
          <div className="mb-4">
            <ApprovalCard agentId={agentId} code={agent?.pendingCode} />
          </div>
        )}
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <p className="text-sm">No activity yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      {isAwaitingApproval && (
        <div className="sticky top-0 z-10 -mx-4 -mt-4 px-4 pt-4 pb-3 bg-background/95 backdrop-blur border-b border-border mb-3">
          <p className="text-xs font-medium text-orange-500 mb-2">
            Action requires approval
          </p>
          <ApprovalCard agentId={agentId} code={agent?.pendingCode} />
        </div>
      )}
      {activities.map((activity) => (
        <ActivityItem
          key={activity._id}
          activity={activity}
          agentId={agentId}
        />
      ))}
    </div>
  );
}

interface ActivityItemProps {
  activity: {
    _id: Id<"activity_stream">;
    contentType: string;
    content: unknown;
    timestamp: number;
    isPartial?: boolean;
  };
  agentId: Id<"agents">;
}

function ToolResultCard({ output }: { output: unknown }) {
  const [isExpanded, setIsExpanded] = useState(false);

  let content: string;
  if (output === null || output === undefined) {
    content = "";
  } else if (typeof output === "string") {
    content = output;
  } else {
    try {
      content = JSON.stringify(output, null, 2);
    } catch {
      content = String(output);
    }
  }

  if (!content) return null;

  const isLong = content.length > 300;
  const displayContent =
    isLong && !isExpanded ? content.slice(0, 300) + "..." : content;

  return (
    <div className="mt-1">
      <pre className="text-xs bg-muted rounded p-2 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap break-words">
        <code>{displayContent}</code>
      </pre>
      {isLong && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1"
        >
          <HugeiconsIcon
            icon={isExpanded ? ArrowUp01Icon : ArrowDown01Icon}
            size={12}
          />
          {isExpanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function ApprovalCard({
  agentId,
  code,
}: {
  agentId: Id<"agents">;
  code?: string;
}) {
  const [feedback, setFeedback] = useState("");
  const [isRejecting, setIsRejecting] = useState(false);
  const approveAction = useMutation(api.agents.approveAction);
  const rejectAction = useMutation(api.agents.rejectAction);

  const handleApprove = async () => {
    await approveAction({ agentId });
  };

  const handleReject = async () => {
    if (!isRejecting) {
      setIsRejecting(true);
      return;
    }
    await rejectAction({ agentId, feedback: feedback || undefined });
    setIsRejecting(false);
    setFeedback("");
  };

  return (
    <div className="bg-orange-500/5 border border-orange-500/20 rounded-lg p-3 mt-2">
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
          onClick={handleApprove}
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

function ActivityItem({ activity, agentId }: ActivityItemProps) {
  const content = activity.content as Record<string, unknown> | null;

  const renderContent = () => {
    switch (activity.contentType) {
      case "thinking":
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
            <div className="flex-1 min-w-0">
              <p className="text-sm text-muted-foreground">
                {thinkingText}
                {activity.isPartial && (
                  <span className="inline-block w-1.5 h-3 bg-current ml-0.5 animate-pulse" />
                )}
              </p>
            </div>
          </div>
        );

      case "tool-call": {
        return (
          <div className="flex items-start gap-2">
            <HugeiconsIcon
              icon={CodeIcon}
              size={14}
              className="text-amber-500 mt-0.5 flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-amber-500">
                {String(content?.toolName || "Tool Call")}
              </p>
              <ToolResultCard output={content?.input ?? content?.args} />
            </div>
          </div>
        );
      }

      case "tool-result": {
        return (
          <div className="flex items-start gap-2">
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              size={14}
              className="text-emerald-500 mt-0.5 flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-emerald-500">
                {String(content?.toolName || "Result")}
              </p>
              <ToolResultCard output={content?.output ?? content?.result} />
            </div>
          </div>
        );
      }

      case "finding-preview": {
        const markdown = String(content?.markdown || content?.content || "");
        return (
          <div className="flex items-start gap-2">
            <HugeiconsIcon
              icon={File01Icon}
              size={14}
              className="text-purple-500 mt-0.5 flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-purple-500 mb-1">
                Finding
              </p>
              <div className="bg-muted rounded-lg p-3 text-sm">
                <MarkdownPreview content={markdown} />
              </div>
            </div>
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
            <div className="flex-1 min-w-0">
              <p className="text-sm text-red-500">
                {String(
                  content?.message || content?.error || "An error occurred",
                )}
              </p>
            </div>
          </div>
        );

      case "approval": {
        const approved = Boolean(content?.approved);
        return (
          <div className="flex items-start gap-2">
            <HugeiconsIcon
              icon={approved ? CheckmarkCircle02Icon : Alert02Icon}
              size={14}
              className={cn(
                "mt-0.5 flex-shrink-0",
                approved ? "text-emerald-500" : "text-orange-500",
              )}
            />
            <p className="text-sm">
              {approved ? "Approved" : "Rejected"}
              {content?.feedback ? `: ${String(content.feedback)}` : null}
            </p>
          </div>
        );
      }

      case "checkpoint": {
        const preview = content?.preview ? String(content.preview) : null;
        return (
          <div className="flex items-start gap-2">
            <HugeiconsIcon
              icon={Alert02Icon}
              size={14}
              className="text-orange-500 mt-0.5 flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-orange-500">
                Approval requested
              </p>
              {preview && (
                <pre className="mt-1 text-xs bg-muted rounded p-2 overflow-x-auto max-h-20 overflow-y-auto">
                  <code>{preview}</code>
                </pre>
              )}
            </div>
          </div>
        );
      }

      case "stopped":
        return (
          <div className="flex items-start gap-2">
            <HugeiconsIcon
              icon={Alert02Icon}
              size={14}
              className="text-muted-foreground mt-0.5 flex-shrink-0"
            />
            <p className="text-sm text-muted-foreground">
              {String(content?.message || "Stopped")}
            </p>
          </div>
        );

      default:
        return (
          <div className="text-sm text-muted-foreground">
            {JSON.stringify(content)}
          </div>
        );
    }
  };

  return (
    <div className="group">
      {renderContent()}
      <p className="text-[10px] text-muted-foreground mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {formatDistanceToNow(activity.timestamp, { addSuffix: true })}
      </p>
    </div>
  );
}
