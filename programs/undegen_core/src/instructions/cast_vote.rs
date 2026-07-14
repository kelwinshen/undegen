use crate::constants::{BATCH_SEED, USER_POSITION_SEED};
use crate::error::CoreError;
use crate::state::{Batch, BatchStatus, UserPosition};
use anchor_lang::prelude::*;

pub fn cast_vote_handler(ctx: Context<CastVote>, vote_index: u8) -> Result<()> {
    //cannot vote when its already kick off 
    let position = &mut ctx.accounts.user_position;
    let batch = &mut ctx.accounts.batch;

    require!(batch.status == BatchStatus::Locked, CoreError::NotLocked);

    // 0-3 are bet options, 4 is Skip
    require!(vote_index <= 4, CoreError::InvalidAmount);

    // Ensure we aren't voting on an empty bet term slot (only applies to indices 0-3)
    if vote_index < 4 {
        let selected_term = &batch.bet_terms[vote_index as usize];
        require!(selected_term.fixture_id != 0, CoreError::InvalidAmount);
    }

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp < batch.kickoff_timestamp.saturating_sub(3600),
        CoreError::VotingClosed
    );

    // If user already voted, remove their weight from the old choice first
    if position.has_voted {
        let old_index = position.vote_index as usize;
        batch.vote_weights[old_index] = batch.vote_weights[old_index]
            .saturating_sub(position.deposited_amount);
    }

    // Apply vote (new or switched) to the new choice
    position.has_voted = true;
    position.vote_index = vote_index;

    batch.vote_weights[vote_index as usize] = batch.vote_weights[vote_index as usize]
        .checked_add(position.deposited_amount)
        .ok_or(CoreError::MathOverflow)?;

    msg!(
        "Voter {} voted index={} weight={} (switched={})",
        ctx.accounts.voter.key(),
        vote_index,
        position.deposited_amount,
        position.has_voted,
    );

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