use crate::constants::{BATCH_SEED, MAX_BETS, PROOF_DEADLINE_SECONDS};
use crate::error::CoreError;
use crate::state::{Batch, BatchStatus, BetTerms};
use anchor_lang::prelude::*;

pub fn propose_match_handler(
    ctx: Context<ProposeMatch>,
    fixture_id: i64,
    kickoff_timestamp: i64,
    period: u16,
    stat_a_key: u32,
    stat_b_key: Option<u32>,
    predicate_threshold: i32,
    predicate_comparison: u8,
    negation: bool,
) -> Result<()> {
    let batch = &mut ctx.accounts.batch;
    require!(batch.operator == ctx.accounts.operator.key(), CoreError::Unauthorized);
    require!(batch.status == BatchStatus::Locked, CoreError::NotLocked);
    require!(kickoff_timestamp > 0, CoreError::InvalidAmount);
    require!(batch.bet_size > 0, CoreError::InvalidAmount);
    require!(batch.bets_completed < MAX_BETS, CoreError::AlreadyFinished);

    batch.bet_terms = BetTerms {
        fixture_id,
        period,
        stat_a_key,
        stat_b_key,
        predicate_threshold,
        predicate_comparison,
        negation,
    };
    batch.kickoff_timestamp = kickoff_timestamp;
    batch.win_prize = batch.bet_size;
    batch.collateral_required = batch.bet_size;
    batch.proof_deadline = kickoff_timestamp
        .checked_add(PROOF_DEADLINE_SECONDS)
        .ok_or(CoreError::MathOverflow)?;

    msg!(
        "Match proposed: fixture_id={} bet_size={} bets_completed={}/{} kickoff={}",
        fixture_id,
        batch.bet_size,
        batch.bets_completed,
        MAX_BETS,
        kickoff_timestamp,
    );
    Ok(())
}

#[derive(Accounts)]
pub struct ProposeMatch<'info> {
    pub operator: Signer<'info>,

    #[account(
        mut,
        seeds = [BATCH_SEED, batch.batch_id.to_le_bytes().as_ref()],
        bump = batch.bump,
    )]
    pub batch: Account<'info, Batch>,
}