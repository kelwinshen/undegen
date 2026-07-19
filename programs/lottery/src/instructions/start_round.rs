use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::constants::{LOTTERY_CONFIG_SEED, ROUND_SEED};
use crate::error::LotteryError;
use crate::state::{LotteryConfig, Round, RoundStatus};

pub fn start_round_handler(ctx: Context<StartRound>) -> Result<()> {
    let config = &mut ctx.accounts.lottery_config;
    require!(
        ctx.accounts.admin.key() == config.admin,
        LotteryError::Unauthorized
    );

    config.current_round_id = config
        .current_round_id
        .checked_add(1)
        .ok_or(LotteryError::MathOverflow)?;

    let round = &mut ctx.accounts.round;
    round.round_id = config.current_round_id;
    round.mint = config.mint;
    round.jackpot_token_account = ctx.accounts.jackpot_token_account.key();
    round.total_pool = 0;
    round.status = RoundStatus::Open;
    round.winning_number = 0;
    round.start_time = Clock::get()?.unix_timestamp;
    round.randomness_account = Pubkey::default();
    round.bump = ctx.bumps.round;

    msg!("Round {} started", round.round_id);
    Ok(())
}

#[derive(Accounts)]
pub struct StartRound<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [LOTTERY_CONFIG_SEED, mint.key().as_ref()],
        bump = lottery_config.bump,
    )]
    pub lottery_config: Account<'info, LotteryConfig>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = admin,
        space = 8 + Round::INIT_SPACE,
        seeds = [ROUND_SEED, mint.key().as_ref(), &(lottery_config.current_round_id + 1).to_le_bytes()],
        bump,
    )]
    pub round: Account<'info, Round>,

    #[account(
        init,
        payer = admin,
        associated_token::mint = mint,
        associated_token::authority = round,
    )]
    pub jackpot_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
