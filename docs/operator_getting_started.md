# Operator Service – Getting Started Guide

The **Undegen Operator Service** (`operator/`) is a high-performance background daemon built in Rust. It automates off-chain monitoring, polling TxOdds market fixtures, managing batch state transitions, depositing collateral with cryptographic proofs, and settling matches on Solana.

---

## Prerequisites

Before running the operator service, ensure you have:

- **Rust & Cargo** (`rustc 1.89.0` or compatible stable toolchain)
- **mise** task runner ([mise.rs](https://mise.rs))
- **Running Redis Container**: The operator uses Redis for state caching and connection pooling (`mise run redis`)
- **Solana Devnet RPC Endpoint**
- **TxOdds API Credentials** (`BEARER_TOKEN` and `API_TOKEN`)

---

## Configuration

The operator reads configuration from `operator/config.yml` and environment variables.

### `operator/config.yml` Parameters

| Parameter | Default | Description |
| :--- | :--- | :--- |
| `tick_interval_secs` | `5` | Polling loop interval in seconds |
| `lobby_duration_secs` | `86400` | Lobby phase duration (24 hrs) |
| `max_active_batches` | `4` | Maximum concurrent active prediction batches |
| `batch_apy_bps` | `500` | Target APY in basis points (5.00%) |
| `operator_yield_bps` | `400` | Operator fee allocation in basis points (4.00%) |
| `min_batch_users` | `1` | Minimum participants required to start a batch |
| `undegen_program_id` | `4KdYyw...` | On-chain `undegen_core` program address |
| `lottery_program_id` | `AH9Uib...` | On-chain `lottery` program address |
| `yield_vault_program_id` | `EBYBuc...` | On-chain `yield_vault` program address |

### Environment Variables

Set environment variables in `app/.env` or export them in your shell:

```env
RUST_LOG=info                        # Logging level (info, debug, trace)
REDIS_URL=redis://localhost:6379     # Redis connection pool URL
BEARER_TOKEN=your_txodds_bearer_token # TxOdds API Authorization Bearer Token
API_TOKEN=your_txodds_api_token       # TxOdds API Token (X-Api-Token)
NEXT_PUBLIC_OPERATOR_SECRET_KEY=     # Base58 secret key for operator wallet
```

---

## Running the Operator via `mise`

All operator tasks are integrated into `mise.toml`:

```bash
# 1. Ensure Redis is running
mise run redis

# 2. Run the Operator Service daemon
mise run operator:run

# 3. Build release binary for production deployment
mise run operator:build

# 4. Check codebase for compiler warnings or errors
mise run operator:check
```

---

## Operations & Monitoring

When launched via `mise run operator:run`, the daemon will:
1. Initialize tracing and load `operator/config.yml`.
2. Connect to the Solana RPC cluster and Redis connection pool.
3. Start the polling tick loop (default: every 5 seconds).
4. Monitor on-chain batch states and automatically execute required transactions (`propose_match`, `finalize_consensus`, `deposit_collateral`, `settle_with_proof`).
5. Gracefully shut down upon receiving a `SIGINT` / `Ctrl+C` signal.
