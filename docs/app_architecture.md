# Client Application – Architecture & Design

The **Undegen Client Application** (`app/`) is a Next.js 16 web interface built using React 19, TailwindCSS, Framer Motion, Three.js, and Solana Web3 libraries. It serves as the primary user interface for participants to connect wallets, subscribe to on-chain program state changes, browse prediction batches, join pools, cast consensus votes, and view live market odds fetched from TxOdds.

---

## Technical Stack

- **Framework**: Next.js 16 (App Router) + React 19
- **Solana Integration**: `@coral-xyz/anchor`, `@solana/web3.js`, `@solana/react-hooks` (Account & Program State Subscription)
- **Styling & Animation**: TailwindCSS v4, Framer Motion (`motion`), Three.js (`three`)
- **Data Reading & Lookup**: Redis via `ioredis` (Read-only fixture metadata lookups)
- **Oracle Data Proxy**: TxOdds REST API Integration

---

## Application Structure

```text
app/
├── app/
│   ├── api/                     # Next.js Serverless API Routes
│   │   └── txodds/              # Live fixtures & odds proxy endpoints
│   ├── components/              # Interactive UI components
│   │   ├── ConsensusVoting.tsx  # Match voting interface
│   │   ├── LobbyPhase.tsx       # Batch joining & deposit UI
│   │   └── SyndicateSidebar.tsx # User syndicate & yield stats
│   ├── context/
│   │   └── UndegenProgramContext.tsx # Anchor provider, wallet & account subscriptions
│   ├── services/
│   │   └── undegenProgram.ts    # Program instruction builders & transaction helpers
│   └── lib/
│       └── redis.ts             # Redis connection manager
├── docker-compose.yml           # Redis container specification
└── package.json                 # Node dependencies & package metadata
```

---

## Client Interactions & Data Subscriptions

The Next.js client operates independently from the background operator daemon:

1. **Solana Program Subscriptions**: Subscribes directly to on-chain Solana account and contract state updates (`undegen_core`) to display live batch states, active voting phases, user balances, and settlement results in real time.
2. **TxOdds Market Fetching**: Reads metadata from Redis to identify active match fixtures, then fetches live market odds directly from the TxOdds API proxy (`/api/txodds`) for UI rendering.
3. **Wallet Transactions**: Constructs and signs user transactions (`join_batch`, `cast_vote`, `claim`) directly against the Solana blockchain.
