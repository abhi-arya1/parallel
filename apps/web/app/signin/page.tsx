"use client";

import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  GithubIcon,
  ViewIcon,
  ViewOffIcon,
  AnonymousIcon,
  Loading03Icon,
} from "@hugeicons-pro/core-duotone-rounded";

export default function SignInPage() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn("password", { email, password, flow });
    } catch {
      setError(
        flow === "signIn"
          ? "Invalid email or password."
          : "Could not create account. Try a different email.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleGitHub() {
    setError("");
    setLoading(true);
    try {
      await signIn("github");
    } catch {
      setError("GitHub sign-in failed.");
      setLoading(false);
    }
  }

  async function handleAnonymous() {
    setError("");
    setLoading(true);
    try {
      await signIn("anonymous");
    } catch {
      setError("Anonymous sign-in failed.");
      setLoading(false);
    }
  }

  const isSignUp = flow === "signUp";

  return (
    <div className="flex min-h-screen items-start pt-24 md:items-center md:pt-0 justify-center px-4">
      <div className="flex flex-col gap-6 w-full max-w-95">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight">
            {isSignUp ? "Create your account" : "Welcome back"}
          </h1>
          <p className="text-muted-foreground text-sm">
            {isSignUp
              ? "Sign up to get started."
              : "Sign in to continue to your workspace."}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Button
            variant="secondary"
            className="w-full"
            onClick={handleGitHub}
            disabled={loading}
          >
            <HugeiconsIcon icon={GithubIcon} size={18} />
            Continue with GitHub
          </Button>

          <span className="text-muted-foreground text-xs text-center select-none">
            or
          </span>

          <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
            />
            <div className="flex items-center gap-1.5">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit(e);
                }}
                required
                disabled={loading}
              />
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground p-2 rounded-md transition-colors"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                <HugeiconsIcon
                  icon={showPassword ? ViewIcon : ViewOffIcon}
                  size={18}
                />
              </button>
            </div>

            {error && <p className="text-destructive text-sm">{error}</p>}

            <Button type="submit" disabled={loading} className="w-full mt-1">
              {loading ? (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={18}
                  className="animate-spin"
                />
              ) : isSignUp ? (
                "Sign Up"
              ) : (
                "Sign In"
              )}
            </Button>
          </form>
        </div>

        <div className="flex flex-col items-center gap-2.5">
          <p className="text-muted-foreground text-sm">
            {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
            <button
              type="button"
              className="text-foreground hover:underline"
              onClick={() => {
                setFlow(isSignUp ? "signIn" : "signUp");
                setError("");
              }}
            >
              {isSignUp ? "Sign in" : "Sign up"}
            </button>
          </p>

          <button
            type="button"
            className="text-muted-foreground hover:text-foreground text-sm flex items-center gap-1.5 transition-colors"
            onClick={handleAnonymous}
            disabled={loading}
          >
            <HugeiconsIcon icon={AnonymousIcon} size={14} />
            Continue as guest
          </button>
        </div>
      </div>
    </div>
  );
}
