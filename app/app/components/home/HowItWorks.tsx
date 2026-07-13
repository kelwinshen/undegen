export default function HowItWorks() {
  const steps = [
    {
      title: "1. Stake Stablecoins",
      desc: "Lock USDC for one week to start earning daily yield. Your principal is never touched.",
    },
    {
      title: "2. Vote Daily",
      desc: "Every day a new batch of high‑odds predictions appears, curated from matches within the next 24 hours. Vote for your favorite outcome.",
    },
    {
      title: "3. Syndicate Predicts",
      desc: "The protocol pools the weekly yield and allocates it to the community’s most‑voted predictions.",
    },
    {
      title: "4. Earn Together",
      desc: "If the prediction is correct, the protocol treasury pays the high‑multiplier reward, distributed proportionally. If wrong, only that day’s yield is lost — your principal stays safe.",
    },
  ];

  return (
    <div className="p-6 bg-bg2 rounded-xl border border-border-low">
      <h2 className="text-xl font-bold mb-4">How the Syndicate Works</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {steps.map((s) => (
          <div key={s.title} className="p-4 bg-bg1 rounded-lg">
            <h3 className="font-semibold text-emerald-300">{s.title}</h3>
            <p className="text-sm text-gray-400 mt-1">{s.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}