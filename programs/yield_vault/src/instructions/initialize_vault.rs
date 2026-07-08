use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::constants::{RESERVE_SEED, VAULT_CONFIG_SEED};
use crate::state::VaultConfig;

pub fn initialize_vault_handler(ctx: Context<InitializeVault>) -> Result<()> {
    let vault = &mut ctx.accounts.vault_config;
    vault.admin = ctx.accounts.admin.key();
    vault.mint = ctx.accounts.mint.key();
    vault.vault_token_account = ctx.accounts.vault_token_account.key();
    vault.reserve_token_account = ctx.accounts.reserve_token_account.key();
    vault.total_shares = 0;
    vault.total_underlying = 0;
    vault.bump = ctx.bumps.vault_config;
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = admin,
        space = 8 + VaultConfig::INIT_SPACE,
        seeds = [VAULT_CONFIG_SEED, mint.key().as_ref()],
        bump,
    )]
    pub vault_config: Account<'info, VaultConfig>,

    #[account(
        init,
        payer = admin,
        associated_token::mint = mint,
        associated_token::authority = vault_config,
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = admin,
        seeds = [RESERVE_SEED, mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vault_config,
    )]
    pub reserve_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}