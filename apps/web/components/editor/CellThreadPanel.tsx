"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id, Doc } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  SentIcon,
  Delete02Icon,
  ArrowTurnBackwardIcon,
} from "@hugeicons-pro/core-duotone-rounded";
import { Button } from "@/components/ui/button";

interface CellThreadPanelProps {
  yjsCellId: string;
  workspaceId: Id<"workspaces">;
}

type Thread = Doc<"threads">;

function getTextColorForBackground(backgroundColor: string): string {
  const hex = backgroundColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function getAuthorColor(authorId: string): string {
  const colors = [
    "#4ECDC4",
    "#FF6B6B",
    "#A8DADC",
    "#FFE66D",
    "#95E1D3",
    "#F38181",
    "#AA96DA",
    "#FCBAD3",
  ];
  let hash = 0;
  for (let i = 0; i < authorId.length; i++) {
    hash = authorId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length]!;
}

interface ThreadMessageProps {
  thread: Thread;
  onReply?: () => void;
  onDelete: () => void;
  isReply?: boolean;
  currentUserId?: string;
}

function ThreadMessage({
  thread,
  onReply,
  onDelete,
  isReply,
  currentUserId,
}: ThreadMessageProps) {
  const [isHovered, setIsHovered] = useState(false);
  const color = getAuthorColor(thread.authorId);
  const isOwn = currentUserId === thread.authorId;

  return (
    <div
      className={cn("group flex gap-2", isReply && "ml-6")}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className="size-6 flex-shrink-0 rounded-full text-[10px] font-semibold leading-6 text-center"
        style={{
          backgroundColor: color,
          color: getTextColorForBackground(color),
        }}
      >
        {thread.authorName.charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{thread.authorName}</span>
          <span className="text-[10px] text-muted-foreground">
            {formatRelativeTime(thread.createdAt)}
          </span>
          {thread.authorType === "agent" && thread.agentRole && (
            <span className="rounded bg-muted px-1 py-0.5 text-[9px] font-medium uppercase">
              {thread.agentRole}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-foreground/90 whitespace-pre-wrap break-words">
          {thread.content}
        </p>
        <div
          className={cn(
            "mt-1 flex items-center gap-1 transition-opacity",
            !isHovered && "opacity-0",
          )}
        >
          {!isReply && onReply && (
            <button
              onClick={onReply}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <HugeiconsIcon icon={ArrowTurnBackwardIcon} size={10} />
              Reply
            </button>
          )}
          {isOwn && (
            <button
              onClick={onDelete}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <HugeiconsIcon icon={Delete02Icon} size={10} />
              Delete
            </button>
          )}
        </div>
      </div>
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const threads = useQuery(api.threads.listByCell, { yjsCellId });
  const createThread = useMutation(api.threads.create);
  const removeThread = useMutation(api.threads.remove);

  const currentUser = useQuery(api.users.currentUser);
  const currentUserId = currentUser?._id;

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
    if (e.key === "Escape" && replyingTo) {
      setReplyingTo(null);
    }
  };

  const handleDelete = async (threadId: Id<"threads">) => {
    await removeThread({ threadId });
  };

  const replyingToThread = replyingTo
    ? threads?.find((t) => t._id === replyingTo)
    : null;

  return (
    <div
      ref={panelRef}
      className="border-t border-border bg-muted/30 animate-in slide-in-from-top-2 duration-200"
    >
      {threads === undefined ? (
        <div className="flex items-center justify-center py-4">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
        </div>
      ) : (
        <>
          {groupedThreads.length > 0 && (
            <div className="max-h-64 space-y-3 overflow-y-auto px-4 py-3">
              {groupedThreads.map(({ parent, replies }) => (
                <div key={parent._id} className="space-y-2">
                  <ThreadMessage
                    thread={parent}
                    onReply={() => setReplyingTo(parent._id)}
                    onDelete={() => handleDelete(parent._id)}
                    currentUserId={currentUserId}
                  />
                  {replies.map((reply) => (
                    <ThreadMessage
                      key={reply._id}
                      thread={reply}
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
            className="border-t border-border/50 p-3"
          >
            {replyingToThread && (
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  Replying to{" "}
                  <span className="font-medium">
                    {replyingToThread.authorName}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setReplyingTo(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  replyingTo ? "Write a reply..." : "Add a comment..."
                }
                rows={1}
                className={cn(
                  "flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm",
                  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                )}
              />
              <Button
                type="submit"
                size="icon"
                disabled={!input.trim() || isSending}
                className="flex-shrink-0"
              >
                <HugeiconsIcon icon={SentIcon} size={16} />
              </Button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
