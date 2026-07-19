use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use yield_vault::cpi::accounts::Withdraw;
use yield_vault::program::YieldVault;

use crate::constants::{BATCH_SEED, USER_POSITION_SEED};
use crate::error::CoreError;
use crate::state::{Batch, BatchStatus, UserPosition};

pub fn leave_batch_handler(ctx: Context<LeaveBatch>, amount: u64) -> Result<()> {
    require!(
        ctx.accounts.batch.status == BatchStatus::Lobby,
        CoreError::NotInLobby
    );

    let position_deposited = ctx.accounts.user_position.deposited_amount;
    let position_vault_shares = ctx.accounts.user_position.vault_shares;
    require!(position_deposited > 0, CoreError::InvalidAmount);
    require!(
        amount > 0 && amount <= position_deposited,
        CoreError::InvalidAmount
    );

    let is_full_exit = amount == position_deposited;

    // Redeem this depositor's own tracked share of the batch's pooled vault
    // position (set in join_batch) — not a fresh amount->shares conversion
    // off the vault's current exchange rate. On a full exit this correctly
    // hands back their exact remaining shares (including any pro-rata yield
    // accrued since they joined); on a partial leave, it redeems the same
    // fraction of their shares as the USDC fraction they're withdrawing.
    let shares_to_withdraw: u64 = if is_full_exit {
        position_vault_shares
    } else {
        ((position_vault_shares as u128)
            .checked_mul(amount as u128)
            .ok_or(CoreError::MathOverflow)?
            .checked_div(position_deposited as u128)
            .ok_or(CoreError::MathOverflow)?) as u64
    };
    require!(shares_to_withdraw > 0, CoreError::InvalidAmount);

    let batch = &mut ctx.accounts.batch;
    let batch_id_bytes = batch.batch_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[BATCH_SEED, batch_id_bytes.as_ref(), &[batch.bump]]];

    let cpi_accounts = Withdraw {
        depositor: batch.to_account_info(),
        vault_config: ctx.accounts.vault_config.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        vault_token_account: ctx.accounts.vault_token_account.to_account_info(),
        depositor_token_account: ctx.accounts.batch_token_account.to_account_info(),
        position: ctx.accounts.vault_position.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.yield_vault_program.key(),
        cpi_accounts,
        signer_seeds,
    );
    yield_vault::cpi::withdraw(cpi_ctx, shares_to_withdraw)?;

    // Transfer from batch_token_account back to user. After the yield_vault
    // CPI above, only this withdrawal's proceeds land in batch_token_account
    // (it's emptied into the vault on every join and refilled fresh on every
    // leave, so it never holds other users' funds at rest between calls) —
    // safe to forward its whole post-CPI balance for this partial or full
    // withdrawal.
    ctx.accounts.batch_token_account.reload()?;
    let withdrawn = ctx.accounts.batch_token_account.amount;
    if withdrawn > 0 {
        let transfer_accounts = anchor_spl::token_interface::TransferChecked {
            mint: ctx.accounts.mint.to_account_info(),
            from: ctx.accounts.batch_token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: batch.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            transfer_accounts,
            signer_seeds,
        );
        anchor_spl::token_interface::transfer_checked(
            cpi_ctx,
            withdrawn,
            ctx.accounts.mint.decimals,
        )?;
    }

    batch.total_deposited = batch.total_deposited.saturating_sub(amount);

    let position = &mut ctx.accounts.user_position;
    position.deposited_amount = position_deposited.saturating_sub(amount);
    position.vault_shares = position_vault_shares.saturating_sub(shares_to_withdraw);

    // Only decrement once this depositor has fully exited — mirrors
    // join_batch's "only increment when deposited_amount was 0 before this
    // call", so repeated partial leaves down to zero count as one exit.
    if position.deposited_amount == 0 {
        batch.participant_count = batch.participant_count.saturating_sub(1);
    }

    msg!(
        "User {} left batch {} with {} ({} shares){}",
        ctx.accounts.user.key(),
        batch.batch_id,
        amount,
        shares_to_withdraw,
        if is_full_exit { " — full exit" } else { " — partial" }
    );
    Ok(())
}

#[derive(Accounts)]
pub struct LeaveBatch<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [BATCH_SEED, batch.batch_id.to_le_bytes().as_ref()],
        bump = batch.bump,
    )]
    pub batch: Account<'info, Batch>,

    #[account(mut)]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = batch,
    )]
    pub batch_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: yield_vault accounts passed through for CPI
    #[account(mut)]
    pub vault_config: UncheckedAccount<'info>,

    /// CHECK: yield_vault token account
    #[account(mut)]
    pub vault_token_account: UncheckedAccount<'info>,

    /// CHECK: yield_vault Position PDA for this batch
    #[account(mut)]
    pub vault_position: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [USER_POSITION_SEED, batch.key().as_ref(), user.key().as_ref()],
        bump = user_position.bump,
        constraint = user_position.owner == user.key() @ CoreError::Unauthorized,
    )]
    pub user_position: Account<'info, UserPosition>,

    pub yield_vault_program: Program<'info, YieldVault>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
}
