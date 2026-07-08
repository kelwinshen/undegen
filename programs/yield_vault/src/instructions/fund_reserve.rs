use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::VAULT_CONFIG_SEED;
use crate::error::VaultError;
use crate::state::VaultConfig;

pub fn fund_reserve_handler(ctx: Context<FundReserve>, amount: u64) -> Result<()> {
    require!(amount > 0, VaultError::InvalidAmount);

    let cpi_accounts = TransferChecked {
        mint: ctx.accounts.mint.to_account_info(),
        from: ctx.accounts.admin_token_account.to_account_info(),
        to: ctx.accounts.reserve_token_account.to_account_info(),
        authority: ctx.accounts.admin.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;

    msg!("Reserve funded with {} base units", amount);
    Ok(())
}

#[derive(Accounts)]
pub struct FundReserve<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [VAULT_CONFIG_SEED, mint.key().as_ref()],
        bump = vault_config.bump,
        has_one = admin,
    )]
    pub vault_config: Account<'info, VaultConfig>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut, address = vault_config.reserve_token_account)]
    pub reserve_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub admin_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}