"use client";

import { Preloaded } from "convex/react";
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
    </div>
  );
}
