"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function BottomNavbar() {
  const pathname = usePathname();

  return (
    <>
      {/* Main Bottom Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden border-t border-border-low bg-background/80 backdrop-blur-md w-full py-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] font-sans transition-colors duration-200">
        <div className="mx-auto w-full max-w-lg flex items-center justify-around px-4">
          {/* LIVE TAB */}
          <Link
            href="/"
            className={`flex flex-col items-center justify-center gap-1 group cursor-pointer transition-colors ${
              pathname === "/"
                ? "text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            <div className="p-1 rounded-lg transition-transform duration-200 group-active:scale-90">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="2" fill="currentColor" />
                <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
              </svg>
            </div>
            <span className="text-[10px] font-bold tracking-widest uppercase">
              Live
            </span>
          </Link>

          {/* UPCOMING TAB */}
          <Link
            href="/upcoming"
            className={`flex flex-col items-center justify-center gap-1 group cursor-pointer transition-colors ${
              pathname === "/upcoming"
                ? "text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            <div className="p-1 rounded-lg transition-transform duration-200 group-active:scale-90">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <span className="text-[10px] font-bold tracking-widest uppercase">
              Upcoming
            </span>
          </Link>

          {/* HISTORY TAB */}
          <Link
            href="/history"
            className={`flex flex-col items-center justify-center gap-1 group cursor-pointer transition-colors ${
              pathname === "/history"
                ? "text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            <div className="p-1 rounded-lg transition-transform duration-200 group-active:scale-90">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <span className="text-[10px] font-bold tracking-widest uppercase">
              History
            </span>
          </Link>

          {/* NEWS TAB */}
          <Link
            href="/news"
            className={`flex flex-col items-center justify-center gap-1 group cursor-pointer transition-colors ${
              pathname === "/news"
                ? "text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            <div className="p-1 rounded-lg transition-transform duration-200 group-active:scale-90">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
                <path d="M18 14h-8" />
                <path d="M15 18h-5" />
                <path d="M10 6h8v4h-8V6Z" />
              </svg>
            </div>
            <span className="text-[10px] font-bold tracking-widest uppercase">
              News
            </span>
          </Link>

          {/* LOTTERY TAB */}
          <Link
            href="/lottery"
            className={`flex flex-col items-center justify-center gap-1 group cursor-pointer transition-colors ${
              pathname === "/lottery"
                ? "text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            <div className="p-1 rounded-lg transition-transform duration-200 group-active:scale-90">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 9a1 1 0 0 0 1-1V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2a1 1 0 0 0 0 8v2a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-2a1 1 0 0 0-1-1" />
                <path d="M13 5v2" />
                <path d="M13 17v2" />
                <path d="M13 11v2" />
              </svg>
            </div>
            <span className="text-[10px] font-bold tracking-widest uppercase">
              Lottery
            </span>
          </Link>
        </div>
      </nav>
    </>
  );
}
