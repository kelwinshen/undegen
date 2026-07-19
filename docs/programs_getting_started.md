# Solana Programs – Getting Started Guide

The **Undegen Solana Programs** (`programs/`) contain the on-chain smart contracts written in Rust using the **Anchor** framework (`v0.32.1`).

---

## Prerequisites

- **Rust**: `rustc 1.89.0` or compatible stable compiler
- **Solana CLI**: `solana-cli` installed and configured
- **Anchor CLI**: `v0.32.1` installed (`anchor --version`)
- **mise**: Task runner ([mise.rs](https://mise.rs))

---

## Program Workspace Overview

The Anchor workspace contains three programs defined in `Anchor.toml`:

| Program Name | Folder | Program ID (Devnet/Localnet) |
| :--- | :--- | :--- |
| `undegen_core` | `programs/undegen_core` | `7HqLyczSoYYkru9xQ2QwiAN3kp156h2fr4z8EMeNJs3X` |
| `lottery` | `programs/lottery` | `BkMhRmJCsnZ2bW9RkjK3mPQTEbtY6gpnX8H7AJQRrmbh` |
| `yield_vault` | `programs/yield_vault` | `EBYBucMwfqYEXc9Hh56TpjwqxvgZDoJjWJoVc8sbFqPS` |

---

## Compiling & Testing Programs via `mise`

```bash
# 1. Build all Anchor programs
mise run anchor:build

# 2. Run Rust unit tests for program instructions
mise run anchor:test
```

### Direct Anchor CLI Commands

You can also execute standard Anchor CLI commands from the project root:

```bash
# Compile programs
anchor build

# Run Anchor integration tests
anchor test

# Deploy to configured cluster (devnet / localnet)
anchor deploy
```

---

## Configuration (`Anchor.toml`)

- **Cluster Provider**: Configured to `devnet` by default (`provider.cluster = "devnet"`).
- **Wallet Keypair**: Default wallet path set to `~/.config/solana/id.json`.
- **Test Scripts**: Invokes `cargo test` for unit testing.
