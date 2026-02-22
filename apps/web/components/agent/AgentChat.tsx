"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { SentIcon } from "@hugeicons-pro/core-duotone-rounded";
import { Button } from "@/components/ui/button";

interface AgentChatProps {
  agentId: Id<"agents">;
}

export function AgentChat({ agentId }: AgentChatProps) {
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = useQuery(api.agents.getMessages, { agentId });
  const sendMessage = useMutation(api.agents.sendMessage);

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
        <div className="max-h-48 overflow-y-auto px-4 py-2 space-y-2 border-b border-border">
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
              {msg.content}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      <form onSubmit={handleSubmit} className="p-3">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message to steer the agent..."
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
    </div>
  );
}
