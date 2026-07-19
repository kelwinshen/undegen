import Link from "next/link";

export default function Footer() {
  return (
    <footer className="w-full border-t border-border-low font-sans">
      <div className="mx-auto max-w-6xl px-6 pt-6 pb-24 md:py-8 flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Left Side: Copyright */}
        <p className="text-sm text-muted">
          &copy; 2026 Undegen. All rights reserved. Powered by{" "}
          <Link
            href="https://txodds.net/"
            className="transition-colors duration-200 hover:text-foreground underline underline-offset-4"
          >
            txodds
          </Link>
        </p>

        {/* Right Side: Links */}
        <div className="flex items-center gap-6 text-sm font-medium text-muted">
          <Link
            href="/terms"
            className="transition-colors duration-200 hover:text-foreground"
          >
            Terms
          </Link>
          <Link
            href="/privacy"
            className="transition-colors duration-200 hover:text-foreground"
          >
            Privacy
          </Link>
          <Link
            href="/cookies"
            className="transition-colors duration-200 hover:text-foreground"
          >
            Cookies
          </Link>
        </div>
      </div>
    </footer>
  );
}
