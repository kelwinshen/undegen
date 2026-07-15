use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::constants::{BATCH_SEED, PROTOCOL_CONFIG_SEED};
use crate::error::CoreError;
use crate::state::{Batch, BatchStatus, BetTerms, ProtocolConfig};

pub fn initialize_batch_handler(ctx: Context<InitializeBatch>, apy_bps: u16) -> Result<()> {
    require!(apy_bps > 0, CoreError::InvalidAmount);

    let config = &mut ctx.accounts.config;
    require!(config.admin == ctx.accounts.operator.key(), CoreError::Unauthorized);

    let batch_id = config.next_batch_id;
    config.next_batch_id = config.next_batch_id
        .checked_add(1)
        .ok_or(CoreError::MathOverflow)?;

    let batch = &mut ctx.accounts.batch;
    batch.batch_id = batch_id;
    batch.operator = ctx.accounts.operator.key();
    batch.mint = ctx.accounts.mint.key();
    batch.bump = ctx.bumps.batch;
    batch.vault_position = Pubkey::default();
    batch.status = BatchStatus::Lobby;
    batch.total_deposited = 0;

    // Guaranteed yield betting model
    batch.apy_bps = apy_bps;
    batch.bet_size = 0;             // computed at start_batch once deposits are known
    batch.bets_completed = 0;
    batch.accumulated_winnings = 0;

    batch.operator_yield_bps = 10000; 

    // Current bet — all zeroed until propose_match
    // Updated to reflect the new multi-option array state
    batch.bet_terms = [BetTerms::default(); 4];
    batch.kickoff_timestamp = 0;
    batch.win_prize = 0;
    batch.vote_weights = [0; 5];
    batch.winning_vote_index = None;
    batch.collateral_required = 0;
    batch.collateral_deposited = 0;
    batch.proof_deadline = 0;
    batch.outcome = None;
    batch.participant_count = 0;
    batch.created_at = Clock::get()?.unix_timestamp;

    msg!(
        "Batch {} initialized by {} with apy_bps={}",
        batch_id,
        ctx.accounts.operator.key(),
        apy_bps
    );
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeBatch<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, ProtocolConfig>,

    #[account(
        init,
        payer = operator,
        space = 8 + Batch::INIT_SPACE,
        seeds = [BATCH_SEED, config.next_batch_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub batch: Account<'info, Batch>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}