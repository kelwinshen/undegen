"use client";

import React, { useState } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { useRouter, usePathname } from "next/navigation";
import ConnectWalletModal from "../ConnectWalletModal";

export default function Header() {
  const { connectors, connect, disconnect, wallet, status } =
    useWalletConnection();
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const address = wallet?.account.address?.toString();
  const router = useRouter();
  const pathname = usePathname();
  const isUpcoming = pathname === "/upcoming";

  return (
    <>
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-border-low pb-6">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-foreground to-foreground/75 dark:from-white dark:to-neutral-400">
            UNDEGEN
          </h1>
          <p className="text-sm text-muted mt-1">
            The Daily Prediction Syndicate. Zero principal risk.
          </p>
        </div>

        <div className="flex flex-col items-end gap-2 w-full md:w-auto">
          <div className="flex items-center gap-3 w-full md:w-auto">
            {status !== "connected" ? (
              <button
                onClick={() => setIsConnectModalOpen(true)}
                disabled={status === "connecting"}
                className="whitespace-nowrap rounded-xl border border-border-low bg-card px-4 py-2 text-xs font-medium transition hover:-translate-y-0.5 hover:shadow-sm cursor-pointer disabled:opacity-50"
              >
                {status === "connecting" ? "Connecting..." : "Connect Wallet"}
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-card border border-border-low px-3 py-1.5 rounded-xl text-xs font-mono">
                <span className="h-2 w-2 rounded-full bg-foreground animate-pulse" />
                <span>
                  {address
                    ? `${address.slice(0, 6)}...${address.slice(-4)}`
                    : "Connected"}
                </span>
                <button
                  onClick={() => disconnect()}
                  className="ml-2 text-muted hover:text-foreground font-sans underline cursor-pointer"
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => router.push("/")}
              className={`text-xs underline ${pathname === "/" ? "text-foreground font-semibold" : "text-muted hover:text-foreground"}`}
            >
              Active Batch (1)
            </button>
            <button
              onClick={() => router.push("/upcoming")}
              className={`text-xs underline ${isUpcoming ? "text-foreground font-semibold" : "text-muted hover:text-foreground"}`}
            >
              Upcoming Batches
            </button>
            <button
              onClick={() => router.push("/history")}
              className={`text-xs underline ${pathname === "/history" ? "text-foreground font-semibold" : "text-muted hover:text-foreground"}`}
            >
              History
            </button>
          </div>
        </div>
      </header>

      <ConnectWalletModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        connectors={connectors}
        connect={connect}
        isConnecting={status === "connecting"}
      />
    </>
  );
}
