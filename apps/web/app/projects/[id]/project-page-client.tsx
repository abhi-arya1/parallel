"use client";

import { Preloaded, usePreloadedQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/convex/_generated/api";
import { ResizableLayout } from "@/components/resizable-layout";
import { UserButton } from "@/components/user-button";
import { ProjectSidebar } from "./components/project-sidebar";
import { NotebookEditor } from "@/components/editor/NotebookEditor";

interface ProjectPageClientProps {
  id: string;
  preloadedUser: Preloaded<typeof api.users.currentUser>;
  preloadedWorkspace: Preloaded<typeof api.workspaces.get>;
  preloadedCollaborators: Preloaded<typeof api.workspaces.getCollaborators>;
}

export function ProjectPageClient({
  id,
  preloadedUser,
  preloadedWorkspace,
  preloadedCollaborators,
}: ProjectPageClientProps) {
  const workspace = usePreloadedQuery(preloadedWorkspace);

  return (
    <div className="relative h-screen">
      <div className="absolute top-3 right-3 z-50">
        <UserButton preloadedUser={preloadedUser} size="sm" />
      </div>
      <ResizableLayout
        sidebar={
          <ProjectSidebar
            preloadedWorkspace={preloadedWorkspace}
            preloadedCollaborators={preloadedCollaborators}
          />
        }
      >
        <NotebookEditor
          workspaceId={id}
          preloadedUser={preloadedUser}
          preloadedWorkspace={preloadedWorkspace}
        />
      </ResizableLayout>

      {/* Last saved indicator */}
      <div className="absolute bottom-4 right-4 z-50">
        <div className="rounded-full bg-muted/80 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
          Saved{" "}
          {formatDistanceToNow(workspace?.lastSavedAt ?? Date.now(), {
            addSuffix: true,
          })}
        </div>
      </div>
    </div>
  );
}
