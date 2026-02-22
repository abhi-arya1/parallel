import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <section className="flex flex-col items-center justify-center min-h-[70vh] px-6 text-center">
      <div className="max-w-2xl space-y-6">
        <Image
          src="/icons/logo-black.png"
          alt="Parallel"
          width={180}
          height={180}
          className="dark:hidden block mx-auto mb-6"
        />
        <Image
          src="/icons/logo-white.png"
          alt="Parallel"
          width={180}
          height={180}
          className="dark:block hidden mx-auto mb-6"
        />

        <h1 className="text-4xl sm:text-5xl md:text-6xl font-serif tracking-tight text-foreground leading-[1.1]">
          Your research team,
          <br />
          <span className="text-muted-foreground">now with AI.</span>
        </h1>

        <p className="text-muted-foreground text-lg max-w-md mx-auto leading-relaxed">
          A collaborative computational notebook with AI agents that help you
          explore, experiment, and iterate faster.
        </p>

        <div className="flex items-center justify-center pt-2">
          <Button asChild size="lg">
            <Link href="/signin">Get started</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
