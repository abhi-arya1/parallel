const features = [
  {
    title: "Real-time collaboration",
    description:
      "Work together with your team in the same notebook. See cursors, edits, and changes as they happen.",
  },
  {
    title: "AI-powered agents",
    description:
      "Spawn engineer, researcher, and reviewer agents that work alongside you to accelerate experimentation.",
  },
  {
    title: "Cloud GPUs on demand",
    description:
      "Access T4 up to B200 NVIDIA GPUs instantly. Run infra-heavy training jobs without managing infrastructure.",
  },
];

export function Features() {
  return (
    <section className="px-6 py-12">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl font-serif tracking-tight text-center mb-16">
          Built for modern research workflows
        </h2>

        <div className="grid md:grid-cols-3 gap-12">
          {features.map((feature) => (
            <div key={feature.title} className="space-y-3">
              <h3 className="font-medium text-foreground">{feature.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
