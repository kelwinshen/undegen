use crate::constants::BATCH_SEED;
use crate::error::CoreError;
use crate::state::{Batch, BatchStatus, BetTerms};
use anchor_lang::prelude::*;

pub fn finalize_consensus_handler(ctx: Context<FinalizeConsensus>) -> Result<()> {
    let batch = &mut ctx.accounts.batch;
    require!(batch.status == BatchStatus::Locked, CoreError::NotLocked);

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp >= batch.kickoff_timestamp.saturating_sub(3600),
        CoreError::KickoffNotReached
    );

    if batch.yes_weight == 0 && batch.no_weight == 0 {
        batch.bet_terms = BetTerms::default();
        batch.kickoff_timestamp = 0;
        batch.win_prize = 0;
        batch.collateral_required = 0;
        batch.yes_weight = 0;
        batch.no_weight = 0;
        msg!("No votes cast — bet skipped, batch stays Locked");
        return Ok(());
    }

    if batch.yes_weight > batch.no_weight {
        batch.status = BatchStatus::AwaitingCollateral;
        msg!(
            "Consensus YES: yes={} no={} → AwaitingCollateral",
            batch.yes_weight,
            batch.no_weight
        );
    } else {
        batch.bet_terms = BetTerms::default();
        batch.kickoff_timestamp = 0;
        batch.win_prize = 0;
        batch.collateral_required = 0;
        batch.yes_weight = 0;
        batch.no_weight = 0;
        msg!(
            "Consensus NO/TIE: yes={} no={} → bet skipped, back to Locked",
            batch.yes_weight,
            batch.no_weight
        );
    }

    Ok(())
}

#[derive(Accounts)]
pub struct FinalizeConsensus<'info> {
    #[account(
        mut,
        seeds = [BATCH_SEED, batch.batch_id.to_le_bytes().as_ref()],
        bump = batch.bump,
    )]
    pub batch: Account<'info, Batch>,
}