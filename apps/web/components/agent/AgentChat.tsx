"use client";

import { useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { SentIcon } from "@hugeicons-pro/core-duotone-rounded";
import type { AgentRole, AgentStatus } from "./types";

interface AgentChatProps {
  role: AgentRole;
  status: AgentStatus;
  onSteer: (content: string) => void;
}

export function AgentChat({ role, status, onSteer }: AgentChatProps) {
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isIdle = status === "idle";
  const isCompleted = ["done", "error"].includes(status);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isSending) return;

    setIsSending(true);
    try {
      onSteer(input.trim());
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

  const placeholder = isIdle
    ? "Start a conversation..."
    : isCompleted
      ? "Ask anything..."
      : "Steer...";

  return (
    <form onSubmit={handleSubmit} className="p-2">
      <div className="flex gap-2 items-end">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
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
  );
}
