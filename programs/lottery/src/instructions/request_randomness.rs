use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::constants::{LOTTERY_CONFIG_SEED, ROUND_DURATION_SECONDS, ROUND_SEED};
use crate::error::LotteryError;
use crate::state::{LotteryConfig, Round, RoundStatus};
use crate::switchboard::{commit_randomness, switchboard_on_demand_program_id};

/// Admin-only, and only once the round has been open for at least
/// `ROUND_DURATION_SECONDS`. Commits a Switchboard On-Demand randomness account
/// to a future slot; the actual random value is filled in off-chain by the
/// Switchboard oracle and consumed in `reveal_winner`.
pub fn request_randomness_handler(ctx: Context<RequestRandomness>) -> Result<()> {
    require!(
        ctx.accounts.admin.key() == ctx.accounts.lottery_config.admin,
        LotteryError::Unauthorized
    );

    let clock = Clock::get()?;
    let round = &mut ctx.accounts.round;
    require!(
        round.status == RoundStatus::Open,
        LotteryError::RoundNotOpen
    );
    require!(round.total_pool > 0, LotteryError::EmptyPool);

    let deadline = round
        .start_time
        .checked_add(ROUND_DURATION_SECONDS)
        .ok_or(LotteryError::MathOverflow)?;
    require!(
        clock.unix_timestamp >= deadline,
        LotteryError::RoundNotExpired
    );

    commit_randomness(
        &ctx.accounts.switchboard_program.to_account_info(),
        &ctx.accounts.randomness.to_account_info(),
        &ctx.accounts.queue.to_account_info(),
        &ctx.accounts.oracle.to_account_info(),
        &ctx.accounts.admin.to_account_info(),
        &ctx.accounts.recent_slothashes.to_account_info(),
    )?;

    round.randomness_account = ctx.accounts.randomness.key();
    round.status = RoundStatus::RandomnessRequested;

    msg!(
        "Round {} randomness requested via Switchboard: {}",
        round.round_id,
        round.randomness_account
    );
    Ok(())
}

#[derive(Accounts)]
pub struct RequestRandomness<'info> {
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

    /// CHECK: Switchboard On-Demand randomness account, created off-chain by the
    /// admin via the Switchboard SDK ahead of time. Ownership and authority are
    /// enforced by the `randomness_commit` CPI itself.
    #[account(mut)]
    pub randomness: UncheckedAccount<'info>,

    /// CHECK: Switchboard On-Demand queue the randomness account is tied to.
    pub queue: UncheckedAccount<'info>,

    /// CHECK: Oracle assigned to serve this randomness commitment.
    #[account(mut)]
    pub oracle: UncheckedAccount<'info>,

    /// CHECK: SlotHashes sysvar required by Switchboard's commit instruction.
    #[account(address = solana_sdk_ids::sysvar::slot_hashes::ID)]
    pub recent_slothashes: UncheckedAccount<'info>,

    /// CHECK: Switchboard On-Demand program.
    #[account(address = switchboard_on_demand_program_id())]
    pub switchboard_program: UncheckedAccount<'info>,
}
