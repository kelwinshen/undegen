import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-transparent text-foreground">
      <main className="relative z-10 mx-auto max-w-3xl min-h-screen px-6 pt-28 pb-24 md:pb-16 flex flex-col gap-8">
        {/* Back Button */}
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground transition-colors duration-200"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            Back to Home
          </Link>
        </div>

        {/* Header */}
        <div className="border-b border-border-low pb-6">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
            Privacy Policy
          </h1>
          <p className="text-sm text-muted mt-2">Last updated: July 8, 2026</p>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-6 text-sm text-muted leading-relaxed">
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground">
              1. Information We Collect
            </h2>
            <p>
              We do not collect traditional personal identity information (such
              as names or emails) unless provided directly. When you connect a
              wallet, we collect public keys/wallet addresses and associated
              publicly-visible on-chain transactions relevant to our protocol.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground">
              2. How We Use Information
            </h2>
            <p>
              Your public key is used to authenticate sessions, sync vote
              statuses with the smart contracts, compile consensus results, and
              verify stake eligibility. Any technical metadata (such as IP or
              device information) is utilized solely for security verification
              and denial-of-service prevention.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground">
              3. Sharing of Information
            </h2>
            <p>
              All transactional data and predictions are stored on the public
              Solana blockchain and are viewable globally. We do not sell or
              lease private server data to third parties, though analytical
              providers may collect generalized usage metrics to help improve
              user experience.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground">
              4. Data Security &amp; Blockchain
            </h2>
            <p>
              While we implement industry-standard server security, please note
              that information recorded on a public blockchain cannot be
              modified or deleted. By interacting with the platform, you
              acknowledge the permanent public nature of on-chain transactions.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground">
              5. Your Choices &amp; Rights
            </h2>
            <p>
              You can disconnect your wallet or stop using the application at
              any time. Because data on the blockchain is decentralized, we do
              not have the technical ability to erase or modify past
              transactions or ledger states.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
