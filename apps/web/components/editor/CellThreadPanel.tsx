"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id, Doc } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { Streamdown } from "streamdown";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Delete02Icon,
  ArrowTurnBackwardIcon,
} from "@hugeicons-pro/core-duotone-rounded";

interface CellThreadPanelProps {
  yjsCellId: string;
  workspaceId: Id<"workspaces">;
}

type Thread = Doc<"threads">;

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString();
}

function getStableColor(name: string): string {
  const colors = [
    "#E57373",
    "#F06292",
    "#BA68C8",
    "#9575CD",
    "#7986CB",
    "#64B5F6",
    "#4FC3F7",
    "#4DD0E1",
    "#4DB6AC",
    "#81C784",
    "#AED581",
    "#DCE775",
    "#FFD54F",
    "#FFB74D",
    "#FF8A65",
    "#A1887F",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length]!;
}

function getTextColorForBackground(backgroundColor: string): string {
  const hex = backgroundColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

interface UserInfo {
  _id: Id<"users">;
  name?: string;
  image?: string;
}

interface ThreadMessageProps {
  thread: Thread;
  userInfo?: UserInfo;
  onReply?: () => void;
  onDelete: () => void;
  isReply?: boolean;
  currentUserId?: string;
}

function ThreadMessage({
  thread,
  userInfo,
  onReply,
  onDelete,
  isReply,
  currentUserId,
}: ThreadMessageProps) {
  const [isHovered, setIsHovered] = useState(false);
  const isOwn = currentUserId === thread.authorId;
  const displayName = userInfo?.name || thread.authorName;
  const avatarUrl = userInfo?.image;
  const bgColor = getStableColor(displayName);

  return (
    <div
      className={cn("group relative flex gap-2", isReply && "ml-6 mt-2.5")}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={displayName}
          className="size-5 flex-shrink-0 rounded-full object-cover"
        />
      ) : (
        <div
          className="size-5 flex-shrink-0 rounded-full text-[9px] font-semibold leading-5 text-center"
          style={{
            backgroundColor: bgColor,
            color: getTextColorForBackground(bgColor),
          }}
        >
          {displayName.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="font-medium text-foreground">{displayName}</span>
          <span className="text-muted-foreground/50">
            {formatRelativeTime(thread.createdAt)}
          </span>
          {thread.authorType === "agent" && thread.agentRole && (
            <span className="text-[9px] uppercase text-muted-foreground/40">
              {thread.agentRole}
            </span>
          )}
        </div>
        <div className="mt-1 text-sm text-foreground/90 prose prose-sm dark:prose-invert max-w-none [&_p]:m-0 [&_pre]:my-1.5 [&_pre]:text-xs">
          <Streamdown>{thread.content}</Streamdown>
        </div>
      </div>
      {isHovered && (
        <div className="absolute right-0 top-0 flex items-center gap-1">
          {!isReply && onReply && (
            <button
              onClick={onReply}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Reply"
            >
              <HugeiconsIcon icon={ArrowTurnBackwardIcon} size={14} />
            </button>
          )}
          {isOwn && (
            <button
              onClick={onDelete}
              className="rounded p-1 text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive"
              title="Delete"
            >
              <HugeiconsIcon icon={Delete02Icon} size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function CellThreadPanel({
  yjsCellId,
  workspaceId,
}: CellThreadPanelProps) {
  const [input, setInput] = useState("");
  const [replyingTo, setReplyingTo] = useState<Id<"threads"> | null>(null);
  const [isSending, setIsSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const threads = useQuery(api.threads.listByCell, { yjsCellId });
  const createThread = useMutation(api.threads.create);
  const removeThread = useMutation(api.threads.remove);

  const currentUser = useQuery(api.users.currentUser);
  const currentUserId = currentUser?._id;

  // Get unique human author IDs to fetch user info
  const humanAuthorIds = useMemo(() => {
    if (!threads) return [];
    const ids = new Set<Id<"users">>();
    for (const thread of threads) {
      if (thread.authorType === "human") {
        ids.add(thread.authorId as Id<"users">);
      }
    }
    return Array.from(ids);
  }, [threads]);

  const users = useQuery(
    api.users.getByIds,
    humanAuthorIds.length > 0 ? { userIds: humanAuthorIds } : "skip",
  );

  const userMap = useMemo(() => {
    const map = new Map<string, UserInfo>();
    if (users) {
      for (const user of users) {
        map.set(user._id, user);
      }
    }
    return map;
  }, [users]);

  const groupedThreads = useMemo(() => {
    if (!threads) return [];
    const topLevel = threads.filter((t) => !t.parentThreadId);
    return topLevel.map((parent) => ({
      parent,
      replies: threads.filter((t) => t.parentThreadId === parent._id),
    }));
  }, [threads]);

  useEffect(() => {
    if (replyingTo && inputRef.current) {
      inputRef.current.focus();
    }
  }, [replyingTo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isSending) return;

    setIsSending(true);
    try {
      await createThread({
        yjsCellId,
        workspaceId,
        content: input.trim(),
        parentThreadId: replyingTo ?? undefined,
      });
      setInput("");
      setReplyingTo(null);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
    if (e.key === "Escape") {
      if (replyingTo) setReplyingTo(null);
    }
  };

  const handleDelete = async (threadId: Id<"threads">) => {
    await removeThread({ threadId });
  };

  const replyingToThread = replyingTo
    ? threads?.find((t) => t._id === replyingTo)
    : null;

  return (
    <div className="w-[80%] overflow-hidden rounded-lg border border-border/40 bg-muted/30 px-4 py-3 mt-2 mb-3 animate-in fade-in slide-in-from-top-2 duration-200">
      {threads === undefined ? (
        <div className="flex items-center justify-center py-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
        </div>
      ) : (
        <>
          {groupedThreads.length > 0 && (
            <div className="max-h-64 space-y-5 overflow-y-auto mb-4">
              {groupedThreads.map(({ parent, replies }) => (
                <div key={parent._id}>
                  <ThreadMessage
                    thread={parent}
                    userInfo={userMap.get(parent.authorId)}
                    onReply={() => setReplyingTo(parent._id)}
                    onDelete={() => handleDelete(parent._id)}
                    currentUserId={currentUserId}
                  />
                  {replies.map((reply) => (
                    <ThreadMessage
                      key={reply._id}
                      thread={reply}
                      userInfo={userMap.get(reply.authorId)}
                      onDelete={() => handleDelete(reply._id)}
                      isReply
                      currentUserId={currentUserId}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            className={cn(
              "flex items-center gap-3",
              groupedThreads.length > 0 && "pt-3 border-t border-border/30",
            )}
          >
            {replyingToThread && (
              <button
                type="button"
                onClick={() => setReplyingTo(null)}
                className="text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
              >
                @{replyingToThread.authorName} ×
              </button>
            )}
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={replyingTo ? "Reply..." : "Add a comment..."}
              className={cn(
                "flex-1 bg-transparent text-sm outline-none py-1",
                "placeholder:text-muted-foreground/40",
              )}
            />
            {input.trim() && (
              <button
                type="submit"
                disabled={isSending}
                className="text-xs font-medium text-primary hover:text-primary/80 disabled:opacity-50"
              >
                {isSending ? "..." : "Send"}
              </button>
            )}
          </form>
        </>
      )}
    </div>
  );
}
