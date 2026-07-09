use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use yield_vault::program::YieldVault;

use crate::constants::BATCH_SEED;
use crate::error::CoreError;
use crate::state::{Batch, BatchStatus};

pub fn claim_operator_yield_handler(ctx: Context<ClaimOperatorYield>) -> Result<()> {
    let batch = &ctx.accounts.batch;

    require!(batch.status == BatchStatus::Settled, CoreError::AlreadyFinished);
    require!(
        batch.operator == ctx.accounts.operator.key(),
        CoreError::Unauthorized
    );

    let batch_id_bytes = batch.batch_id.to_le_bytes();
    let batch_bump = batch.bump;
    let operator_yield_bps = batch.operator_yield_bps;
    let total_deposited = batch.total_deposited;

    let signer_seeds: &[&[&[u8]]] = &[&[
        BATCH_SEED,
        batch_id_bytes.as_ref(),
        &[batch_bump],
    ]];

    // Read vault state to compute remaining yield after users claimed principal
    let vault_config_data = ctx.accounts.vault_config.try_borrow_data()?;
    let mut vault_slice: &[u8] = &vault_config_data;
    let vault_state = yield_vault::state::VaultConfig::try_deserialize(&mut vault_slice)?;
    drop(vault_config_data);

    let vault_position_data = ctx.accounts.vault_position.try_borrow_data()?;
    let mut pos_slice: &[u8] = &vault_position_data;
    let position_state = yield_vault::state::Position::try_deserialize(&mut pos_slice)?;
    drop(vault_position_data);

    require!(vault_state.total_shares > 0, CoreError::InvalidAmount);
    require!(position_state.shares > 0, CoreError::InvalidAmount);

    // Current underlying value of remaining vault position
    let current_underlying = (position_state.shares as u128)
        .checked_mul(vault_state.total_underlying as u128)
        .ok_or(CoreError::MathOverflow)?
        .checked_div(vault_state.total_shares as u128)
        .ok_or(CoreError::MathOverflow)? as u64;

    // Yield = everything above total_deposited remaining in vault
    // (users already withdrew their principal, so remainder is yield + won collateral)
    let yield_amount = current_underlying.saturating_sub(total_deposited);

    require!(yield_amount > 0, CoreError::InvalidAmount);

    // Operator's entitlement = yield × operator_yield_bps / 10000
    // Forfeited portion (10000 - operator_yield_bps) stays in vault for users
    // who haven't claimed yet (their principal + forfeited yield share)
    let operator_yield = (yield_amount as u128)
        .checked_mul(operator_yield_bps as u128)
        .ok_or(CoreError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(CoreError::MathOverflow)? as u64;

    require!(operator_yield > 0, CoreError::InvalidAmount);

    // Convert operator yield to shares
    let shares_to_withdraw = (operator_yield as u128)
        .checked_mul(vault_state.total_shares as u128)
        .ok_or(CoreError::MathOverflow)?
        .checked_div(vault_state.total_underlying as u128)
        .ok_or(CoreError::MathOverflow)? as u64;

    require!(shares_to_withdraw > 0, CoreError::InvalidAmount);
    require!(
        shares_to_withdraw <= position_state.shares,
        CoreError::InvalidAmount
    );

    // Withdraw operator's yield share from vault into batch_token_account
    yield_vault::cpi::withdraw(
        CpiContext::new_with_signer(
            ctx.accounts.yield_vault_program.key(),
            yield_vault::cpi::accounts::Withdraw {
                depositor: ctx.accounts.batch.to_account_info(),
                vault_config: ctx.accounts.vault_config.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                vault_token_account: ctx.accounts.vault_token_account.to_account_info(),
                depositor_token_account: ctx.accounts.batch_token_account.to_account_info(),
                position: ctx.accounts.vault_position.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
            signer_seeds,
        ),
        shares_to_withdraw,
    )?;

    // Forward to operator wallet
    ctx.accounts.batch_token_account.reload()?;
    let payout = ctx.accounts.batch_token_account.amount;
    if payout > 0 {
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.batch_token_account.to_account_info(),
                    to: ctx.accounts.operator_token_account.to_account_info(),
                    authority: ctx.accounts.batch.to_account_info(),
                },
                signer_seeds,
            ),
            payout,
            ctx.accounts.mint.decimals,
        )?;
    }

    msg!(
        "Operator {} claimed yield from batch {} — yield={} operator_yield_bps={} payout={}",
        ctx.accounts.operator.key(),
        batch.batch_id,
        yield_amount,
        operator_yield_bps,
        payout,
    );
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimOperatorYield<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [BATCH_SEED, batch.batch_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub batch: Account<'info, Batch>,

    #[account(mut)]
    pub operator_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Batch's ATA — intermediate account for vault withdrawal
    #[account(
        init_if_needed,
        payer = operator,
        associated_token::mint = mint,
        associated_token::authority = batch,
    )]
    pub batch_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: yield_vault VaultConfig
    #[account(mut)]
    pub vault_config: UncheckedAccount<'info>,

    /// CHECK: yield_vault main token account
    #[account(mut)]
    pub vault_token_account: UncheckedAccount<'info>,

    /// CHECK: yield_vault Position PDA for this batch
    #[account(mut)]
    pub vault_position: UncheckedAccount<'info>,

    pub yield_vault_program: Program<'info, YieldVault>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}