use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::constants::LOTTERY_CONFIG_SEED;
use crate::state::LotteryConfig;

pub fn initialize_lottery_handler(ctx: Context<InitializeLottery>) -> Result<()> {
    let config = &mut ctx.accounts.lottery_config;
    config.admin = ctx.accounts.admin.key();
    config.mint = ctx.accounts.mint.key();
    config.current_round_id = 0;
    config.bump = ctx.bumps.lottery_config;
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeLottery<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = admin,
        space = 8 + LotteryConfig::INIT_SPACE,
        seeds = [LOTTERY_CONFIG_SEED, mint.key().as_ref()],
        bump,
    )]
    pub lottery_config: Account<'info, LotteryConfig>,

    pub system_program: Program<'info, System>,
}
