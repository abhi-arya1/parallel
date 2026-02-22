"use client";

import { useQuery } from "convex/react";
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
} from "@hugeicons-pro/core-duotone-rounded";
import { formatDistanceToNow } from "date-fns";

interface AgentActivityStreamProps {
  agentId: Id<"agents">;
}

export function AgentActivityStream({ agentId }: AgentActivityStreamProps) {
  const activities = useQuery(api.agents.getActivityStream, {
    agentId,
    limit: 50,
  });

  if (!activities || activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-4">
        <p className="text-sm">No activity yet</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      {activities.map((activity) => (
        <ActivityItem key={activity._id} activity={activity} />
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
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return JSON.stringify(value, null, 2);
}

function ActivityItem({ activity }: ActivityItemProps) {
  const content = activity.content as Record<string, unknown> | null;

  const renderContent = () => {
    switch (activity.contentType) {
      case "thinking":
        return (
          <div className="flex items-start gap-2">
            <HugeiconsIcon
              icon={BrainIcon}
              size={14}
              className="text-blue-500 mt-0.5 flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-muted-foreground italic">
                {stringify(
                  content?.content || content?.message || "Thinking...",
                )}
                {activity.isPartial && (
                  <span className="inline-block w-1.5 h-3 bg-current ml-0.5 animate-pulse" />
                )}
              </p>
            </div>
          </div>
        );

      case "tool-call":
        return (
          <div className="flex items-start gap-2">
            <HugeiconsIcon
              icon={CodeIcon}
              size={14}
              className="text-amber-500 mt-0.5 flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-amber-500 mb-1">
                {stringify(content?.toolName || "Tool Call")}
              </p>
              {content?.input ? (
                <pre className="text-xs bg-muted rounded p-2 overflow-x-auto">
                  <code>{stringify(content.input)}</code>
                </pre>
              ) : null}
            </div>
          </div>
        );

      case "tool-result":
        return (
          <div className="flex items-start gap-2">
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              size={14}
              className="text-emerald-500 mt-0.5 flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-emerald-500 mb-1">
                Result: {stringify(content?.toolName)}
              </p>
              {content?.output ? (
                <pre className="text-xs bg-muted rounded p-2 overflow-x-auto max-h-40 overflow-y-auto">
                  <code>{stringify(content.output)}</code>
                </pre>
              ) : null}
            </div>
          </div>
        );

      case "finding-preview":
        return (
          <div className="flex items-start gap-2">
            <HugeiconsIcon
              icon={File01Icon}
              size={14}
              className="text-purple-500 mt-0.5 flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-purple-500 mb-1">
                Finding Draft
              </p>
              <div className="text-sm bg-muted rounded p-2 prose prose-sm dark:prose-invert max-w-none">
                {stringify(content?.markdown || content?.content)}
              </div>
            </div>
          </div>
        );

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
                {stringify(
                  content?.message || content?.error || "An error occurred",
                )}
              </p>
            </div>
          </div>
        );

      case "approval":
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
              {approved ? "Action approved" : "Action rejected"}
              {content?.feedback ? `: ${stringify(content.feedback)}` : null}
            </p>
          </div>
        );

      case "checkpoint":
        return (
          <div className="flex items-start gap-2">
            <HugeiconsIcon
              icon={Alert02Icon}
              size={14}
              className="text-orange-500 mt-0.5 flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-orange-500 mb-1">
                Awaiting Approval
              </p>
              {content?.preview ? (
                <pre className="text-xs bg-muted rounded p-2 overflow-x-auto max-h-20 overflow-y-auto">
                  <code>{stringify(content.preview)}</code>
                </pre>
              ) : null}
            </div>
          </div>
        );

      default:
        return (
          <div className="text-sm text-muted-foreground">
            {stringify(content)}
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
