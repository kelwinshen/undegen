use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use yield_vault::cpi::accounts::Deposit;
use yield_vault::program::YieldVault;

use crate::constants::{BATCH_SEED, USER_POSITION_SEED};
use crate::error::CoreError;
use crate::state::{Batch, BatchStatus, UserPosition};

pub fn join_batch_handler(ctx: Context<JoinBatch>, amount: u64) -> Result<()> {
    require!(amount > 0, CoreError::InvalidAmount);
    require!(
        ctx.accounts.batch.status == BatchStatus::Lobby,
        CoreError::NotInLobby
    );

    // Read vault position shares BEFORE deposit to compute delta
    let shares_before = {
        let data = ctx.accounts.vault_position.try_borrow_data()?;
        if data.len() > 8 {
            let mut slice: &[u8] = &data;
            yield_vault::state::Position::try_deserialize(&mut slice)
                .map(|p| p.shares)
                .unwrap_or(0)
        } else {
            0 // account doesn't exist yet
        }
    };

    let batch = &mut ctx.accounts.batch;
    let batch_id_bytes = batch.batch_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[BATCH_SEED, batch_id_bytes.as_ref(), &[batch.bump]]];

    // Step 1: Transfer USDC from user into batch_token_account
    let transfer_to_batch = TransferChecked {
        mint: ctx.accounts.mint.to_account_info(),
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.batch_token_account.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new(ctx.accounts.token_program.key(), transfer_to_batch),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    // Step 2: CPI into yield_vault::deposit
    let cpi_accounts = Deposit {
        depositor: batch.to_account_info(),
        position_payer: ctx.accounts.user.to_account_info(),
        vault_config: ctx.accounts.vault_config.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        vault_token_account: ctx.accounts.vault_token_account.to_account_info(),
        depositor_token_account: ctx.accounts.batch_token_account.to_account_info(),
        position: ctx.accounts.vault_position.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
    };
    yield_vault::cpi::deposit(
        CpiContext::new_with_signer(
            ctx.accounts.yield_vault_program.key(),
            cpi_accounts,
            signer_seeds,
        ),
        amount,
    )?;

    // Read shares AFTER deposit to compute how many were minted for this user
    let shares_after = {
        let data = ctx.accounts.vault_position.try_borrow_data()?;
        let mut slice: &[u8] = &data;
        yield_vault::state::Position::try_deserialize(&mut slice)
            .map(|p| p.shares)
            .unwrap_or(0)
    };
    let shares_minted = shares_after.saturating_sub(shares_before);

    // Update batch
    if batch.vault_position == Pubkey::default() {
        batch.vault_position = ctx.accounts.vault_position.key();
    }
    batch.total_deposited = batch
        .total_deposited
        .checked_add(amount)
        .ok_or(CoreError::MathOverflow)?;

    // Update user position — store exact shares minted
    let position = &mut ctx.accounts.user_position;
    if position.deposited_amount == 0 {
        position.batch = batch.key();
        position.owner = ctx.accounts.user.key();
        position.has_voted = false;
        
        // --- NEW: Initialize the vote_index instead of the boolean ---
        position.vote_index = 0; 
        
        position.claimed = false;
        position.vault_shares = 0;
        position.bump = ctx.bumps.user_position;
    }
    position.deposited_amount = position
        .deposited_amount
        .checked_add(amount)
        .ok_or(CoreError::MathOverflow)?;
    position.vault_shares = position
        .vault_shares
        .checked_add(shares_minted)
        .ok_or(CoreError::MathOverflow)?;

    msg!(
        "User {} joined batch {} with {} → {} shares",
        ctx.accounts.user.key(),
        batch.batch_id,
        amount,
        shares_minted
    );
    
    Ok(())
}

#[derive(Accounts)]
pub struct JoinBatch<'info> {
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
        init_if_needed,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = batch,
    )]
    pub batch_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: yield_vault VaultConfig PDA
    #[account(mut)]
    pub vault_config: UncheckedAccount<'info>,

    /// CHECK: yield_vault main token account
    #[account(mut)]
    pub vault_token_account: UncheckedAccount<'info>,

    /// CHECK: yield_vault Position PDA for this batch
    #[account(mut)]
    pub vault_position: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserPosition::INIT_SPACE,
        seeds = [USER_POSITION_SEED, batch.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub user_position: Account<'info, UserPosition>,

    pub yield_vault_program: Program<'info, YieldVault>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
}