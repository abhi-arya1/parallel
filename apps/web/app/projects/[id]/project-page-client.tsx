"use client";

import { useState, useRef, useCallback } from "react";
import { Preloaded, usePreloadedQuery, useMutation } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { Play, RotateCcw, Trash2, Download } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { ResizableLayout } from "@/components/resizable-layout";
import { UserButton } from "@/components/user-button";
import { ProjectSidebar } from "./components/project-sidebar";
import {
  NotebookEditor,
  NotebookEditorRef,
} from "@/components/editor/NotebookEditor";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { restartKernel } from "@/lib/sandbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { HugeiconsIcon } from "@hugeicons/react";
import { Settings01Icon } from "@hugeicons-pro/core-duotone-rounded";
import type { Id } from "@/convex/_generated/dataModel";
import { ResearchButton } from "@/components/agent";
import type { AgentRole } from "@/components/agent/types";
import { useAgentConnections } from "@/lib/use-agent-connections";

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
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [selectedAgentRole, setSelectedAgentRole] = useState<AgentRole | null>(
    null,
  );
  const [showRunsPanel, setShowRunsPanel] = useState(false);

  const { agents, steer, clear, approve, reject } = useAgentConnections(
    workspace?._id,
  );

  const handleSelectAgent = (role: AgentRole | null) => {
    setSelectedAgentRole(role);
    if (role) setShowRunsPanel(false);
  };

  const handleToggleRunsPanel = () => {
    setShowRunsPanel(!showRunsPanel);
    if (!showRunsPanel) setSelectedAgentRole(null);
  };

  const notebookRef = useRef<NotebookEditorRef>(null);
  const clearAllOutputs = useMutation(api.cells.clearAllOutputs);

  const handleRunAll = useCallback(() => {
    notebookRef.current?.runAll();
  }, []);

  const handleRestartKernel = async () => {
    setIsRestarting(true);
    try {
      await restartKernel(id);
    } catch (error) {
      console.error("Failed to restart kernel:", error);
    } finally {
      setIsRestarting(false);
    }
  };

  const handleClearAllOutputs = async () => {
    try {
      await clearAllOutputs({ workspaceId: id as Id<"workspaces"> });
      toast.success("All outputs cleared");
    } catch (error) {
      console.error("Failed to clear outputs:", error);
      toast.error("Failed to clear outputs");
    }
  };

  const handleExportMarkdown = () => {
    const markdown = notebookRef.current?.exportMarkdown();
    if (!markdown) {
      toast.error("Failed to export notebook");
      return;
    }

    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${workspace?.title ?? "notebook"}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success("Exported to Markdown");
  };

  return (
    <div className="relative h-screen">
      <div className="absolute top-3 right-3 z-50 flex items-center gap-2">
        {workspace && <ResearchButton workspaceId={workspace._id} />}

        <button
          onClick={handleRunAll}
          disabled={isRunningAll || isRestarting}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:pointer-events-none transition-colors"
        >
          {isRunningAll ? (
            <>
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Running...
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5" />
              Run All
              <Kbd
                keys={["command", "shift"]}
                className="ml-1 bg-white/15 border-white/20 text-white/90"
              >
                R
              </Kbd>
            </>
          )}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <HugeiconsIcon icon={Settings01Icon} size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={handleRestartKernel}
              disabled={isRestarting}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              {isRestarting ? "Restarting..." : "Restart Kernel"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleClearAllOutputs}>
              <Trash2 className="h-4 w-4 mr-2" />
              Clear All Outputs
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleExportMarkdown}>
              <Download className="h-4 w-4 mr-2" />
              Export as Markdown
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <UserButton preloadedUser={preloadedUser} size="sm" />
      </div>
      <ResizableLayout
        sidebar={
          <ProjectSidebar
            preloadedWorkspace={preloadedWorkspace}
            preloadedCollaborators={preloadedCollaborators}
            agents={agents}
            selectedAgentRole={selectedAgentRole}
            onSelectAgent={handleSelectAgent}
            showRunsPanel={showRunsPanel}
            onToggleRunsPanel={handleToggleRunsPanel}
          />
        }
        selectedAgentRole={selectedAgentRole}
        agents={agents}
        onCloseAgentPanel={() => setSelectedAgentRole(null)}
        onSteer={steer}
        onClear={clear}
        onApprove={approve}
        onReject={reject}
        showRunsPanel={showRunsPanel}
        onCloseRunsPanel={() => setShowRunsPanel(false)}
        workspaceId={workspace?._id}
      >
        <NotebookEditor
          ref={notebookRef}
          workspaceId={id}
          preloadedUser={preloadedUser}
          preloadedWorkspace={preloadedWorkspace}
          onRunAllStart={() => setIsRunningAll(true)}
          onRunAllEnd={() => setIsRunningAll(false)}
        />
      </ResizableLayout>

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
