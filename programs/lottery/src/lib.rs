use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("AH9Uibbi3vvUq3PkdTZTz3revx4GoPEN3bJeXh8A57HL");

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

    pub fn draw_winner(ctx: Context<DrawWinner>) -> Result<()> {
        instructions::draw_winner::draw_winner_handler(ctx)
    }

    pub fn claim_prize(ctx: Context<ClaimPrize>) -> Result<()> {
        instructions::claim_prize::claim_prize_handler(ctx)
    }
}
