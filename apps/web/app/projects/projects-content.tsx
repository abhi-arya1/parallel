"use client";

import { useState, useRef, useEffect } from "react";
import { Preloaded, usePreloadedQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import { UserButton } from "@/components/user-button";
import { formatDistanceToNow } from "date-fns";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  GridViewIcon,
  ListViewIcon,
  Search01Icon,
  Add01Icon,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function InlineRenameTitle({
  title,
  workspaceId,
  className,
}: {
  title: string;
  workspaceId: Id<"workspaces">;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameWorkspace = useMutation(api.workspaces.rename);

  useEffect(() => {
    setValue(title);
  }, [title]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const save = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== title) {
      renameWorkspace({ id: workspaceId, title: trimmed });
    } else {
      setValue(title);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
          if (e.key === "Escape") {
            setValue(title);
            setEditing(false);
          }
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className={`bg-transparent border-b border-foreground/20 outline-none text-sm font-medium truncate w-full ${className ?? ""}`}
      />
    );
  }

  return (
    <p
      className={`truncate cursor-text hover:underline decoration-foreground/20 underline-offset-2 ${className ?? ""}`}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        setEditing(true);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {title}
    </p>
  );
}

export function ProjectsContent({
  preloadedWorkspaces,
  preloadedUser,
}: {
  preloadedWorkspaces: Preloaded<typeof api.workspaces.list>;
  preloadedUser: Preloaded<typeof api.users.currentUser>;
}) {
  const workspaces = usePreloadedQuery(preloadedWorkspaces);
  const createWorkspace = useMutation(api.workspaces.create);
  const removeWorkspace = useMutation(api.workspaces.remove);
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [deleteTarget, setDeleteTarget] = useState<{
    id: Id<"workspaces">;
    title: string;
  } | null>(null);

  const filtered = workspaces?.filter((w) =>
    w.title.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Projects</h1>

        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center rounded-md border p-0.5">
            <button
              onClick={() => setView("grid")}
              className={`rounded-sm p-1.5 transition-colors ${view === "grid" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <HugeiconsIcon icon={GridViewIcon} size={16} />
            </button>
            <button
              onClick={() => setView("list")}
              className={`rounded-sm p-1.5 transition-colors ${view === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <HugeiconsIcon icon={ListViewIcon} size={16} />
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <HugeiconsIcon
              icon={Search01Icon}
              size={16}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <Input
              placeholder="Search projects"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 w-52"
            />
          </div>

          {/* Create */}
          <Button
            variant="outline"
            onClick={async () => {
              const id = await createWorkspace({
                title: "Untitled Project",
                hypothesis: "",
              });
              router.push(`/projects/${id}`);
            }}
          >
            <HugeiconsIcon icon={Add01Icon} size={16} />
            Create Project
          </Button>

          <UserButton preloadedUser={preloadedUser} />
        </div>
      </div>

      {/* Content */}
      {filtered && filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <p className="text-muted-foreground text-sm">
            {search ? "No projects match your search." : "No projects yet."}
          </p>
          {!search && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const id = await createWorkspace({
                  title: "Untitled Project",
                  hypothesis: "",
                });
                router.push(`/projects/${id}`);
              }}
            >
              <HugeiconsIcon icon={Add01Icon} size={16} />
              Create your first project
            </Button>
          )}
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered?.map((workspace) => (
            <button
              key={workspace._id}
              onClick={() => router.push(`/projects/${workspace._id}`)}
              className="group text-left rounded-lg border p-4 transition-colors hover:bg-muted/50 flex items-start justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <InlineRenameTitle
                  title={workspace.title}
                  workspaceId={workspace._id}
                />
                {workspace.hypothesis && (
                  <p className="text-muted-foreground text-sm truncate mt-0.5">
                    {workspace.hypothesis}
                  </p>
                )}
                <p className="text-muted-foreground text-xs mt-2">
                  Created{" "}
                  {formatDistanceToNow(workspace._creationTime, {
                    addSuffix: true,
                  })}
                </p>
              </div>
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
                      const card = (e.target as HTMLElement).closest(".group");
                      const titleEl = card?.querySelector<HTMLElement>("[class*='cursor-text']");
                      titleEl?.click();
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
                      setDeleteTarget({ id: workspace._id, title: workspace.title });
                    }}
                  >
                    <HugeiconsIcon icon={Delete02Icon} size={16} />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col rounded-lg border divide-y">
          {filtered?.map((workspace) => (
            <button
              key={workspace._id}
              onClick={() => router.push(`/projects/${workspace._id}`)}
              className="group text-left px-4 py-3 transition-colors hover:bg-muted/50 flex items-center justify-between gap-4"
            >
              <div className="min-w-0 flex-1 flex items-center gap-4">
                <InlineRenameTitle
                  title={workspace.title}
                  workspaceId={workspace._id}
                />
                {workspace.hypothesis && (
                  <p className="text-muted-foreground text-sm truncate">
                    {workspace.hypothesis}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-muted-foreground text-xs">
                  Created{" "}
                  {formatDistanceToNow(workspace._creationTime, {
                    addSuffix: true,
                  })}
                </span>
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
                        const row = (e.target as HTMLElement).closest(".group");
                        const titleEl = row?.querySelector<HTMLElement>("[class*='cursor-text']");
                        titleEl?.click();
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
                        setDeleteTarget({ id: workspace._id, title: workspace.title });
                      }}
                    >
                      <HugeiconsIcon icon={Delete02Icon} size={16} />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-medium text-foreground">{deleteTarget?.title}</span>?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleteTarget) {
                  removeWorkspace({ id: deleteTarget.id });
                  setDeleteTarget(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
