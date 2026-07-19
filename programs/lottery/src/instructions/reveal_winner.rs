use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::constants::ROUND_SEED;
use crate::error::LotteryError;
use crate::state::{Round, RoundStatus};
use crate::switchboard::read_revealed_value;

/// Permissionless. Must land in the same transaction (and therefore the same
/// slot) as the Switchboard oracle's reveal instruction for `randomness` -
/// `RandomnessAccountData::get_value` only returns a value when the current
/// slot matches the slot the oracle revealed in, which is what makes this
/// value unpredictable and unmanipulable ahead of time.
pub fn reveal_winner_handler(ctx: Context<RevealWinner>) -> Result<()> {
    require!(
        ctx.accounts.round.status == RoundStatus::RandomnessRequested,
        LotteryError::RandomnessNotRequested
    );
    require!(
        ctx.accounts.round.randomness_account == ctx.accounts.randomness.key(),
        LotteryError::RandomnessAccountMismatch
    );

    let clock = Clock::get()?;
    let random_value = read_revealed_value(&ctx.accounts.randomness.to_account_info(), clock.slot)?;

    let round = &mut ctx.accounts.round;
    let random_u64 = u64::from_le_bytes(random_value[0..8].try_into().unwrap());
    round.winning_number = random_u64 % round.total_pool;
    round.status = RoundStatus::Drawn;

    msg!(
        "Round {} drawn via Switchboard randomness: winning_number = {}",
        round.round_id,
        round.winning_number
    );
    Ok(())
}

#[derive(Accounts)]
pub struct RevealWinner<'info> {
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [ROUND_SEED, mint.key().as_ref(), &round.round_id.to_le_bytes()],
        bump = round.bump,
    )]
    pub round: Account<'info, Round>,

    /// CHECK: Switchboard On-Demand randomness account, checked against
    /// `round.randomness_account` and parsed via `read_revealed_value`.
    pub randomness: UncheckedAccount<'info>,
}
