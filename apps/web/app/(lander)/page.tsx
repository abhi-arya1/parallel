import Image from "next/image";
import { Nav, Hero, Features, Footer } from "./components";

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />
      <main className="flex-1 pt-16">
        <Hero />
        <Features />

        {/* Product screenshot */}
        <section className="px-6 py-16">
          <div className="max-w-5xl mx-auto">
            <div className="relative rounded-xl border border-border/50 shadow-2xl overflow-hidden bg-background">
              <Image
                src="/product.png"
                alt="Parallel notebook interface"
                width={1920}
                height={1080}
                className="w-full h-auto"
                priority
              />
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
