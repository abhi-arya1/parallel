"use client";

import { Preloaded, usePreloadedQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import { HugeiconsIcon } from "@hugeicons/react";
import { Logout01Icon } from "@hugeicons-pro/core-duotone-rounded";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function getInitials(name?: string, email?: string): string {
  if (name) {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  if (email) return email[0]!.toUpperCase();
  return "?";
}

const sizeClasses = {
  sm: "size-6 text-[10px]",
  default: "size-8 text-xs",
} as const;

export function UserButton({
  preloadedUser,
  size = "default",
}: {
  preloadedUser: Preloaded<typeof api.users.currentUser>;
  size?: keyof typeof sizeClasses;
}) {
  const user = usePreloadedQuery(preloadedUser);
  const { signOut } = useAuthActions();

  if (!user) return null;

  const initials = getInitials(user.name, user.email);
  const hasImage = !!user.image;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`flex items-center justify-center rounded-full font-medium transition-colors overflow-hidden ${sizeClasses[size]} ${!hasImage ? "border border-border" : ""}`}
        >
          {hasImage ? (
            <img
              src={user.image!}
              alt={user.name ?? "User"}
              className="size-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            initials
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          {user.name && <p className="text-sm truncate">{user.name}</p>}
          {user.email && (
            <p className="text-muted-foreground text-xs truncate">
              {user.email}
            </p>
          )}
          {!user.name && !user.email && (
            <p className="text-muted-foreground text-sm">Guest</p>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void signOut()} variant="destructive">
          <HugeiconsIcon
            icon={Logout01Icon}
            size={16}
            className="text-destructive"
          />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
