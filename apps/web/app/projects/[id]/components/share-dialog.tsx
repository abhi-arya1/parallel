"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  UserAdd01Icon,
  Delete02Icon,
  Logout03Icon,
} from "@hugeicons-pro/core-duotone-rounded";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

function getInitials(name?: string | null, email?: string | null) {
  if (name)
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  if (email) return email[0]!.toUpperCase();
  return "?";
}

function Avatar({
  image,
  name,
  email,
}: {
  image?: string | null;
  name?: string | null;
  email?: string | null;
}) {
  return (
    <div className="size-7 rounded-full bg-rose-600 dark:bg-rose-500 text-white text-[10px] font-medium flex items-center justify-center overflow-hidden shrink-0">
      {image ? (
        <img
          src={image}
          alt={name ?? "User"}
          className="size-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        getInitials(name, email)
      )}
    </div>
  );
}

interface ShareDialogProps {
  workspaceId: Id<"workspaces">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLeave?: () => void;
}

export function ShareDialog({
  workspaceId,
  open,
  onOpenChange,
  onLeave,
}: ShareDialogProps) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const data = useQuery(api.workspaces.getCollaborators, { workspaceId });
  const addCollaborator = useMutation(api.workspaces.addCollaborator);
  const removeCollaborator = useMutation(api.workspaces.removeCollaborator);
  const leaveWorkspace = useMutation(api.workspaces.leaveWorkspace);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await addCollaborator({ workspaceId, email: email.trim() });
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add user");
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (userId: Id<"users">) => {
    try {
      await removeCollaborator({ workspaceId, userId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove");
    }
  };

  const handleLeave = async () => {
    try {
      await leaveWorkspace({ workspaceId });
      onOpenChange(false);
      onLeave?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to leave");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share Project</DialogTitle>
          <DialogDescription>
            Add collaborators by email to view and edit this project.
          </DialogDescription>
        </DialogHeader>

        {data?.isOwner && (
          <form onSubmit={handleAdd} className="flex gap-2">
            <Input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              className="flex-1"
            />
            <Button
              type="submit"
              disabled={loading || !email.trim()}
              className="cursor-pointer"
            >
              <HugeiconsIcon icon={UserAdd01Icon} size={16} />
              Add
            </Button>
          </form>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-1">
          {data?.owner && (
            <div className="flex items-center gap-2.5 py-1.5">
              <Avatar
                image={data.owner.image}
                name={data.owner.name}
                email={data.owner.email}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">
                  {data.owner.name ?? "Unknown"}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {data.owner.email}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">Owner</span>
            </div>
          )}

          {data?.collaborators.map((c) => (
            <div key={c._id} className="flex items-center gap-2.5 py-1.5">
              <Avatar image={c.image} name={c.name} email={c.email} />
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{c.name ?? "Unknown"}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {c.email}
                </p>
              </div>
              {data.isOwner ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => handleRemove(c._id)}
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                >
                  <HugeiconsIcon icon={Delete02Icon} size={14} />
                </Button>
              ) : c._id === data.currentUserId ? (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={handleLeave}
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                >
                  <HugeiconsIcon icon={Logout03Icon} size={12} />
                  Leave
                </Button>
              ) : null}
            </div>
          ))}

          {data?.collaborators.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">
              No collaborators yet.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
