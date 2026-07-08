use crate::constants::BATCH_SEED;
use crate::error::CoreError;
use crate::state::{Batch, BatchStatus};
use anchor_lang::prelude::*;

pub fn start_batch_handler(ctx: Context<StartBatch>) -> Result<()> {
    let batch = &mut ctx.accounts.batch;
    require!(
        batch.operator == ctx.accounts.operator.key(),
        CoreError::Unauthorized
    );
    require!(batch.status == BatchStatus::Lobby, CoreError::NotInLobby);

    batch.status = BatchStatus::Locked;
    // Snapshot baseline so yield is measured from the moment the batch locks.
    // Subsequent bets measure yield as current_underlying - baseline_underlying,
    // and baseline is updated after each settlement (including any compounded winnings).
    batch.baseline_underlying = batch.total_deposited;

    msg!(
        "Batch {} locked, baseline_underlying={}",
        batch.batch_id,
        batch.baseline_underlying
    );
    Ok(())
}

#[derive(Accounts)]
pub struct StartBatch<'info> {
    pub operator: Signer<'info>,
    #[account(
        mut,
        seeds = [BATCH_SEED, batch.batch_id.to_le_bytes().as_ref()],
        bump = batch.bump,
    )]
    pub batch: Account<'info, Batch>,
}