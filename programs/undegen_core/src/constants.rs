use anchor_lang::prelude::*;

#[constant]
pub const BATCH_SEED: &[u8] = b"batch";

#[constant]
pub const USER_POSITION_SEED: &[u8] = b"user_position";

#[constant]
pub const COLLATERAL_SEED: &[u8] = b"collateral";

#[constant]
pub const PROTOCOL_CONFIG_SEED: &[u8] = b"protocol_config";

pub const PROOF_DEADLINE_SECONDS: i64 = 3600; // 1hr after kickoff
pub const MAX_BETS: u8 = 5;                   // fixed number of bets per batch