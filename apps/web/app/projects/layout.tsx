import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Projects",
  description: "View and manage your projects",
};

export default function ProjectsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
