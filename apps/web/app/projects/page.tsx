import { preloadQuery } from "convex/nextjs";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api } from "@/convex/_generated/api";
import { ProjectsContent } from "./projects-content";

export default async function ProjectsPage() {
  const token = await convexAuthNextjsToken();
  const [preloadedWorkspaces, preloadedUser] = await Promise.all([
    preloadQuery(api.workspaces.list, {}, { token }),
    preloadQuery(api.users.currentUser, {}, { token }),
  ]);

  return (
    <ProjectsContent
      preloadedWorkspaces={preloadedWorkspaces}
      preloadedUser={preloadedUser}
    />
  );
}
