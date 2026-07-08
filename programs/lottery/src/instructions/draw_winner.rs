use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::constants::{LOTTERY_CONFIG_SEED, ROUND_SEED};
use crate::error::LotteryError;
use crate::state::{LotteryConfig, Round, RoundStatus};

/// Admin-only. Picks a random point in [0, total_pool) as the winning number.
/// Uses clock-derived pseudo-randomness - predictable/manipulable, fine for a
/// demo, but this is load-bearing (decides real payouts). Swap for a
/// verifiable RNG (e.g. Switchboard VRF) before this handles real value.
pub fn draw_winner_handler(ctx: Context<DrawWinner>) -> Result<()> {
    let round = &mut ctx.accounts.round;
    require!(
        ctx.accounts.admin.key() == ctx.accounts.lottery_config.admin,
        LotteryError::Unauthorized
    );
    require!(
        round.status == RoundStatus::Open,
        LotteryError::RoundNotOpen
    );
    require!(round.total_pool > 0, LotteryError::EmptyPool);

    let clock = Clock::get()?;
    let seed = (clock.slot as u128) ^ ((clock.unix_timestamp as u128) << 32);
    round.winning_number = (seed % round.total_pool as u128) as u64;
    round.status = RoundStatus::Drawn;

    msg!(
        "Round {} drawn: winning_number = {}",
        round.round_id,
        round.winning_number
    );
    Ok(())
}

#[derive(Accounts)]
pub struct DrawWinner<'info> {
    pub admin: Signer<'info>,

    #[account(
        seeds = [LOTTERY_CONFIG_SEED, mint.key().as_ref()],
        bump = lottery_config.bump,
    )]
    pub lottery_config: Account<'info, LotteryConfig>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [ROUND_SEED, mint.key().as_ref(), &round.round_id.to_le_bytes()],
        bump = round.bump,
    )]
    pub round: Account<'info, Round>,
}
