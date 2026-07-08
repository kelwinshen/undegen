use crate::constants::{BATCH_SEED, USER_POSITION_SEED};
use crate::error::CoreError;
use crate::state::{Batch, BatchStatus, UserPosition};
use anchor_lang::prelude::*;

pub fn cast_vote_handler(ctx: Context<CastVote>, vote_yes: bool) -> Result<()> {
    let position = &mut ctx.accounts.user_position;
    let batch = &mut ctx.accounts.batch;
    require!(!position.has_voted, CoreError::AlreadyVoted);
    require!(batch.status == BatchStatus::Locked, CoreError::NotLocked);
    let clock = Clock::get()?;
   require!(
    clock.unix_timestamp < batch.kickoff_timestamp.saturating_sub(3600),
    CoreError::VotingClosed
);
    position.has_voted = true;
    position.vote_yes = vote_yes;
    if vote_yes {
        batch.yes_weight = batch
            .yes_weight
            .checked_add(position.deposited_amount)
            .ok_or(CoreError::MathOverflow)?;
    } else {
        batch.no_weight = batch
            .no_weight
            .checked_add(position.deposited_amount)
            .ok_or(CoreError::MathOverflow)?;
    }
    Ok(())
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    pub voter: Signer<'info>,
    #[account(
        mut,
        seeds = [BATCH_SEED, batch.batch_id.to_le_bytes().as_ref()],
        bump = batch.bump,
    )]
    pub batch: Account<'info, Batch>,
    #[account(
        mut,
        seeds = [USER_POSITION_SEED, batch.key().as_ref(), voter.key().as_ref()],
        bump = user_position.bump,
        constraint = user_position.owner == voter.key() @ CoreError::Unauthorized,
    )]
    pub user_position: Account<'info, UserPosition>,
}
