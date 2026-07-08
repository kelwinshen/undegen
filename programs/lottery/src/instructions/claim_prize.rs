use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::{ENTRY_SEED, ROUND_SEED};
use crate::error::LotteryError;
use crate::state::{Entry, Round, RoundStatus};

pub fn claim_prize_handler(ctx: Context<ClaimPrize>) -> Result<()> {
    let round = &mut ctx.accounts.round;
    let entry = &mut ctx.accounts.entry;

    require!(
        round.status == RoundStatus::Drawn,
        LotteryError::RoundNotDrawn
    );
    require!(!entry.claimed, LotteryError::AlreadyClaimed);
    require!(
        round.winning_number >= entry.start_offset && round.winning_number < entry.end_offset,
        LotteryError::NotWinner
    );

    let jackpot_amount = ctx.accounts.jackpot_token_account.amount;
    require!(jackpot_amount > 0, LotteryError::EmptyPool);

    let mint_key = round.mint;
    let round_id_bytes = round.round_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[
        ROUND_SEED,
        mint_key.as_ref(),
        &round_id_bytes,
        &[round.bump],
    ]];

    let cpi_accounts = TransferChecked {
        mint: ctx.accounts.mint.to_account_info(),
        from: ctx.accounts.jackpot_token_account.to_account_info(),
        to: ctx.accounts.winner_token_account.to_account_info(),
        authority: round.to_account_info(),
    };
    let cpi_ctx =
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer_seeds);

    token_interface::transfer_checked(cpi_ctx, jackpot_amount, ctx.accounts.mint.decimals)?;

    entry.claimed = true;
    round.status = RoundStatus::Settled;

    msg!(
        "Round {} settled: {} paid to {}",
        round.round_id,
        jackpot_amount,
        ctx.accounts.winner.key()
    );
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimPrize<'info> {
    #[account(mut)]
    pub winner: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [ROUND_SEED, mint.key().as_ref(), &round.round_id.to_le_bytes()],
        bump = round.bump,
    )]
    pub round: Account<'info, Round>,

    #[account(mut, address = round.jackpot_token_account)]
    pub jackpot_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub winner_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [ENTRY_SEED, round.key().as_ref(), winner.key().as_ref()],
        bump = entry.bump,
        constraint = entry.owner == winner.key() @ LotteryError::Unauthorized,
    )]
    pub entry: Account<'info, Entry>,

    pub token_program: Interface<'info, TokenInterface>,
}
