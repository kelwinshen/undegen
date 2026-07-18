"use client";

import Link from "next/link";
import Header from "@/app/components/Header";

export default function TestHub() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-bg1 text-foreground">
      <main className="relative z-10 mx-auto flex min-h-screen max-w-2xl flex-col gap-8 border-x border-border-low px-6 py-12">
        <Header />
        <div className="p-6 bg-bg2 rounded-xl border border-border-low space-y-6">
          <h2 className="text-xl font-bold">Undegen Test Hub</h2>
          <p className="text-sm text-gray-400">
            Use these tools to interact with the Undegen Core program on devnet.
          </p>

          <div className="space-y-4">
            {/* Protocol */}
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-2">
                Protocol
              </h3>
              <div className="space-y-2">
                <Link
                  href="/test/initialize-protocol"
                  className="block p-3 bg-bg1 border border-border-low rounded-lg hover:border-emerald-400 transition-colors"
                >
                  <span className="text-sm font-medium">
                    Initialize Protocol
                  </span>
                  <p className="text-xs text-gray-400 mt-1">
                    Create the ProtocolConfig account (required before batch
                    creation).
                  </p>
                </Link>
              </div>
            </div>

            {/* Lottery */}
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-2">
                Lottery
              </h3>
              <div className="space-y-2">
                <Link
                  href="/test/initialize-lottery"
                  className="block p-3 bg-bg1 border border-border-low rounded-lg hover:border-emerald-400 transition-colors"
                >
                  <span className="text-sm font-medium">
                    Initialize Lottery
                  </span>
                  <p className="text-xs text-gray-400 mt-1">
                    Create the LotteryConfig account for the USDC mint (required
                    once).
                  </p>
                </Link>
                <Link
                  href="/test/start-round"
                  className="block p-3 bg-bg1 border border-border-low rounded-lg hover:border-emerald-400 transition-colors"
                >
                  <span className="text-sm font-medium">Start Round</span>
                  <p className="text-xs text-gray-400 mt-1">
                    Start the next lottery round and create its jackpot token
                    account.
                  </p>
                </Link>
              </div>
            </div>

            {/* Yield Vault */}
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-2">
                Yield Vault
              </h3>
              <div className="space-y-2">
                <Link
                  href="/test/initialize-yield-vault"
                  className="block p-3 bg-bg1 border border-border-low rounded-lg hover:border-emerald-400 transition-colors"
                >
                  <span className="text-sm font-medium">
                    Initialize Yield Vault
                  </span>
                  <p className="text-xs text-gray-400 mt-1">
                    Create the vault config for USDC (required before joining
                    any batch).
                  </p>
                </Link>
                <Link
                  href="/test/fund-reserve"
                  className="block p-3 bg-bg1 border border-border-low rounded-lg hover:border-emerald-400 transition-colors"
                >
                  <span className="text-sm font-medium">Fund Reserve</span>
                  <p className="text-xs text-gray-400 mt-1">
                    Deposit USDC into the reserve (admin only).
                  </p>
                </Link>
                <Link
                  href="/test/tick-yield"
                  className="block p-3 bg-bg1 border border-border-low rounded-lg hover:border-emerald-400 transition-colors"
                >
                  <span className="text-sm font-medium">Tick Yield</span>
                  <p className="text-xs text-gray-400 mt-1">
                    Compound yield by moving reserve funds into the vault (admin
                    only).
                  </p>
                </Link>
              </div>
            </div>

            {/* Batch */}
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-2">
                Batch
              </h3>
              <div className="space-y-2">
                <Link
                  href="/test/initialize-batch"
                  className="block p-3 bg-bg1 border border-border-low rounded-lg hover:border-emerald-400 transition-colors"
                >
                  <span className="text-sm font-medium">Initialize Batch</span>
                  <p className="text-xs text-gray-400 mt-1">
                    Create a new batch account on‑chain using the operator
                    secret key.
                  </p>
                </Link>
                <Link
                  href="/test/join-batch"
                  className="block p-3 bg-bg1 border border-border-low rounded-lg hover:border-emerald-400 transition-colors"
                >
                  <span className="text-sm font-medium">Join Batch</span>
                  <p className="text-xs text-gray-400 mt-1">
                    Deposit USDC into a batch using your connected wallet.
                  </p>
                </Link>
                <Link
                  href="/test/start-batch"
                  className="block p-3 bg-bg1 border border-border-low rounded-lg hover:border-emerald-400 transition-colors"
                >
                  <span className="text-sm font-medium">Start Batch</span>
                  <p className="text-xs text-gray-400 mt-1">
                    Transition a batch from Lobby to Locked.
                  </p>
                </Link>
                <Link
                  href="/test/propose-match"
                  className="block p-3 bg-bg1 border border-border-low rounded-lg hover:border-emerald-400 transition-colors"
                >
                  <span className="text-sm font-medium">Propose Match</span>
                  <p className="text-xs text-gray-400 mt-1">
                    Propose up to 4 predicates for a fixture to a batch.
                  </p>
                </Link>
                <Link
                  href="/test/cast-vote"
                  className="block p-3 bg-bg1 border border-border-low rounded-lg hover:border-emerald-400 transition-colors"
                >
                  <span className="text-sm font-medium">Cast Vote</span>
                  <p className="text-xs text-gray-400 mt-1">
                    Vote on a proposal or skip.
                  </p>
                </Link>
                <Link
                  href="/test/deposit-collateral"
                  className="block p-3 bg-bg1 border border-border-low rounded-lg hover:border-emerald-400 transition-colors"
                >
                  <span className="text-sm font-medium">
                    Deposit Collateral
                  </span>
                  <p className="text-xs text-gray-400 mt-1">
                    Deposit operator collateral after consensus (mock proofs).
                  </p>
                </Link>
                <Link
                  href="/test/batch-details"
                  className="block p-3 bg-bg1 border border-border-low rounded-lg hover:border-emerald-400 transition-colors"
                >
                  <span className="text-sm font-medium">Batch Details</span>
                  <p className="text-xs text-gray-400 mt-1">
                    Fetch and decode on‑chain batch account data.
                  </p>
                </Link>
                <Link
                  href="/test/finalize-consensus"
                  className="block p-3 bg-bg1 border border-border-low rounded-lg hover:border-emerald-400 transition-colors"
                >
                  <span className="text-sm font-medium">
                    Finalize Consensus
                  </span>
                  <p className="text-xs text-gray-400 mt-1">
                    Determine the winning vote index after voting closes.
                  </p>
                </Link>
                <Link
                  href="/test/settle-with-proof"
                  className="block p-3 bg-bg1 border border-border-low rounded-lg hover:border-emerald-400 transition-colors"
                >
                  <span className="text-sm font-medium">Settle with Proof</span>
                  <p className="text-xs text-gray-400 mt-1">
                    Provide scores proof and outcome to settle the batch.
                  </p>
                </Link>
                <Link
                  href="/test/settle-default"
                  className="block p-3 bg-bg1 border border-border-low rounded-lg hover:border-emerald-400 transition-colors"
                >
                  <span className="text-sm font-medium">Settle Default</span>
                  <p className="text-xs text-gray-400 mt-1">
                    Trigger settle_default when collateral deadline is missed.
                  </p>
                </Link>
                <Link
                  href="/test/claim"
                  className="block p-3 bg-bg1 border border-border-low rounded-lg hover:border-emerald-400 transition-colors"
                >
                  <span className="text-sm font-medium">Claim</span>
                  <p className="text-xs text-gray-400 mt-1">
                    Claim your share of winnings or refund after batch
                    settlement.
                  </p>
                </Link>
                <Link
                  href="/test/claim-operator-yield"
                  className="block p-3 bg-bg1 border border-border-low rounded-lg hover:border-emerald-400 transition-colors"
                >
                  <span className="text-sm font-medium">
                    Claim Operator Yield
                  </span>
                  <p className="text-xs text-gray-400 mt-1">
                    Operator claims their yield share from a settled batch.
                  </p>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
