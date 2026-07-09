use anchor_lang::prelude::*;
use crate::constants::PROTOCOL_CONFIG_SEED;
use crate::state::ProtocolConfig;

pub fn initialize_protocol_handler(ctx: Context<InitializeProtocol>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.next_batch_id = 1;
    config.bump = ctx.bumps.config;
    msg!("Protocol initialized by {}", ctx.accounts.admin.key());
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + ProtocolConfig::INIT_SPACE,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, ProtocolConfig>,

    pub system_program: Program<'info, System>,
}