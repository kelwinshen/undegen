"use client";

import { ReactNode, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

interface FAQItem {
  q: string;
  a: ReactNode;
}

const items: FAQItem[] = [
  {
    q: "What happens if the community's prediction loses?",
    a: "Only the yield allocated to that prediction is forfeited. Your deposited principal is never placed at risk and is always fully protected — you keep 100% of it regardless of outcome.",
  },
  {
    q: "How are the predictions chosen?",
    a: (
      <>
        Undegen continuously pulls upcoming fixtures and prediction markets from{" "}
        <a
          href="https://txodds.net/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 hover:text-foreground transition-colors duration-200"
        >
          TXODDS
        </a>
        . Every eligible fixture is put to a community vote, and the option with
        the most votes — including Skip — becomes the protocol's decision.
      </>
    ),
  },
  {
    q: "What is TXODDS and TxLINE?",
    a: (
      <>
        <a
          href="https://txodds.net/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 hover:text-foreground transition-colors duration-200"
        >
          TXODDS
        </a>{" "}
        is a global leader in sports betting data, providing real-time data
        feeds and sports trading infrastructure.{" "}
        <a
          href="https://txline-docs.txodds.com/documentation/quickstart"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 hover:text-foreground transition-colors duration-200"
        >
          TxLINE
        </a>{" "}
        is their blockchain-ready, high-performance data solution that provides
        cryptographically verifiable, on-chain proof of live sports data and
        settled matches, ensuring the absolute integrity and transparency of our
        prediction process.
      </>
    ),
  },
  {
    q: "Who pays the winnings?",
    a: "The Operator does. Before an approved prediction's match begins, the Operator must post USDC collateral equal to the maximum potential payout. If the prediction wins, that collateral funds the reward; if it loses, the Operator reclaims it.",
  },
  {
    q: "What if the Operator doesn't post collateral or disappears?",
    a: "If collateral isn't posted in time, the prediction is cancelled and the Operator's commission is reduced. If the Operator later fails to submit settlement proof, the protocol automatically defaults in favor of participants — the Operator forfeits their collateral plus an additional penalty.",
  },
  {
    q: "How is a prediction actually settled?",
    a: (
      <>
        Trustlessly, on-chain. Once a match ends, the Operator submits{" "}
        <a
          href="https://txodds.net/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 hover:text-foreground transition-colors duration-200"
        >
          TXODDS
        </a>
        ' cryptographic verification proof of the real result, and the protocol
        settles the prediction automatically — no manual intervention, no
        centralized bookmaker.
      </>
    ),
  },
  {
    q: "Can I unstake my principal anytime?",
    a: "Yes, while your batch is still in its Lobby phase you can deposit or withdraw freely. Once the batch locks for the week, principal stays locked until the batch settles — at which point you claim your full stake back alongside any rewards.",
  },
  {
    q: "What's the Weekly Jackpot?",
    a: "An optional, principal-free way to chase extra upside. After a batch settles, you can claim your rewards immediately or wager some/all of them into the shared jackpot for a chance at a much larger payout, decided by verifiable on-chain randomness. Your deposited principal is never eligible — only rewards you've already earned.",
  },
  {
    q: "What makes Undegen different from sports betting?",
    a: "You're never placing a personal bet. You stake stablecoins, the community collectively decides where the protocol's generated yield gets deployed, and only that yield is ever at risk — your principal stays protected the entire time.",
  },
];

export default function FAQ() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="p-6 rounded-2xl backdrop-blur-sm border border-border-low">
      <h2 className="text-xl font-bold mb-4">FAQ</h2>
      <div className="space-y-2">
        {items.map((item, idx) => (
          <div
            key={idx}
            className="border border-border-low rounded-lg overflow-hidden"
          >
            <button
              onClick={() => setOpen(open === idx ? null : idx)}
              className="w-full text-left p-4 flex justify-between items-center cursor-pointer"
            >
              <span className="font-medium">{item.q}</span>
              <motion.span
                animate={{ rotate: open === idx ? 180 : 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="text-muted inline-block origin-center"
              >
                ▼
              </motion.span>
            </button>
            <AnimatePresence initial={false}>
              {open === idx && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 text-sm text-muted">{item.a}</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </div>
  );
}
