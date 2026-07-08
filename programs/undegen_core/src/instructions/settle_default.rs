use crate::constants::{BATCH_SEED, COLLATERAL_SEED};
use crate::error::CoreError;
use crate::state::{Batch, BatchStatus};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Callable by anyone after proof_deadline passes with no proof submitted.
/// Defaults to user wins: records forfeited collateral amount for proportional
/// distribution at claim time. Operator earns zero commission.
pub fn settle_default_handler(ctx: Context<SettleDefault>) -> Result<()> {
    let batch = &mut ctx.accounts.batch;
    require!(batch.status == BatchStatus::Active, CoreError::NotActive);

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp >= batch.proof_deadline,
        CoreError::ProofDeadlineNotPassed
    );

    batch.outcome = Some(true);
    batch.status = BatchStatus::Settled;

    // Store collateral amount for proportional distribution at claim time.
    // Leave tokens in collateral_token_account — each user withdraws their
    // share when they call claim, avoiding the first-claimer-takes-all problem.
    batch.forfeited_collateral = ctx.accounts.collateral_token_account.amount;

    msg!(
        "Batch {} defaulted — forfeited_collateral={} distributed at claim time",
        batch.batch_id,
        batch.forfeited_collateral,
    );
    Ok(())
}

#[derive(Accounts)]
pub struct SettleDefault<'info> {
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [BATCH_SEED, batch.batch_id.to_le_bytes().as_ref()],
        bump = batch.bump,
    )]
    pub batch: Account<'info, Batch>,

    #[account(
        mut,
        seeds = [COLLATERAL_SEED, batch.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = batch,
    )]
    pub collateral_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}
