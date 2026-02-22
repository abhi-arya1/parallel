import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Parallel",
  description:
    "The lab notebook where humans and AI agents collaborate as co-investigators in real time.",
};

export default function LanderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
