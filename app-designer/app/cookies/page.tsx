import Link from "next/link";

export default function CookiesPage() {
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
            Cookies Policy
          </h1>
          <p className="text-sm text-muted mt-2">
            Last updated: July 8, 2026
          </p>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-6 text-sm text-muted leading-relaxed">
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground">1. What Are Cookies</h2>
            <p>
              Cookies are small text files stored on your device by your web browser when you visit websites. They help remember configurations and user settings to provide a personalized, functional experience.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground">2. How We Use Cookies</h2>
            <p>
              We use cookies to maintain your wallet session connection state and remember layout settings (such as light/dark mode preference overrides). These cookies are essential for the operation of the web application and do not gather information for tracking or profiling.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground">3. Types of Cookies Used</h2>
            <ul className="list-disc list-inside space-y-2 pl-2">
              <li>
                <strong>Essential Cookies:</strong> Critical for wallet authentication, security checks, and keeping you logged in.
              </li>
              <li>
                <strong>Preference Cookies:</strong> Used to remember your visual preferences, active tabs, or custom filters.
              </li>
              <li>
                <strong>Analytics Cookies:</strong> Anonymized cookies that track traffic flow to help us optimize server capacity.
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground">4. Controlling Cookies</h2>
            <p>
              You can configure your browser to block or delete cookies. However, please note that disabling essential cookies will prevent you from connecting your wallet or maintaining a persistent session on the platform.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
