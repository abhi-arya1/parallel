"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { SentIcon } from "@hugeicons-pro/core-duotone-rounded";
import { MarkdownPreview } from "@/components/editor/MarkdownPreview";
import { triggerAgentContinue } from "@/lib/agents";

interface AgentChatProps {
  agentId: Id<"agents">;
  workspaceId: Id<"workspaces">;
}

export function AgentChat({ agentId, workspaceId }: AgentChatProps) {
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const agent = useQuery(api.agents.get, { agentId });
  const messages = useQuery(api.agents.getMessages, { agentId });
  const sendMessage = useMutation(api.agents.sendMessage);
  const continueAgent = useMutation(api.agents.continueAgent);

  const isCompleted = agent?.status
    ? ["done", "idle", "error"].includes(agent.status)
    : false;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isSending) return;

    setIsSending(true);
    try {
      await sendMessage({ agentId, content: input.trim() });
      setInput("");

      if (isCompleted && agent) {
        const result = await continueAgent({ agentId });
        if (result.needsContinue) {
          await triggerAgentContinue(
            workspaceId,
            agentId,
            agent.role as "engineer" | "researcher" | "reviewer",
          );
        }
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-col">
      {messages && messages.length > 0 && (
        <div className="max-h-48 overflow-y-auto px-3 py-2 space-y-2 border-b border-border">
          {messages.map((msg) => (
            <div
              key={msg._id}
              className={cn(
                "text-sm rounded-lg px-3 py-2 max-w-[85%]",
                msg.role === "user"
                  ? "ml-auto bg-primary text-primary-foreground"
                  : "bg-muted",
              )}
            >
              {msg.role === "assistant" ? (
                <MarkdownPreview content={msg.content} />
              ) : (
                msg.content
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      <form onSubmit={handleSubmit} className="p-2">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isCompleted
                ? "Continue the conversation..."
                : "Steer the agent..."
            }
            rows={1}
            className={cn(
              "flex-1 resize-none rounded-md border border-input bg-background px-3 py-1.5 text-sm",
              "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
          />
          <button
            type="submit"
            disabled={!input.trim() || isSending}
            className={cn(
              "flex-shrink-0 h-7 w-7 rounded-md flex items-center justify-center",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "disabled:opacity-50 disabled:pointer-events-none transition-colors",
            )}
          >
            <HugeiconsIcon icon={SentIcon} size={14} />
          </button>
        </div>
      </form>
    </div>
  );
}
