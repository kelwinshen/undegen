use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::{POSITION_SEED, VAULT_CONFIG_SEED};
use crate::error::VaultError;
use crate::state::{Position, VaultConfig};

pub fn deposit_handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, VaultError::InvalidAmount);

    let cpi_accounts = TransferChecked {
        mint: ctx.accounts.mint.to_account_info(),
        from: ctx.accounts.depositor_token_account.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: ctx.accounts.depositor.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;

    let vault = &mut ctx.accounts.vault_config;

    let shares_minted = if vault.total_shares == 0 || vault.total_underlying == 0 {
        amount
    } else {
        (amount as u128)
            .checked_mul(vault.total_shares as u128)
            .ok_or(VaultError::MathOverflow)?
            .checked_div(vault.total_underlying as u128)
            .ok_or(VaultError::MathOverflow)? as u64
    };
    require!(shares_minted > 0, VaultError::DepositTooSmall);

    let position = &mut ctx.accounts.position;
    position.owner = ctx.accounts.depositor.key();
    position.vault = vault.key();
    position.shares = position.shares.checked_add(shares_minted).ok_or(VaultError::MathOverflow)?;
    position.bump = ctx.bumps.position;

    vault.total_shares = vault.total_shares.checked_add(shares_minted).ok_or(VaultError::MathOverflow)?;
    vault.total_underlying = vault.total_underlying.checked_add(amount).ok_or(VaultError::MathOverflow)?;

    msg!("Deposited {} -> {} shares minted", amount, shares_minted);
    Ok(())
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    /// The entity whose token account funds are drawn from.
    /// Can be a PDA (e.g. batch PDA from undegen_core) — must sign via CPI signer seeds.
    pub depositor: Signer<'info>,

    /// Separate rent payer for Position account init.
    /// When depositor is a wallet: pass the same pubkey as depositor.
    /// When depositor is a PDA: pass the user's wallet so rent is covered.
    #[account(mut)]
    pub position_payer: Signer<'info>,

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
        init_if_needed,
        payer = position_payer,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, vault_config.key().as_ref(), depositor.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, Position>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}