"use client";

import { useState, useRef, useEffect } from "react";
import { Preloaded, usePreloadedQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import { HugeiconsIcon } from "@hugeicons/react";
import { Logout01Icon } from "@hugeicons-pro/core-duotone-rounded";

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

export function UserButton({
  preloadedUser,
}: {
  preloadedUser: Preloaded<typeof api.users.currentUser>;
}) {
  const user = usePreloadedQuery(preloadedUser);
  const { signOut } = useAuthActions();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  if (!user) return null;

  const initials = getInitials(user.name, user.email);
  const hasImage = !!user.image;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-center size-8 rounded-full bg-rose-900/80 text-rose-100 text-xs font-medium hover:bg-rose-800/90 transition-colors overflow-hidden ring-1 ring-rose-800/30"
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

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 rounded-lg border bg-popover text-popover-foreground shadow-lg z-50 py-1">
          <div className="px-3 py-2 border-b">
            {user.name && (
              <p className="text-sm truncate">{user.name}</p>
            )}
            {user.email && (
              <p className="text-muted-foreground text-xs truncate">
                {user.email}
              </p>
            )}
            {!user.name && !user.email && (
              <p className="text-muted-foreground text-sm">Guest</p>
            )}
          </div>
          <button
            onClick={() => void signOut()}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted transition-colors text-destructive"
          >
            <HugeiconsIcon icon={Logout01Icon} size={16} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
