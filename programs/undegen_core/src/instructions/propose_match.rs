use crate::constants::{BATCH_SEED, PROOF_DEADLINE_SECONDS};
use crate::error::CoreError;
use crate::state::{Batch, BatchStatus, BetTerms};
use anchor_lang::prelude::*;

pub fn propose_match_handler(
    ctx: Context<ProposeMatch>,
    fixture_id: i64,
    kickoff_timestamp: i64,
    odds_numerator: u64,
    odds_denominator: u64,
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
    require!(odds_numerator > 0 && odds_denominator > 0, CoreError::InvalidAmount);
    require!(batch.total_deposited > 0, CoreError::InvalidAmount);

    // Read vault state to compute current underlying for this batch's position
    let vault_config_data = ctx.accounts.vault_config.try_borrow_data()?;
    let mut vault_slice: &[u8] = &vault_config_data;
    let vault_state = yield_vault::state::VaultConfig::try_deserialize(&mut vault_slice)?;
    drop(vault_config_data);

    let vault_position_data = ctx.accounts.vault_position.try_borrow_data()?;
    let mut pos_slice: &[u8] = &vault_position_data;
    let position_state = yield_vault::state::Position::try_deserialize(&mut pos_slice)?;
    drop(vault_position_data);

    // current_underlying = position.shares × vault.total_underlying / vault.total_shares
    require!(vault_state.total_shares > 0, CoreError::InvalidAmount);
    let current_underlying = (position_state.shares as u128)
        .checked_mul(vault_state.total_underlying as u128)
        .ok_or(CoreError::MathOverflow)?
        .checked_div(vault_state.total_shares as u128)
        .ok_or(CoreError::MathOverflow)? as u64;

    // yield = current_underlying - baseline (not total_deposited)
    // baseline is updated after each settlement so subsequent bets
    // only bet the new yield generated since the last settlement
    let yield_generated = current_underlying.saturating_sub(batch.baseline_underlying);
    require!(yield_generated > 0, CoreError::NothingToGrow);

    // win_prize = yield × odds
    let win_prize = (yield_generated as u128)
        .checked_mul(odds_numerator as u128)
        .ok_or(CoreError::MathOverflow)?
        .checked_div(odds_denominator as u128)
        .ok_or(CoreError::MathOverflow)? as u64;
    require!(win_prize > 0, CoreError::InvalidAmount);

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
    batch.win_prize = win_prize;
    batch.collateral_required = win_prize;
    batch.odds_numerator = odds_numerator;
    batch.odds_denominator = odds_denominator;
    batch.proof_deadline = kickoff_timestamp
        .checked_add(PROOF_DEADLINE_SECONDS)
        .ok_or(CoreError::MathOverflow)?;

    msg!(
        "Match proposed: fixture_id={} yield={} odds={}/{} win_prize={} kickoff={}",
        fixture_id, yield_generated, odds_numerator, odds_denominator, win_prize, kickoff_timestamp
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

    /// CHECK: yield_vault VaultConfig — read-only to compute current underlying
    pub vault_config: UncheckedAccount<'info>,

    /// CHECK: yield_vault Position PDA for this batch — read-only for shares
    pub vault_position: UncheckedAccount<'info>,
}