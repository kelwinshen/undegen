# Client Application – Getting Started Guide

The **Undegen Client Application** (`app/`) is a Next.js 16 web application that provides user interfaces for browsing prediction batches, casting consensus votes, depositing collateral, viewing live sports odds, and managing wallet interactions.

---

## Prerequisites

- **Node.js** (`v20.19.0` managed via `mise`)
- **pnpm** (`v10.5.2` managed via `mise`)
- **mise** task runner ([mise.rs](https://mise.rs))
- **Docker** (Optional, to run local Redis container for match metadata lookups)

---

## Installation & Configuration

### 1. Install Dependencies

```bash
# Install frontend packages
mise run install
```

### 2. Configure Environment Variables

Create or edit `app/.env`:

```env
BEARER_TOKEN=eyJ0eXAiOiJKV1...      # TxOdds API Authorization Bearer Token
API_TOKEN=txoracle_api_...          # TxOdds API Key
NEXT_PUBLIC_OPERATOR_SECRET_KEY=... # Base58 Operator Secret Key
NEXT_PUBLIC_ALT_ADDRESS=...         # Address Lookup Table Key
REDIS_URL=redis://localhost:6379     # Redis connection string for read-only fixture metadata
```

---

## Local Development Workflow

All frontend actions are run via `mise` tasks:

```bash
# 1. (Optional) Start Redis container for fixture metadata lookups
mise run redis

# 2. Run Next.js development server
mise run dev
# App will be live on http://localhost:3000

# 3. Run ESLint checks
mise run lint

# 4. Format code with Prettier
mise run format
mise run format:check

# 5. Run full CI suite (build + lint + format check)
mise run ci
```

---

## Production Build & Execution

```bash
# Build production bundle
mise run build

# Run standalone production server
mise run start
```
