use anchor_lang::prelude::*;

#[constant]
pub const BATCH_SEED: &[u8] = b"batch";

#[constant]
pub const USER_POSITION_SEED: &[u8] = b"user_position";

#[constant]
pub const COLLATERAL_SEED: &[u8] = b"collateral";


pub const INITIAL_COMMISSION_BPS: u16 = 1000;



// Consensus: yes must strictly exceed no (tie = no bet)
// 0 votes = skip
pub const PROOF_DEADLINE_SECONDS: i64 = 3600; // 1hr after kickoff
