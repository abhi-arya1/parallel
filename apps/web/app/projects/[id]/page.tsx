import { preloadQuery } from "convex/nextjs";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { ProjectPageClient } from "./project-page-client";

export default async function ProjectPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = await params;
  const token = await convexAuthNextjsToken();
  const workspaceId = id as Id<"workspaces">;

  const [preloadedUser, preloadedWorkspace, preloadedCollaborators] =
    await Promise.all([
      preloadQuery(api.users.currentUser, {}, { token }),
      preloadQuery(api.workspaces.get, { id: workspaceId }, { token }),
      preloadQuery(api.workspaces.getCollaborators, { workspaceId }, { token }),
    ]);

  return (
    <ProjectPageClient
      id={id}
      preloadedUser={preloadedUser}
      preloadedWorkspace={preloadedWorkspace}
      preloadedCollaborators={preloadedCollaborators}
    />
  );
}
