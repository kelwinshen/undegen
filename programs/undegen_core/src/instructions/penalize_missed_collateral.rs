use crate::constants::BATCH_SEED;
use crate::error::CoreError;
use crate::state::{Batch, BatchStatus, BetTerms};
use anchor_lang::prelude::*;

/// Callable by anyone after kickoff passes without operator depositing collateral.
/// Simply cancels the bet and resets state — operator earns no commission
/// since they never submitted proof. Commission is only earned via settle_with_proof.
pub fn penalize_missed_collateral_handler(ctx: Context<PenalizeMissedCollateral>) -> Result<()> {
    let batch = &mut ctx.accounts.batch;
    require!(
        batch.status == BatchStatus::AwaitingCollateral,
        CoreError::NotAwaitingCollateral
    );

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp >= batch.kickoff_timestamp,
        CoreError::CollateralDeadlineNotPassed
    );

    // Cancel bet — reset match state, back to Locked so operator can propose again
    batch.status = BatchStatus::Locked;
    
    // --- NEW: Reset the multi-option tracking arrays ---
    batch.bet_terms = [BetTerms::default(); 4];
    batch.vote_weights = [0; 5];
    batch.winning_vote_index = None;
    
    batch.kickoff_timestamp = 0;
    batch.win_prize = 0;
    batch.collateral_required = 0;
    batch.collateral_deposited = 0;
    
    // Penalize the operator by slashing their yield
    batch.operator_yield_bps = batch.operator_yield_bps.saturating_sub(2000);

    msg!("Operator missed collateral deadline — bet cancelled, no commission earned. Yield slashed.");
    Ok(())
}

#[derive(Accounts)]
pub struct PenalizeMissedCollateral<'info> {
    #[account(
        mut,
        seeds = [BATCH_SEED, batch.batch_id.to_le_bytes().as_ref()],
        bump = batch.bump,
    )]
    pub batch: Account<'info, Batch>,
}