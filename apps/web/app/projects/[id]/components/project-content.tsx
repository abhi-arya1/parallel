"use client";

import { cn } from "@/lib/utils";

interface ProjectContentProps {
  children?: React.ReactNode;
  className?: string;
}

export function ProjectContent({ children, className }: ProjectContentProps) {
  return (
    <div className={cn("h-full overflow-y-auto p-4", className)}>
      {children}
    </div>
  );
}
