import Link from "next/link";
import Image from "next/image";

export function Nav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 bg-background/80 backdrop-blur-sm">
      <Link href="/" className="flex items-center gap-2">
        <Image
          src="/icons/logo-black.png"
          alt="Parallel"
          width={24}
          height={24}
          className="dark:hidden block"
        />
        <Image
          src="/icons/logo-white.png"
          alt="Parallel"
          width={24}
          height={24}
          className="dark:block hidden"
        />
        <span className="font-serif text-lg tracking-tight">Parallel</span>
      </Link>
      <div className="flex items-center gap-6">
        <a
          href="https://github.com/abhi-arya1/parallel"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          GitHub
        </a>
        <Link
          href="/signin"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Log in
        </Link>
      </div>
    </nav>
  );
}
