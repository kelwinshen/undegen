use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum BatchStatus {
    Lobby,
    Locked,
    AwaitingCollateral,
    Active,
    AwaitingProof,
    Settled,
    Cancelled,
}

// Mirrors TxOdds MarketIntentParams — stored on Batch at propose_match time
// so we can reconstruct the exact CPI call at settlement
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, Default)]
pub struct BetTerms {
    pub fixture_id: i64,
    pub period: u16,
    pub stat_a_key: u32,
    pub stat_b_key: Option<u32>,
    pub predicate_threshold: i32,
    pub predicate_comparison: u8, // 0=GreaterThan, 1=LessThan, 2=EqualTo
    pub negation: bool,
}

#[account]
#[derive(InitSpace)]
pub struct Batch {
    pub forfeited_collateral: u64,
    pub baseline_underlying: u64,
    pub odds_numerator: u64,
pub odds_denominator: u64,
    pub operator: Pubkey,
    pub mint: Pubkey,
    pub vault_position: Pubkey,
    pub status: BatchStatus,
    pub total_deposited: u64,
    pub commission_bps: u16,
    pub bet_terms: BetTerms,
    pub kickoff_timestamp: i64,
    pub win_prize: u64,
    pub yes_weight: u64,
    pub no_weight: u64,
    pub collateral_required: u64,
    pub collateral_deposited: u64,
    pub proof_deadline: i64,
    pub outcome: Option<bool>,
    pub batch_id: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserPosition {
    pub batch: Pubkey,
    pub owner: Pubkey,
    pub deposited_amount: u64,
    pub has_voted: bool,
    pub vote_yes: bool,
    pub claimed: bool,
    pub bump: u8,
}
