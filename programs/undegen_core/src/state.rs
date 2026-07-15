use anchor_lang::prelude::*;
use crate::txodds_types::{BinaryExpression, TraderPredicate}; // Imports strict IDL types

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug, Default)]
pub enum BatchStatus {
    #[default]
    Lobby,
    Locked,
    AwaitingCollateral,
    Active,
    Settled,
    Cancelled,
}

// Mirrors TxOdds MarketIntentParams — stored on Batch at propose_match time
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, Default, Debug)]
//pakai timestamp pas propose match dipresent sama MessageId
pub struct BetTerms {
    pub fixture_id: i64,
    pub period: u16,
    pub stat_a_key: u32,
    pub stat_b_key: Option<u32>,
    pub op: Option<BinaryExpression>,   // Uses exact IDL Enum (Add/Subtract)
    pub predicate: TraderPredicate,     // Uses exact IDL Struct (threshold & comparison)
    pub negation: bool,                 // Currently tracked, but TxOdds validates without negation natively
}

#[account]
#[derive(InitSpace)]
pub struct Batch {
    // Identity
    pub batch_id: u64,
    pub operator: Pubkey,
    pub mint: Pubkey,
    pub bump: u8,

    // Vault connection
    pub vault_position: Pubkey,

    // Lifecycle
    pub status: BatchStatus,
    pub total_deposited: u64,

    // Guaranteed yield betting model
    pub apy_bps: u16,              // operator-set APY in basis points (e.g. 500 = 5%)
    pub bet_size: u64,             // fixed prize per bet, computed at start_batch
    pub bets_completed: u8,        // how many bets have been settled
    pub accumulated_winnings: u64, // total winnings users have earned across all bets

    pub operator_yield_bps: u16,

    // Current bet proposals (reset after each bet)
    // Holds exactly 4 bet options natively formatted for TxOdds validation
    pub bet_terms: [BetTerms; 4],
    pub kickoff_timestamp: i64,
    pub win_prize: u64,            // = bet_size for current bet

    // Consensus tracking: [Bet 0, Bet 1, Bet 2, Bet 3, Skip (Index 4)]
    pub vote_weights: [u64; 5],
    pub winning_vote_index: Option<u8>,

    pub collateral_required: u64,
    pub collateral_deposited: u64,
    pub proof_deadline: i64,
    pub outcome: Option<bool>,     // result of current bet

    // Appended field — only batches initialized after this field was added
    // will have it; batches from before this change are not migrated, and
    // will fail to deserialize under this program build. Keep this last.
    pub participant_count: u32,    // unique depositors currently in this batch

    // Appended field, same caveat as participant_count above — only batches
    // initialized after this was added will have it. Unix timestamp set once
    // at initialize_batch; start_batch/join_batch reject once
    // now > created_at + LOBBY_EXPIRY_SECONDS (see constants.rs).
    pub created_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct UserPosition {
    pub batch: Pubkey,
    pub owner: Pubkey,
    pub deposited_amount: u64,
    pub vault_shares: u64,
    pub has_voted: bool,
    // Expects a value 0 through 4 (0-3 for bets, 4 for skip)
    pub vote_index: u8,
    pub claimed: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ProtocolConfig {
    pub admin: Pubkey,
    pub next_batch_id: u64,
    pub bump: u8,
}