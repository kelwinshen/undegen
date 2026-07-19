# Getting Started – Undegen Overview

Welcome to **Undegen**, a decentralized sports prediction, voting consensus, and yield protocol built on **Solana**, **Anchor**, and **Next.js**.

The Undegen repository is divided into three core subsystems. Follow the specialized guide for the component you are working on:

---

## Component Getting Started Guides

| Component | Directory | Guide Link | Focus |
| :--- | :--- | :--- | :--- |
| **Operator Service** | `operator/` | **[Operator Getting Started](./operator_getting_started.md)** | Rust background daemon, polling loop, proof generation & `mise run operator:run` |
| **Client Application** | `app/` | **[Client App Getting Started](./app_getting_started.md)** | Next.js 16 UI, Web3 wallet integration & `mise run dev` |
| **Solana Programs** | `programs/` | **[Solana Programs Getting Started](./programs_getting_started.md)** | Anchor Rust smart contracts, `Anchor.toml`, `mise run anchor:build` & tests |

---

## Prerequisites (Global)

- **Rust** (v1.89.0 compatible stable toolchain)
- **Solana CLI** (configured for devnet or localnet)
- **Anchor CLI** (`v0.32.1`)
- **mise** task runner ([mise.rs](https://mise.rs))
- **Docker & Docker Compose** (For local Redis container)

---

## Quick Reference Commands (`mise`)

```bash
# Install toolchains (Node 20.19.0 & pnpm 10.5.2) & dependencies
mise install
mise run install

# Start Redis infrastructure container
mise run redis

# Run Operator Service daemon
mise run operator:run

# Run Next.js frontend development server
mise run dev

# Build Anchor Solana programs
mise run anchor:build

# Run Anchor Rust tests
mise run anchor:test
```
