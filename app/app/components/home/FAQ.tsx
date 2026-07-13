"use client";

import { useState } from "react";

const items = [
  {
    q: "What happens if the community prediction loses?",
    a: "Only that week's yield is lost. Your original deposit remains safe and continues generating yield for future weeks.",
  },
  {
    q: "How are the predictions chosen?",
    a: "We fetch real odds from the TXODDS market intelligence feed and curate the highest available outcomes across upcoming matches. The list is frozen daily.",
  },
  {
    q: "Who pays the winnings?",
    a: "The protocol treasury covers the payout. Undegen acts as a prediction market, not a bookmaker. The treasury is funded by protocol fees.",
  },
  {
    q: "Can I withdraw my principal anytime?",
    a: "Yes, after the 7‑day lock period. You can withdraw your full original deposit plus any unspent yield.",
  },
  {
    q: "What makes Undegen different from sports betting?",
    a: "You never risk your principal. You’re always staking, and the community’s pooled yield makes collective predictions. It’s a treasury‑governed syndicate with zero personal downside.",
  },
];

export default function FAQ() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="p-6 bg-bg2 rounded-xl border border-border-low">
      <h2 className="text-xl font-bold mb-4">FAQ</h2>
      <div className="space-y-2">
        {items.map((item, idx) => (
          <div key={idx} className="bg-bg1 rounded-lg overflow-hidden">
            <button
              onClick={() => setOpen(open === idx ? null : idx)}
              className="w-full text-left p-4 flex justify-between items-center"
            >
              <span className="font-medium">{item.q}</span>
              <span className="text-gray-400">{open === idx ? "▲" : "▼"}</span>
            </button>
            {open === idx && (
              <div className="px-4 pb-4 text-sm text-gray-400">{item.a}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}