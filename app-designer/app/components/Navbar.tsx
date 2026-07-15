"use client";

import React, { useState, useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWalletConnection } from "@solana/react-hooks";
import logoWithText from "../assets/logo-with-text.png";
import logoWithTextDark from "../assets/logo-with-text-dark.png";
import ConnectWalletModal from "./ConnectWalletModal";

export default function Navbar() {
  const pathname = usePathname();
  const { connectors, connect, disconnect, wallet, status } =
    useWalletConnection();

  const address = wallet?.account?.address?.toString() ?? null;
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  // State for menus
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isWalletDropdownOpen, setIsWalletDropdownOpen] = useState(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);

  // Refs for click outside
  const menuRef = useRef<HTMLDivElement>(null);
  const walletDropdownRef = useRef<HTMLDivElement>(null);

  // Formatting address
  const formattedAddress = address
    ? `${address.slice(0, 4)}...${address.slice(-4)}`
    : "";

  // Handle click outside to close dropdowns
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
      if (
        walletDropdownRef.current &&
        !walletDropdownRef.current.contains(event.target as Node)
      ) {
        setIsWalletDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xs border-b border-border-low w-full font-sans">
        <div className="mx-auto  w-full h-20 flex items-center justify-between px-6">
          {/* Left section: Logo & Nav Links */}
          <div className="flex items-center gap-8">
            {/* Logo */}
            <Link
              href="/"
              className="flex items-center transition-opacity hover:opacity-90"
            >
              <Image
                src={logoWithTextDark}
                alt="UNDEGEN Logo"
                width={140}
                height={36}
                priority
                className="h-9 w-auto object-contain dark:hidden"
              />
              <Image
                src={logoWithText}
                alt="UNDEGEN Logo"
                width={140}
                height={36}
                priority
                className="h-9 w-auto object-contain hidden dark:block"
              />
            </Link>

            {/* Navigation Links */}
            <div className="hidden md:flex items-center gap-6 text-sm font-semibold tracking-wider">
              {/* LIVE link */}
              <Link
                href="/"
                className={`relative py-2 transition-colors ${
                  pathname === "/"
                    ? "text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                LIVE
              </Link>

              {/* UPCOMING link */}
              <Link
                href="/upcoming"
                className={`relative py-2 transition-colors ${
                  pathname === "/upcoming"
                    ? "text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                UPCOMING
              </Link>

              {/* HISTORY link */}
              <Link
                href="/history"
                className={`relative py-2 transition-colors ${
                  pathname === "/history"
                    ? "text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                HISTORY
              </Link>

              {/* NEWS link */}
              <Link
                href="/news"
                className={`relative py-2 transition-colors ${
                  pathname === "/news"
                    ? "text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                NEWS
              </Link>

              {/* Hamburger menu dropdown trigger */}
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setIsMenuOpen(!isMenuOpen)}
                  className="p-2 -m-2 text-muted hover:text-foreground cursor-pointer focus:outline-none flex items-center"
                  aria-label="Toggle menu"
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
                      strokeWidth="2"
                      d="M4 6h16M4 12h16M4 18h16"
                    />
                  </svg>
                </button>

                {/* Hamburger Dropdown Menu */}
                {isMenuOpen && (
                  <div className="absolute left-0 mt-3 w-40 bg-background border border-border-strong rounded-lg shadow-xl py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                    <Link
                      href="/"
                      onClick={() => setIsMenuOpen(false)}
                      className="block px-4 py-2.5 text-xs font-bold tracking-widest text-muted hover:text-foreground hover:bg-foreground/5 transition-colors"
                    >
                      MATCH
                    </Link>
                    <button
                      onClick={() => setIsMenuOpen(false)}
                      className="w-full text-left block px-4 py-2.5 text-xs font-bold tracking-widest text-muted hover:text-foreground hover:bg-foreground/5 transition-colors cursor-pointer"
                    >
                      MENU #1
                    </button>
                    <button
                      onClick={() => setIsMenuOpen(false)}
                      className="w-full text-left block px-4 py-2.5 text-xs font-bold tracking-widest text-muted hover:text-foreground hover:bg-foreground/5 transition-colors cursor-pointer"
                    >
                      MENU #1
                    </button>
                    <button
                      onClick={() => setIsMenuOpen(false)}
                      className="w-full text-left block px-4 py-2.5 text-xs font-bold tracking-widest text-muted hover:text-foreground hover:bg-foreground/5 transition-colors cursor-pointer"
                    >
                      MENU #1
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right section: Wallet Connection Button */}
          <div className="flex items-center">
            {isConnected ? (
              <div className="relative" ref={walletDropdownRef}>
                <button
                  onClick={() => setIsWalletDropdownOpen(!isWalletDropdownOpen)}
                  className="px-5 py-2.5 rounded-full border border-border-low bg-card hover:bg-foreground/5 text-sm font-semibold tracking-wide transition-all duration-200 flex items-center gap-2 cursor-pointer shadow-sm"
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>{formattedAddress}</span>
                  <svg
                    className={`w-4 h-4 text-muted transition-transform duration-200 ${
                      isWalletDropdownOpen ? "rotate-180" : ""
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>

                {/* Wallet Info & Disconnect Dropdown */}
                {isWalletDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-background border border-border-strong rounded-xl shadow-xl py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="px-4 py-2 border-b border-border-low">
                      <p className="text-[10px] text-muted font-bold tracking-wider uppercase">
                        Wallet Connected
                      </p>
                      <p className="text-xs font-mono text-foreground break-all mt-0.5">
                        {address}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        disconnect();
                        setIsWalletDropdownOpen(false);
                      }}
                      className="w-full text-left block px-4 py-2.5 text-xs font-bold tracking-widest text-rose-500 hover:text-rose-400 hover:bg-foreground/5 transition-colors cursor-pointer"
                    >
                      DISCONNECT
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="relative">
                <button
                  onClick={() => setIsConnectModalOpen(true)}
                  disabled={isConnecting}
                  className="px-3 lg:px-6 py-2.5 rounded-full bg-foreground hover:bg-foreground/90 text-background text-xs lg:text-sm font-bold tracking-wide transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:scale-105 active:scale-95"
                >
                  {isConnecting ? "Connecting..." : "Connect Wallet"}
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <ConnectWalletModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        connectors={connectors}
        connect={connect}
        isConnecting={isConnecting}
      />
    </>
  );
}
