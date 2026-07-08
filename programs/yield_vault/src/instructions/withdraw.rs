use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::{POSITION_SEED, VAULT_CONFIG_SEED};
use crate::error::VaultError;
use crate::state::{Position, VaultConfig};

pub fn withdraw_handler(ctx: Context<Withdraw>, shares_amount: u64) -> Result<()> {
    require!(shares_amount > 0, VaultError::InvalidAmount);

    let vault = &mut ctx.accounts.vault_config;
    let position = &mut ctx.accounts.position;

    require!(position.shares >= shares_amount, VaultError::InsufficientShares);
    require!(vault.total_shares > 0, VaultError::InsufficientShares);

    let underlying_amount = (shares_amount as u128)
        .checked_mul(vault.total_underlying as u128)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(vault.total_shares as u128)
        .ok_or(VaultError::MathOverflow)? as u64;
    require!(underlying_amount > 0, VaultError::WithdrawTooSmall);

    position.shares = position.shares.checked_sub(shares_amount).ok_or(VaultError::MathOverflow)?;
    vault.total_shares = vault.total_shares.checked_sub(shares_amount).ok_or(VaultError::MathOverflow)?;
    vault.total_underlying = vault.total_underlying.checked_sub(underlying_amount).ok_or(VaultError::MathOverflow)?;

    let mint_key = vault.mint;
    let signer_seeds: &[&[&[u8]]] = &[&[VAULT_CONFIG_SEED, mint_key.as_ref(), &[vault.bump]]];

    let cpi_accounts = TransferChecked {
        mint: ctx.accounts.mint.to_account_info(),
        from: ctx.accounts.vault_token_account.to_account_info(),
        to: ctx.accounts.depositor_token_account.to_account_info(),
        authority: ctx.accounts.vault_config.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer_seeds);
    token_interface::transfer_checked(cpi_ctx, underlying_amount, ctx.accounts.mint.decimals)?;

    msg!("Withdrew {} shares -> {} underlying", shares_amount, underlying_amount);
    Ok(())
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_CONFIG_SEED, mint.key().as_ref()],
        bump = vault_config.bump,
    )]
    pub vault_config: Account<'info, VaultConfig>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut, address = vault_config.vault_token_account)]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub depositor_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [POSITION_SEED, vault_config.key().as_ref(), depositor.key().as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, Position>,

    pub token_program: Interface<'info, TokenInterface>,
}