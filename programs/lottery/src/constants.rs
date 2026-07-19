use anchor_lang::prelude::*;

#[constant]
pub const LOTTERY_CONFIG_SEED: &[u8] = b"lottery_config";

#[constant]
pub const ROUND_SEED: &[u8] = b"round";

#[constant]
pub const ENTRY_SEED: &[u8] = b"entry";

/// Minimum time a round must stay open before the admin can request the draw.
#[constant]
pub const ROUND_DURATION_SECONDS: i64 = 7 * 24 * 60 * 60;
