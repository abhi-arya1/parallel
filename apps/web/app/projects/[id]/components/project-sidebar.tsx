"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Preloaded, usePreloadedQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ThemeToggle } from "@/app/components/theme-toggle";
import { InlineRenameTitle } from "@/components/inline-rename-title";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Door01Icon,
  AddTeamIcon,
  CpuIcon,
} from "@hugeicons-pro/core-duotone-rounded";
import { cn } from "@/lib/utils";
import { ShareDialog } from "./share-dialog";
import { Button } from "@/components/ui/button";
import { stopKernel } from "@/lib/sandbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { AgentStatusSection } from "@/components/agent";
import type { Id } from "@/convex/_generated/dataModel";

interface ProjectSidebarProps {
  preloadedWorkspace: Preloaded<typeof api.workspaces.get>;
  preloadedCollaborators: Preloaded<typeof api.workspaces.getCollaborators>;
  selectedAgentId: Id<"agents"> | null;
  onSelectAgent: (agentId: Id<"agents"> | null) => void;
  children?: React.ReactNode;
}

export function ProjectSidebar({
  preloadedWorkspace,
  preloadedCollaborators,
  selectedAgentId,
  onSelectAgent,
  children,
}: ProjectSidebarProps) {
  const workspace = usePreloadedQuery(preloadedWorkspace);

  return (
    <div className="flex flex-col h-full">
      <ProjectSidebarHeader
        preloadedWorkspace={preloadedWorkspace}
        preloadedCollaborators={preloadedCollaborators}
      />

      {workspace && (
        <AgentStatusSection
          workspaceId={workspace._id}
          selectedAgentId={selectedAgentId}
          onSelectAgent={onSelectAgent}
        />
      )}

      <ProjectSidebarContent>{children}</ProjectSidebarContent>

      <ProjectSidebarFooter />
    </div>
  );
}

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

function ProjectSidebarHeader({
  preloadedWorkspace,
  preloadedCollaborators,
}: {
  preloadedWorkspace: Preloaded<typeof api.workspaces.get>;
  preloadedCollaborators: Preloaded<typeof api.workspaces.getCollaborators>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const workspace = usePreloadedQuery(preloadedWorkspace);
  const collaborators = usePreloadedQuery(preloadedCollaborators);

  return (
    <header className="flex flex-col gap-3 px-4 py-3">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => router.push("/projects")}
          aria-label="Back to projects"
          className="text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon icon={Door01Icon} size={18} />
        </Button>
        <span className="text-muted-foreground">/</span>
        {workspace ? (
          <InlineRenameTitle
            title={workspace.title}
            workspaceId={workspace._id}
            editing={editing}
            onEditingChange={setEditing}
            className="text-sm"
          />
        ) : (
          <span className="text-sm text-muted-foreground">Loading...</span>
        )}
      </div>

      {/* Share button - full width */}
      {workspace && (
        <>
          <Button
            variant="ghost"
            onClick={() => setShareOpen(true)}
            className="flex items-center justify-between w-full text-sm text-muted-foreground hover:text-foreground h-auto px-2 py-1.5"
          >
            <div className="flex items-center gap-2">
              <HugeiconsIcon icon={AddTeamIcon} size={18} />
              Share
            </div>

            {/* Avatar stack - only show if more than 1 user */}
            {collaborators && collaborators.collaborators.length > 0 && (
              <div className="flex -space-x-1.5">
                {/* Show owner */}
                {collaborators.owner && (
                  <div
                    className="flex size-5 items-center justify-center rounded-full bg-rose-600 dark:bg-rose-500 text-white text-[8px] font-medium overflow-hidden ring-1 ring-background"
                    title={`${collaborators.owner.name ?? collaborators.owner.email} (Owner)`}
                  >
                    {collaborators.owner.image ? (
                      <img
                        src={collaborators.owner.image}
                        alt={collaborators.owner.name ?? "Owner"}
                        className="size-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      getInitials(
                        collaborators.owner.name,
                        collaborators.owner.email,
                      )
                    )}
                  </div>
                )}
                {/* Show up to 2 collaborators (total 3 avatars max) */}
                {collaborators.collaborators.slice(0, 2).map((collab) => (
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
                {collaborators.collaborators.length > 2 && (
                  <div className="flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground text-[8px] font-medium ring-1 ring-background">
                    +{collaborators.collaborators.length - 2}
                  </div>
                )}
              </div>
            )}
          </Button>

          <ShareDialog
            workspaceId={workspace._id}
            open={shareOpen}
            onOpenChange={setShareOpen}
            onLeave={() => router.push("/projects")}
          />

          {/* GPU Selector */}
          <GpuSelector workspaceId={workspace._id} currentGpu={workspace.gpu} />
        </>
      )}
    </header>
  );
}

const GPU_OPTIONS = [
  "T4",
  "L4",
  "A10",
  "A100",
  "A100-40GB",
  "A100-80GB",
  "L40S",
  "H100",
  "H200",
  "B200",
] as const;

function GpuSelector({
  workspaceId,
  currentGpu,
}: {
  workspaceId: string;
  currentGpu?: string;
}) {
  const setGpu = useMutation(api.workspaces.setGpu);
  const selectedGpu = currentGpu ?? "T4";

  const handleGpuChange = async (value: string) => {
    // Update the GPU in Convex (this also clears the kernel reference)
    await setGpu({ workspaceId: workspaceId as any, gpu: value as any });

    // Terminate the old kernel on the sandbox server
    // Fire-and-forget since the Convex mutation already cleared the reference
    stopKernel(workspaceId).catch((e) => {
      console.warn("Failed to stop old kernel:", e);
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="flex items-center justify-between w-full text-sm text-muted-foreground hover:text-foreground h-auto px-2 py-1.5"
        >
          <div className="flex items-center gap-2">
            <HugeiconsIcon icon={CpuIcon} size={18} />
            Infrastructure
          </div>
          <span className="text-xs font-medium">{selectedGpu}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel className="flex items-center gap-2">
          <img src="/nvidia.svg" alt="NVIDIA" className="size-4" />
          GPU
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={selectedGpu}
          onValueChange={handleGpuChange}
        >
          {GPU_OPTIONS.map((gpu) => (
            <DropdownMenuRadioItem key={gpu} value={gpu}>
              {gpu}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ProjectSidebarContentProps {
  children?: React.ReactNode;
  className?: string;
}

export function ProjectSidebarContent({
  children,
  className,
}: ProjectSidebarContentProps) {
  return (
    <div className={cn("flex-1 overflow-y-auto px-4 py-3", className)}>
      {children}
    </div>
  );
}

function ProjectSidebarFooter() {
  return (
    <footer className="flex items-center justify-start px-4 py-3">
      <ThemeToggle />
    </footer>
  );
}
