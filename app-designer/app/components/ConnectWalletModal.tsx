"use client";

import React, { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import Image from "next/image";
import metamaskIcon from "../assets/logos_metamask-icon.svg";
import phantomIcon from "../assets/token-branded_phantom-background.svg";

interface Connector {
  id: string;
  name: string;
}

interface ConnectWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectors: readonly Connector[];
  connect: (connectorId: string) => void;
  isConnecting: boolean;
}

export default function ConnectWalletModal({
  isOpen,
  onClose,
  connectors,
  connect,
  isConnecting,
}: ConnectWalletModalProps) {
  // ESC key listener to close modal
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Find Phantom and MetaMask connectors
  const metamaskConnector = connectors.find((c) =>
    c.name.toLowerCase().includes("metamask")
  );
  const phantomConnector = connectors.find((c) =>
    c.name.toLowerCase().includes("phantom")
  );

  // Filter out MetaMask and Phantom from other connectors to avoid double listing them
  const otherConnectors = connectors.filter(
    (c) =>
      !c.name.toLowerCase().includes("metamask") &&
      !c.name.toLowerCase().includes("phantom")
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/75 backdrop-blur-sm"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: "spring", duration: 0.3, bounce: 0.15 }}
            className="relative z-10 w-full max-w-[360px] bg-card/90 dark:bg-black/75 border border-border-strong rounded-3xl p-6 shadow-2xl overflow-hidden font-sans text-left"
          >
            {/* Ambient Top Glow */}
            <div className="absolute -top-10 left-1/4 right-1/4 h-[80px] bg-foreground/5 dark:bg-white/10 rounded-full blur-[40px] pointer-events-none" />

            {/* Close Button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-1.5 rounded-full text-muted hover:text-foreground hover:bg-foreground/5 dark:text-gray-500 dark:hover:text-white dark:hover:bg-white/5 transition-all cursor-pointer"
              aria-label="Close modal"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>

            {/* Header */}
            <div className="mb-6">
              <h3 className="text-xl font-bold tracking-tight text-foreground">
                Connect
              </h3>
              <p className="text-xs text-muted mt-1">
                Select a method to sign in.
              </p>
            </div>

            {/* Wallet list */}
            <div className="space-y-2">
              {/* MetaMask option */}
              <button
                onClick={() => {
                  if (metamaskConnector) {
                    connect(metamaskConnector.id);
                  } else {
                    window.open("https://metamask.io/download/", "_blank");
                  }
                  onClose();
                }}
                disabled={isConnecting}
                className="flex items-center justify-between w-full p-4 rounded-2xl border border-border-low bg-foreground/[0.01] hover:bg-foreground/[0.03] hover:border-border active:scale-[0.98] transition-all duration-200 text-sm font-semibold text-foreground dark:border-white/[0.04] dark:bg-white/[0.02] dark:hover:bg-white/[0.06] dark:hover:border-white/[0.08] dark:text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-center gap-3.5">
                  <Image
                    src={metamaskIcon}
                    alt="MetaMask"
                    width={24}
                    height={24}
                    className="w-6 h-6 object-contain"
                  />
                  <span>MetaMask</span>
                </div>
                <svg
                  className="w-4 h-4 text-gray-500"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>

              {/* Phantom option */}
              <button
                onClick={() => {
                  if (phantomConnector) {
                    connect(phantomConnector.id);
                  } else {
                    window.open("https://phantom.app/", "_blank");
                  }
                  onClose();
                }}
                disabled={isConnecting}
                className="flex items-center justify-between w-full p-4 rounded-2xl border border-border-low bg-foreground/[0.01] hover:bg-foreground/[0.03] hover:border-border active:scale-[0.98] transition-all duration-200 text-sm font-semibold text-foreground dark:border-white/[0.04] dark:bg-white/[0.02] dark:hover:bg-white/[0.06] dark:hover:border-white/[0.08] dark:text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-center gap-3.5">
                  <Image
                    src={phantomIcon}
                    alt="Phantom"
                    width={24}
                    height={24}
                    className="w-6 h-6 object-contain rounded-lg"
                  />
                  <span>Phantom</span>
                </div>
                <svg
                  className="w-4 h-4 text-gray-500"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>

              {/* Dynamic list of other connectors if any */}
              {otherConnectors.map((connector) => (
                <button
                  key={connector.id}
                  onClick={() => {
                    connect(connector.id);
                    onClose();
                  }}
                  disabled={isConnecting}
                  className="flex items-center justify-between w-full p-4 rounded-2xl border border-border-low bg-foreground/[0.01] hover:bg-foreground/[0.03] hover:border-border active:scale-[0.98] transition-all duration-200 text-sm font-semibold text-foreground dark:border-white/[0.04] dark:bg-white/[0.02] dark:hover:bg-white/[0.06] dark:hover:border-white/[0.08] dark:text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-3.5">
                    <svg
                      className="w-6 h-6 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                    >
                      <rect x="3" y="4" width="18" height="16" rx="2" />
                      <path d="M21 10h-4a2 2 0 00-2 2v0a2 2 0 002 2h4" />
                    </svg>
                    <span>{connector.name}</span>
                  </div>
                  <svg
                    className="w-4 h-4 text-gray-500"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
