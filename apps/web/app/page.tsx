import Image from "next/image";
import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <nav className="flex items-center justify-end px-6 py-4">
        <Link
          href="/signin"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Log in
        </Link>
      </nav>
      <main className="flex-1 flex flex-row items-center justify-center text-center px-4 gap-x-3">
        <h1 className="text-5xl font-serif tracking-tight text-foreground sm:text-7xl">
          Parallel
        </h1>
        <Image
          src={"/icons/logo-black.png"}
          alt="Parallel Logo"
          width={100}
          height={100}
          className="dark:hidden block mb-1"
        />
        <Image
          src={"/icons/logo-white.png"}
          alt="Parallel Logo"
          width={100}
          height={100}
          className="dark:block hidden mb-1"
        />
      </main>
    </div>
  );
}
