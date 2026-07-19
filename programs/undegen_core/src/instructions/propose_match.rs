use crate::constants::{BATCH_SEED, MAX_BETS, PROOF_DEADLINE_SECONDS};
use crate::error::CoreError;
use crate::state::{Batch, BatchStatus, BetTerms};
use anchor_lang::prelude::*;

pub fn propose_match_handler(
    ctx: Context<ProposeMatch>,
    bet_terms_array: [BetTerms; 4], // Accepts the 4 specific bets as an array natively formatted for TxOdds
    kickoff_timestamp: i64,
) -> Result<()> {
    let batch = &mut ctx.accounts.batch;
    require!(batch.operator == ctx.accounts.operator.key(), CoreError::Unauthorized);
    require!(batch.status == BatchStatus::Locked, CoreError::NotLocked);
    require!(kickoff_timestamp > 0, CoreError::InvalidAmount);
    require!(batch.bet_size > 0, CoreError::InvalidAmount);
    require!(batch.bets_completed < MAX_BETS, CoreError::AlreadyFinished);

    // NEW: Ensure at least one valid bet is proposed (fixture_id != 0)
    let has_valid_bet = bet_terms_array.iter().any(|term| term.fixture_id != 0);
    require!(has_valid_bet, CoreError::InvalidAmount); // Or create a specific CoreError::EmptyProposal

    // 1. Assign the 4 proposed bets to the state
    batch.bet_terms = bet_terms_array;
    batch.kickoff_timestamp = kickoff_timestamp;
    batch.win_prize = batch.bet_size;

    // 2. Explicitly reset consensus and collateral tracking for this new match
    batch.vote_weights = [0; 5];
    batch.winning_vote_index = None;
    batch.collateral_required = 0; // Will be determined dynamically in deposit_collateral
    batch.collateral_deposited = 0;
    batch.outcome = None;

    batch.proof_deadline = kickoff_timestamp
        .checked_add(PROOF_DEADLINE_SECONDS)
        .ok_or(CoreError::MathOverflow)?;

    msg!(
        "Match proposed with up to 4 options: bet_size={} bets_completed={}/{} kickoff={}",
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