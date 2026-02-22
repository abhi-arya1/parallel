import Link from "next/link";

export function Footer() {
  return (
    <footer className="px-6 py-8 mt-16">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Made with ❤️ for the{" "}
          <a
            href="https://humansand.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            humans&
          </a>{" "}
          hackathon
        </p>
        <div className="flex items-center gap-6 text-sm text-muted-foreground">
          <Link
            href="/signin"
            className="hover:text-foreground transition-colors"
          >
            Sign in
          </Link>
          <a
            href="https://github.com/abhi-arya1/parallel"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
