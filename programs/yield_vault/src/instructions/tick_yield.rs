use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::VAULT_CONFIG_SEED;
use crate::error::VaultError;
use crate::state::VaultConfig;

/// DEMO MOCK: flat growth per tick.
/// Each call adds a fixed amount of underlying (pulled from the reserve),
/// regardless of how small the vault principal is. This avoids the
/// percentage-rounding trap where `total_underlying * bps / 10_000` truncates
/// to 0 for small deposits. Tune MOCK_GROWTH_PER_TICK to taste.
///
/// NOTE: value is in BASE UNITS (raw token amount, i.e. already scaled by the
/// mint's decimals). For a 6-decimal token, 1_000_000 == 1.0 token per tick.
const MOCK_GROWTH_PER_TICK: u64 = 1_000_000;

pub fn tick_yield_handler(ctx: Context<TickYield>) -> Result<()> {
    let vault = &mut ctx.accounts.vault_config;
    require!(ctx.accounts.admin.key() == vault.admin, VaultError::Unauthorized);
    require!(vault.total_underlying > 0, VaultError::NothingToGrow);

    let reserve_balance = ctx.accounts.reserve_token_account.amount;

    // Flat mock: add a fixed chunk, but never more than what the reserve holds.
    let mut growth_amount = MOCK_GROWTH_PER_TICK;
    if growth_amount > reserve_balance {
        growth_amount = reserve_balance;
    }

    msg!(
        "DBG mock_flat={} reserve_balance={} total_underlying={} reserve_key={}",
        MOCK_GROWTH_PER_TICK, reserve_balance, vault.total_underlying,
        ctx.accounts.reserve_token_account.key()
    );

    // Only fails if the reserve is genuinely empty now.
    require!(growth_amount > 0, VaultError::ReserveDepleted);

    let mint_key = vault.mint;
    let signer_seeds: &[&[&[u8]]] = &[&[VAULT_CONFIG_SEED, mint_key.as_ref(), &[vault.bump]]];

    let cpi_accounts = TransferChecked {
        mint: ctx.accounts.mint.to_account_info(),
        from: ctx.accounts.reserve_token_account.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: vault.to_account_info(),
    };
    let cpi_ctx =
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer_seeds);
    token_interface::transfer_checked(cpi_ctx, growth_amount, ctx.accounts.mint.decimals)?;

    vault.total_underlying = vault
        .total_underlying
        .checked_add(growth_amount)
        .ok_or(VaultError::MathOverflow)?;

    msg!(
        "Tick (flat mock): +{} underlying (new total: {})",
        growth_amount, vault.total_underlying
    );
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