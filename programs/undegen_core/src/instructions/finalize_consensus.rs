use crate::constants::BATCH_SEED;
use crate::error::CoreError;
use crate::state::{Batch, BatchStatus};
use anchor_lang::prelude::*;

pub fn finalize_consensus_handler(ctx: Context<FinalizeConsensus>) -> Result<()> {
    let batch = &mut ctx.accounts.batch;
    require!(batch.status == BatchStatus::Locked, CoreError::NotLocked);

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp >= batch.kickoff_timestamp.saturating_sub(3600),
        CoreError::KickoffNotReached
    );

    // 1. Iterate through vote weights to find the highest consensus
    let mut max_weight = 0;
    let mut winning_index = 4; // Default to Skip (Index 4)
    let mut is_tie = false;

    for (i, &weight) in batch.vote_weights.iter().enumerate() {
        if weight > max_weight {
            max_weight = weight;
            winning_index = i as u8;
            is_tie = false; // Clear tie status if a new strict max is found
        } else if weight == max_weight && weight > 0 {
            is_tie = true; // Mark as tie if another option has the same max weight
        }
    }

    // 2. Handle Tie-breakers and Zero-vote scenarios
    if max_weight == 0 || is_tie {
        winning_index = 4; // Force "Skip" if nobody voted or there is a tie
        msg!("No clear consensus (tie or no votes). Defaulting to Skip (Option 4).");
    } else {
        msg!(
            "Consensus reached for option {} with weight {}",
            winning_index,
            max_weight
        );
    }

    // 3. Update state and transition to AwaitingCollateral
    batch.winning_vote_index = Some(winning_index);
    batch.status = BatchStatus::AwaitingCollateral;

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