"use client";

import Image from "next/image";
import type { AgentRole, AgentStatus } from "./types";

const ROLE_ICON_STYLE: Record<AgentRole, string> = {
  engineer: "circle",
  researcher: "halfmoon",
  reviewer: "square",
};

const STATUS_ICON: Record<AgentStatus, string> = {
  spawning: "thinking-1",
  thinking: "thinking-1",
  working: "thinking-2",
  awaiting_approval: "confused-1",
  done: "happy-1",
  idle: "happy-2",
  error: "confused-1",
};

interface AgentAvatarProps {
  role: AgentRole;
  status: AgentStatus;
  size?: number;
  className?: string;
}

export function AgentAvatar({
  role,
  status,
  size = 36,
  className,
}: AgentAvatarProps) {
  const style = ROLE_ICON_STYLE[role];
  const icon = STATUS_ICON[status];
  const src = `/icons/${style}/${icon}.png`;

  return (
    <Image
      src={src}
      alt={`${role} agent - ${status}`}
      width={size}
      height={size}
      className={className}
    />
  );
}
