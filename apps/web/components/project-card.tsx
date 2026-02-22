"use client";

import { Id } from "@/convex/_generated/dataModel";
import { InlineRenameTitle } from "@/components/inline-rename-title";
import { formatDistanceToNow } from "date-fns";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  MoreVerticalIcon,
  PencilEdit01Icon,
  Delete02Icon,
} from "@hugeicons-pro/core-duotone-rounded";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type CollaboratorUser = {
  _id: Id<"users">;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

function getInitials(name?: string | null, email?: string | null): string {
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

export function ProjectCard({
  workspace,
  editing,
  onEditingChange,
  onNavigate,
  onDelete,
}: {
  workspace: {
    _id: Id<"workspaces">;
    title: string;
    _creationTime: number;
    owner?: CollaboratorUser | null;
    collaboratorUsers?: CollaboratorUser[];
  };
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onNavigate: () => void;
  onDelete: (id: Id<"workspaces">, title: string) => void;
}) {
  const hasCollaborators =
    workspace.collaboratorUsers && workspace.collaboratorUsers.length > 0;
  return (
    <div
      onClick={onNavigate}
      className="group text-left rounded-lg border p-4 transition-colors hover:bg-muted/50 flex items-start justify-between gap-3 cursor-pointer"
    >
      <div className="min-w-0 flex-1">
        <InlineRenameTitle
          title={workspace.title}
          workspaceId={workspace._id}
          editing={editing}
          onEditingChange={onEditingChange}
        />
        <p className="text-muted-foreground text-xs mt-2">
          Created{" "}
          {formatDistanceToNow(workspace._creationTime, {
            addSuffix: true,
          })}
        </p>
      </div>
      <div className="flex flex-col items-end gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div
              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted"
              onClick={(e) => e.stopPropagation()}
            >
              <HugeiconsIcon icon={MoreVerticalIcon} size={16} />
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onEditingChange(true);
              }}
            >
              <HugeiconsIcon icon={PencilEdit01Icon} size={16} />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(workspace._id, workspace.title);
              }}
            >
              <HugeiconsIcon icon={Delete02Icon} size={16} />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {/* Avatar stack - show if there are collaborators */}
        {hasCollaborators && (
          <div className="flex -space-x-1.5">
            {/* Show owner */}
            {workspace.owner && (
              <div
                className="flex size-5 items-center justify-center rounded-full bg-rose-600 dark:bg-rose-500 text-white text-[8px] font-medium overflow-hidden ring-1 ring-background"
                title={`${workspace.owner.name ?? workspace.owner.email} (Owner)`}
              >
                {workspace.owner.image ? (
                  <img
                    src={workspace.owner.image}
                    alt={workspace.owner.name ?? "Owner"}
                    className="size-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  getInitials(workspace.owner.name, workspace.owner.email)
                )}
              </div>
            )}
            {/* Show up to 2 collaborators (total 3 avatars max) */}
            {workspace.collaboratorUsers?.slice(0, 2).map((collab) => (
              <div
                key={collab._id}
                className="flex size-5 items-center justify-center rounded-full bg-rose-600 dark:bg-rose-500 text-white text-[8px] font-medium overflow-hidden ring-1 ring-background"
                title={collab.name ?? collab.email ?? "Collaborator"}
              >
                {collab.image ? (
                  <img
                    src={collab.image}
                    alt={collab.name ?? "Collaborator"}
                    className="size-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  getInitials(collab.name, collab.email)
                )}
              </div>
            ))}
            {/* Show +N if more than 2 collaborators */}
            {workspace.collaboratorUsers &&
              workspace.collaboratorUsers.length > 2 && (
                <div className="flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground text-[8px] font-medium ring-1 ring-background">
                  +{workspace.collaboratorUsers.length - 2}
                </div>
              )}
          </div>
        )}
      </div>
    </div>
  );
}
