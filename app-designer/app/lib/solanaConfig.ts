/**
 * Solana Integration Configuration
 * 
 * Smart Contract Developers: Edit these constants to point the frontend
 * to your deployed Anchor programs, custom RPC endpoints, and tokens.
 */
export const SOLANA_CONFIG = {
  // If true, the frontend will run completely on client-side mock data and simulation.
  // Set to false to start routing queries and transactions through RPC / Wallet Standard.
  MOCK_MODE: true,

  // Deployed Anchor Program ID (undegen_core, devnet)
  PROGRAM_ID: "4KdYywAokwbLWNZ6XFtr6boho1JprUTuhYsoGuu4dVRY",

  // Deployed yield_vault Program ID (devnet)
  YIELD_VAULT_PROGRAM_ID: "EBYBucMwfqYEXc9Hh56TpjwqxvgZDoJjWJoVc8sbFqPS",

  // RPC cluster endpoint URL
  RPC_URL: "https://api.devnet.solana.com",

  // USDC Mint Address (devnet test USDC used by undegen_core)
  USDC_MINT: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",

  // Decimals of the deposit token (USDC uses 6)
  TOKEN_DECIMALS: 6,

  // Commitment level for RPC calls and transaction confirmation
  COMMITMENT: "confirmed" as const,
};
