use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::constants::{BATCH_SEED, INITIAL_COMMISSION_BPS};
use crate::state::{Batch, BatchStatus, BetTerms};

pub fn initialize_batch_handler(ctx: Context<InitializeBatch>, batch_id: u64) -> Result<()> {
    let batch = &mut ctx.accounts.batch;
    batch.operator = ctx.accounts.operator.key();
    batch.mint = ctx.accounts.mint.key();
    batch.vault_position = Pubkey::default(); // set in join_batch when first deposit lands
    batch.status = BatchStatus::Lobby;
    batch.total_deposited = 0;
    batch.commission_bps = INITIAL_COMMISSION_BPS;
    batch.bet_terms = BetTerms::default();
    batch.kickoff_timestamp = 0;
    batch.win_prize = 0;
    batch.yes_weight = 0;
    batch.no_weight = 0;
    batch.collateral_required = 0;
    batch.collateral_deposited = 0;
    batch.proof_deadline = 0;
    batch.outcome = None;
    batch.batch_id = batch_id;
    batch.bump = ctx.bumps.batch;
    batch.forfeited_collateral = 0;
    msg!(
        "Batch {} initialized by {}",
        batch_id,
        ctx.accounts.operator.key()
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(batch_id: u64)]
pub struct InitializeBatch<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = operator,
        space = 8 + Batch::INIT_SPACE,
        seeds = [BATCH_SEED, batch_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub batch: Account<'info, Batch>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
