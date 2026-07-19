"use client";

import { SolanaProvider } from "@solana/react-hooks";
import { PropsWithChildren } from "react";
import { autoDiscover, createClient } from "@solana/client";
import { UndegenProgramProvider } from "../context/UndegenProgramContext";

const client = createClient({
  endpoint: "https://api.devnet.solana.com",
  walletConnectors: autoDiscover(),
});

export function Providers({ children }: PropsWithChildren) {
  return (
    <SolanaProvider client={client}>
      <UndegenProgramProvider>{children}</UndegenProgramProvider>
    </SolanaProvider>
  );
}
