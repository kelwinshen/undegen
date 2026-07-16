use crate::constants::{BATCH_SEED, LOBBY_EXPIRY_SECONDS, MAX_BETS};
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
    require!(batch.total_deposited > 0, CoreError::InvalidAmount);
    // require!(
    //     Clock::get()?.unix_timestamp <= batch.created_at + LOBBY_EXPIRY_SECONDS,
    //     CoreError::LobbyExpired
    // );

    // Compute fixed bet_size = total_deposited × apy_bps / 10000 / 52 / MAX_BETS
    // This is the guaranteed prize pool per bet regardless of vault performance
    let annual_yield = (batch.total_deposited as u128)
        .checked_mul(batch.apy_bps as u128)
        .ok_or(CoreError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(CoreError::MathOverflow)?;

    let weekly_yield = annual_yield
        .checked_div(52)
        .ok_or(CoreError::MathOverflow)?;

    let bet_size = weekly_yield
        .checked_div(MAX_BETS as u128)
        .ok_or(CoreError::MathOverflow)? as u64;

    require!(bet_size > 0, CoreError::InvalidAmount);

    batch.bet_size = bet_size;
    batch.status = BatchStatus::Locked;

    msg!(
        "Batch {} locked — total_deposited={} apy_bps={} bet_size={} max_bets={}",
        batch.batch_id,
        batch.total_deposited,
        batch.apy_bps,
        bet_size,
        MAX_BETS,
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