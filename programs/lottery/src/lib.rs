use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod switchboard;

use instructions::*;

declare_id!("BkMhRmJCsnZ2bW9RkjK3mPQTEbtY6gpnX8H7AJQRrmbh");

#[program]
pub mod lottery {
    use super::*;

    pub fn initialize_lottery(ctx: Context<InitializeLottery>) -> Result<()> {
        instructions::initialize_lottery::initialize_lottery_handler(ctx)
    }

    pub fn start_round(ctx: Context<StartRound>) -> Result<()> {
        instructions::start_round::start_round_handler(ctx)
    }

    pub fn buy_ticket(ctx: Context<BuyTicket>, amount: u64) -> Result<()> {
        instructions::buy_ticket::buy_ticket_handler(ctx, amount)
    }

    pub fn request_randomness(ctx: Context<RequestRandomness>) -> Result<()> {
        instructions::request_randomness::request_randomness_handler(ctx)
    }

    pub fn reveal_winner(ctx: Context<RevealWinner>) -> Result<()> {
        instructions::reveal_winner::reveal_winner_handler(ctx)
    }

    pub fn claim_prize(ctx: Context<ClaimPrize>) -> Result<()> {
        instructions::claim_prize::claim_prize_handler(ctx)
    }
}
