"use client";

import { useState } from "react";
import { Preloaded, usePreloadedQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import { UserButton } from "@/components/user-button";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  GridViewIcon,
  ListViewIcon,
  Search01Icon,
  Add01Icon,
} from "@hugeicons-pro/core-duotone-rounded";
import Image from "next/image";
import { ProjectCard } from "@/components/project-card";
import { ProjectRow } from "@/components/project-row";
import { DeleteProjectDialog } from "@/components/delete-project-dialog";
import { ImportNotebookDialog } from "@/components/import-notebook-dialog";

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
  const [renamingId, setRenamingId] = useState<Id<"workspaces"> | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const filtered = workspaces?.filter((w) =>
    w.title.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl tracking-tight font-serif">Projects</h1>

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

          {/* Import */}
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Image src="/jupyter.png" alt="Jupyter" width={16} height={16} />
            Import Notebook
          </Button>

          {/* Create */}
          <Button
            variant="outline"
            onClick={async () => {
              const id = await createWorkspace({
                title: "Untitled Project",
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
            <ProjectCard
              key={workspace._id}
              workspace={workspace}
              editing={renamingId === workspace._id}
              onEditingChange={(editing) =>
                setRenamingId(editing ? workspace._id : null)
              }
              onNavigate={() => router.push(`/projects/${workspace._id}`)}
              onDelete={(id, title) => setDeleteTarget({ id, title })}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col rounded-lg border divide-y">
          {filtered?.map((workspace) => (
            <ProjectRow
              key={workspace._id}
              workspace={workspace}
              editing={renamingId === workspace._id}
              onEditingChange={(editing) =>
                setRenamingId(editing ? workspace._id : null)
              }
              onNavigate={() => router.push(`/projects/${workspace._id}`)}
              onDelete={(id, title) => setDeleteTarget({ id, title })}
            />
          ))}
        </div>
      )}

      <DeleteProjectDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            removeWorkspace({ id: deleteTarget.id });
            setDeleteTarget(null);
          }
        }}
      />

      <ImportNotebookDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
