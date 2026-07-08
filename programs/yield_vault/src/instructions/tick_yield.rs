use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::{MAX_YIELD_BPS, MIN_YIELD_BPS, VAULT_CONFIG_SEED};
use crate::error::VaultError;
use crate::state::VaultConfig;

/// Admin-only. Pulls real tokens from the pre-funded reserve into the vault
/// to simulate 5-10% APY growth. Uses clock-derived pseudo-randomness -
/// predictable/manipulable, fine for a demo, not for anything with real
/// value at stake long-term.
pub fn tick_yield_handler(ctx: Context<TickYield>) -> Result<()> {
    let vault = &mut ctx.accounts.vault_config;
    require!(ctx.accounts.admin.key() == vault.admin, VaultError::Unauthorized);
    require!(vault.total_underlying > 0, VaultError::NothingToGrow);

    let clock = Clock::get()?;
    let seed = (clock.slot as u128) ^ ((clock.unix_timestamp as u128) << 32);
    let range = (MAX_YIELD_BPS - MIN_YIELD_BPS) + 1;
    let growth_bps = MIN_YIELD_BPS + ((seed % range as u128) as u64);

    let mut growth_amount = (vault.total_underlying as u128)
        .checked_mul(growth_bps as u128)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(VaultError::MathOverflow)? as u64;

    let reserve_balance = ctx.accounts.reserve_token_account.amount;
    if growth_amount > reserve_balance {
        growth_amount = reserve_balance;
    }
    require!(growth_amount > 0, VaultError::ReserveDepleted);

    let mint_key = vault.mint;
    let signer_seeds: &[&[&[u8]]] = &[&[VAULT_CONFIG_SEED, mint_key.as_ref(), &[vault.bump]]];

    let cpi_accounts = TransferChecked {
        mint: ctx.accounts.mint.to_account_info(),
        from: ctx.accounts.reserve_token_account.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: vault.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer_seeds);
    token_interface::transfer_checked(cpi_ctx, growth_amount, ctx.accounts.mint.decimals)?;

    vault.total_underlying = vault.total_underlying.checked_add(growth_amount).ok_or(VaultError::MathOverflow)?;

    msg!("Tick: +{} bps, +{} underlying (new total: {})", growth_bps, growth_amount, vault.total_underlying);
    Ok(())
}

#[derive(Accounts)]
pub struct TickYield<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_CONFIG_SEED, mint.key().as_ref()],
        bump = vault_config.bump,
    )]
    pub vault_config: Account<'info, VaultConfig>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut, address = vault_config.vault_token_account)]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, address = vault_config.reserve_token_account)]
    pub reserve_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}