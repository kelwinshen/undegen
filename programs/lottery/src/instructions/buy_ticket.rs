use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::{ENTRY_SEED, ROUND_SEED};
use crate::error::LotteryError;
use crate::state::{Entry, Round, RoundStatus};

pub fn buy_ticket_handler(ctx: Context<BuyTicket>, amount: u64) -> Result<()> {
    require!(amount > 0, LotteryError::InvalidAmount);
    require!(
        ctx.accounts.round.status == RoundStatus::Open,
        LotteryError::RoundNotOpen
    );

    let cpi_accounts = TransferChecked {
        mint: ctx.accounts.mint.to_account_info(),
        from: ctx.accounts.buyer_token_account.to_account_info(),
        to: ctx.accounts.jackpot_token_account.to_account_info(),
        authority: ctx.accounts.buyer.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;

    let round = &mut ctx.accounts.round;
    let entry = &mut ctx.accounts.entry;

    let start_offset = round.total_pool;
    let end_offset = round
        .total_pool
        .checked_add(amount)
        .ok_or(LotteryError::MathOverflow)?;

    if entry.amount == 0 {
        entry.round = round.key();
        entry.owner = ctx.accounts.buyer.key();
        entry.start_offset = start_offset;
        entry.bump = ctx.bumps.entry;
    }
    entry.amount = entry
        .amount
        .checked_add(amount)
        .ok_or(LotteryError::MathOverflow)?;
    entry.end_offset = end_offset;
    entry.claimed = false;

    round.total_pool = end_offset;

    msg!(
        "Buyer {} ticket range [{}, {})",
        ctx.accounts.buyer.key(),
        start_offset,
        end_offset
    );
    Ok(())
}

#[derive(Accounts)]
pub struct BuyTicket<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

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
    pub buyer_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + Entry::INIT_SPACE,
        seeds = [ENTRY_SEED, round.key().as_ref(), buyer.key().as_ref()],
        bump,
    )]
    pub entry: Account<'info, Entry>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
