use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum BatchStatus {
    Lobby,
    Locked,
    AwaitingCollateral,
    Active,
    Settled,
    Cancelled,
}

// Mirrors TxOdds MarketIntentParams — stored on Batch at propose_match time
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

    // Current bet proposal (reset after each bet)
    pub bet_terms: BetTerms,
    pub kickoff_timestamp: i64,
    pub win_prize: u64,            // = bet_size for current bet
    pub yes_weight: u64,
    pub no_weight: u64,
    pub collateral_required: u64,
    pub collateral_deposited: u64,
    pub proof_deadline: i64,
    pub outcome: Option<bool>,     // result of current bet
}

#[account]
#[derive(InitSpace)]
pub struct UserPosition {
    pub batch: Pubkey,
    pub owner: Pubkey,
    pub deposited_amount: u64,
    pub vault_shares: u64,
    pub has_voted: bool,
    pub vote_yes: bool,
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