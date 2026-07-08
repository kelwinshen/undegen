use anchor_lang::prelude::*;

#[constant]
pub const VAULT_CONFIG_SEED: &[u8] = b"vault_config";

#[constant]
pub const RESERVE_SEED: &[u8] = b"reserve";

#[constant]
pub const POSITION_SEED: &[u8] = b"position";

// Mock yield bounds: 5.00% - 10.00%, in basis points (1 bps = 0.01%)
pub const MIN_YIELD_BPS: u64 = 500;
pub const MAX_YIELD_BPS: u64 = 1000;