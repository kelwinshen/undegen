use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct LotteryConfig {
    pub admin: Pubkey,
    pub mint: Pubkey,
    pub current_round_id: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Round {
    pub round_id: u64,
    pub mint: Pubkey,
    pub jackpot_token_account: Pubkey,
    pub total_pool: u64,
    pub status: RoundStatus,
    pub winning_number: u64,
    pub start_time: i64,
    pub randomness_account: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Entry {
    pub round: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub start_offset: u64,
    pub end_offset: u64,
    pub claimed: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum RoundStatus {
    Open,
    RandomnessRequested,
    Drawn,
    Settled,
}
