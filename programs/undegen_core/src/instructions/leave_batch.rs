use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use yield_vault::cpi::accounts::Withdraw;
use yield_vault::program::YieldVault;

use crate::constants::{BATCH_SEED, USER_POSITION_SEED};
use crate::error::CoreError;
use crate::state::{Batch, BatchStatus, UserPosition};

pub fn leave_batch_handler(ctx: Context<LeaveBatch>) -> Result<()> {
    require!(
        ctx.accounts.batch.status == BatchStatus::Lobby,
        CoreError::NotInLobby
    );

    let position = &ctx.accounts.user_position;
    require!(position.deposited_amount > 0, CoreError::InvalidAmount);

    let batch = &mut ctx.accounts.batch;
    let batch_id_bytes = batch.batch_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[BATCH_SEED, batch_id_bytes.as_ref(), &[batch.bump]]];

    // Read current shares from the vault_position account
    // We withdraw all shares this batch holds
    let vault_position_data = ctx.accounts.vault_position.try_borrow_data()?;
    let mut data_slice: &[u8] = &vault_position_data;
    let vault_pos = yield_vault::state::Position::try_deserialize(&mut data_slice)?;
    let shares_to_withdraw = vault_pos.shares;
    drop(vault_position_data);

    require!(shares_to_withdraw > 0, CoreError::InvalidAmount);

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

    // Transfer from batch_token_account back to user
    // (after yield_vault CPI, funds land in batch_token_account,
    //  then we forward to user — only supports single-user leave for now;
    //  multi-user leave partial withdrawal is handled in Phase 4 settlement)
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

    batch.total_deposited = batch
        .total_deposited
        .saturating_sub(position.deposited_amount);

    let position = &mut ctx.accounts.user_position;
    position.deposited_amount = 0;

    msg!(
        "User {} left batch {}",
        ctx.accounts.user.key(),
        batch.batch_id
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
