"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";

export default function BottomNavbar() {
  const router = useRouter();
  const pathname = usePathname();

  // State
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Auto-hide toast after 3 seconds
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const handlePlaceholderClick = (feature: string) => {
    setToastMessage(`${feature} feature coming soon!`);
  };

  return (
    <>
      {/* Toast Alert */}
      <AnimatePresence>
        {toastMessage && (
          <div className="fixed bottom-24 left-4 right-4 z-50 flex justify-center pointer-events-none">
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="bg-card/95 dark:bg-[#111218]/95 border border-border-strong text-foreground text-xs font-bold tracking-wider py-3 px-6 rounded-full shadow-2xl backdrop-blur-md flex items-center gap-2 pointer-events-auto"
            >
              <span className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
              {toastMessage}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Main Bottom Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden border-t border-border-low bg-background/80 backdrop-blur-md w-full py-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] font-sans transition-colors duration-200">
        <div className="mx-auto w-full max-w-lg flex items-center justify-around px-4">
          {/* LIVE TAB */}
          <Link
            href="/"
            className={`flex flex-col items-center justify-center gap-1 group cursor-pointer transition-colors ${
              pathname === "/" ? "text-foreground" : "text-muted hover:text-foreground"
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
              pathname === "/upcoming" ? "text-foreground" : "text-muted hover:text-foreground"
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
              pathname === "/history" ? "text-foreground" : "text-muted hover:text-foreground"
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
              pathname === "/news" ? "text-foreground" : "text-muted hover:text-foreground"
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

          {/* MORE TAB */}
          <button
            onClick={() => setIsDrawerOpen(true)}
            className={`flex flex-col items-center justify-center gap-1 group cursor-pointer transition-colors ${
              isDrawerOpen ? "text-foreground" : "text-muted hover:text-foreground"
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
              >
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
              </svg>
            </div>
            <span className="text-[10px] font-bold tracking-widest uppercase">
              More
            </span>
          </button>
        </div>
      </nav>

      {/* Drawer Overlay for More Menu */}
      <AnimatePresence>
        {isDrawerOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsDrawerOpen(false)}
              className="fixed inset-0 z-45 md:hidden bg-black/60 backdrop-blur-sm"
            />

            {/* Bottom Sheet Drawer */}
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-card border-t border-border-strong rounded-t-3xl pb-[calc(20px+env(safe-area-inset-bottom))] pt-6 px-6 font-sans shadow-2xl"
            >
              {/* Handle */}
              <div className="w-12 h-1 bg-border rounded-full mx-auto mb-6" />
 
              {/* Header */}
              <div className="flex justify-between items-center mb-8 px-1">
                <h3 className="text-lg font-bold tracking-wider text-foreground">
                  MORE
                </h3>
                <button
                  onClick={() => setIsDrawerOpen(false)}
                  className="p-1 rounded-full text-muted hover:text-foreground cursor-pointer transition-colors duration-150 focus:outline-none"
                  aria-label="Close menu"
                >
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              {/* Vertical Menu List */}
              <div className="flex flex-col gap-6 px-1 pb-4">
                {/* NEWS */}
                <button
                  onClick={() => {
                    router.push("/news");
                    setIsDrawerOpen(false);
                  }}
                  className="flex items-center gap-4 w-full text-left group cursor-pointer focus:outline-none transition-opacity hover:opacity-80 active:opacity-60"
                >
                  <div className="text-muted group-hover:text-foreground transition-colors duration-150">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
                      <path d="M18 14h-8" />
                      <path d="M15 18h-5" />
                      <path d="M10 6h8v4h-8V6Z" />
                    </svg>
                  </div>
                  <span className="text-base font-bold text-foreground tracking-wide">
                    FIFA News
                  </span>
                </button>

                {/* LOTTERY */}
                <button
                  onClick={() => {
                    router.push("/lottery");
                    setIsDrawerOpen(false);
                  }}
                  className="flex items-center gap-4 w-full text-left group cursor-pointer focus:outline-none transition-opacity hover:opacity-80 active:opacity-60"
                >
                  <div className="text-muted group-hover:text-foreground transition-colors duration-150">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 9a1 1 0 0 0 1-1V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2a1 1 0 0 0 0 8v2a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-2a1 1 0 0 0-1-1" />
                      <path d="M13 5v2" />
                      <path d="M13 17v2" />
                      <path d="M13 11v2" />
                    </svg>
                  </div>
                  <span className="text-base font-bold text-foreground tracking-wide">
                    Lottery
                  </span>
                </button>

                {/* HISTORY */}
                <button
                  onClick={() => {
                    router.push("/history");
                    setIsDrawerOpen(false);
                  }}
                  className="flex items-center gap-4 w-full text-left group cursor-pointer focus:outline-none transition-opacity hover:opacity-80 active:opacity-60"
                >
                  <div className="text-muted group-hover:text-foreground transition-colors duration-150">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  </div>
                  <span className="text-base font-bold text-foreground tracking-wide">
                    History
                  </span>
                </button>

                {/* ABOUT */}
                <button
                  onClick={() => {
                    handlePlaceholderClick("About");
                    setIsDrawerOpen(false);
                  }}
                  className="flex items-center gap-4 w-full text-left group cursor-pointer focus:outline-none transition-opacity hover:opacity-80 active:opacity-60"
                >
                  <div className="text-muted group-hover:text-foreground transition-colors duration-150">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                    </svg>
                  </div>
                  <span className="text-base font-bold text-foreground tracking-wide">
                    About
                  </span>
                </button>
 
                {/* EXPLORE */}
                <button
                  onClick={() => {
                    handlePlaceholderClick("Explore");
                    setIsDrawerOpen(false);
                  }}
                  className="flex items-center gap-4 w-full text-left group cursor-pointer focus:outline-none transition-opacity hover:opacity-80 active:opacity-60"
                >
                  <div className="text-muted group-hover:text-foreground transition-colors duration-150">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="18" y1="20" x2="18" y2="10" />
                      <line x1="12" y1="20" x2="12" y2="4" />
                      <line x1="6" y1="20" x2="6" y2="14" />
                    </svg>
                  </div>
                  <span className="text-base font-bold text-foreground tracking-wide">
                    Explore
                  </span>
                </button>
 
                {/* REWARDS */}
                <button
                  onClick={() => {
                    handlePlaceholderClick("Rewards");
                    setIsDrawerOpen(false);
                  }}
                  className="flex items-center gap-4 w-full text-left group cursor-pointer focus:outline-none transition-opacity hover:opacity-80 active:opacity-60"
                >
                  <div className="text-muted group-hover:text-foreground transition-colors duration-150">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="8" r="6" />
                      <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
                    </svg>
                  </div>
                  <span className="text-base font-bold text-foreground tracking-wide">
                    Rewards
                  </span>
                </button>
 
                {/* SHIELD */}
                <button
                  onClick={() => {
                    handlePlaceholderClick("Shield");
                    setIsDrawerOpen(false);
                  }}
                  className="flex items-center gap-4 w-full text-left group cursor-pointer focus:outline-none transition-opacity hover:opacity-80 active:opacity-60"
                >
                  <div className="text-muted group-hover:text-foreground transition-colors duration-150">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                  </div>
                  <span className="text-base font-bold text-foreground tracking-wide">
                    Shield
                  </span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
