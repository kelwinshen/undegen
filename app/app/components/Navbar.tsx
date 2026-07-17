"use client";

import React, { useState, useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWalletConnection } from "@solana/react-hooks";
import logoWithText from "../assets/logo-with-text.png";
import logoWithTextDark from "../assets/logo-with-text-dark.png";
import ConnectWalletModal from "./ConnectWalletModal";
import { useUndegenProgram } from "../context/UndegenProgramContext";
import { SOLANA_CONFIG } from "../lib/solanaConfig";

// USDC's on-chain precision — shown in full rather than rounded.
const AMOUNT_DECIMALS = SOLANA_CONFIG.TOKEN_DECIMALS;

export default function Navbar() {
  const pathname = usePathname();
  const { connectors, connect, disconnect, wallet, status } =
    useWalletConnection();
  const { usdcBalance } = useUndegenProgram();

  const address = wallet?.account?.address?.toString() ?? null;
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  // State for menus
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isWalletDropdownOpen, setIsWalletDropdownOpen] = useState(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [addressCopied, setAddressCopied] = useState(false);

  // Refs for click outside
  const menuRef = useRef<HTMLDivElement>(null);
  const walletDropdownRef = useRef<HTMLDivElement>(null);

  // Formatting address
  const formattedAddress = address
    ? `${address.slice(0, 4)}...${address.slice(-4)}`
    : "";

  const handleCopyAddress = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setAddressCopied(true);
    setTimeout(() => setAddressCopied(false), 1500);
  };

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

              {/* LOTTERY link */}
              <Link
                href="/lottery"
                className={`relative py-2 transition-colors ${
                  pathname === "/lottery"
                    ? "text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                LOTTERY
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
                  <span className="h-2 w-2 rounded-full bg-foreground animate-pulse" />
                  <span className="text-muted">{formattedAddress}</span>
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
                      <button
                        onClick={handleCopyAddress}
                        className="w-full flex items-center justify-between gap-2 mt-0.5 group cursor-pointer"
                        title="Copy address"
                      >
                        <span className="text-xs font-mono text-foreground break-all text-left">
                          {address}
                        </span>
                        <svg
                          className="w-3.5 h-3.5 text-muted group-hover:text-foreground shrink-0 transition-colors"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          {addressCopied ? (
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2.5"
                              d="M4.5 12.75l6 6 9-13.5"
                            />
                          ) : (
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5A3.375 3.375 0 006.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0015 2.25h-1.5a2.251 2.251 0 00-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12.75c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5a9 9 0 00-9-9z"
                            />
                          )}
                        </svg>
                      </button>
                      {addressCopied && (
                        <p className="text-[10px] text-foreground mt-1">Copied!</p>
                      )}
                      <p className="text-[10px] text-muted font-bold tracking-wider uppercase mt-2">
                        USDC Balance
                      </p>
                      <p className="text-sm font-mono text-foreground mt-0.5">
                        {usdcBalance.toFixed(AMOUNT_DECIMALS)} USDC
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
