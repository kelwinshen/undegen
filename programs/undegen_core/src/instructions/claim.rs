use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use yield_vault::cpi::accounts::Withdraw;
use yield_vault::program::YieldVault;

use crate::constants::{BATCH_SEED, COLLATERAL_SEED, USER_POSITION_SEED};
use crate::error::CoreError;
use crate::state::{Batch, BatchStatus, UserPosition};

pub fn claim_handler(ctx: Context<Claim>) -> Result<()> {
    let batch = &ctx.accounts.batch;
    let position = &ctx.accounts.user_position;

    require!(batch.status == BatchStatus::Settled, CoreError::AlreadyFinished);
    require!(!position.claimed, CoreError::AlreadyClaimed);
    require!(position.deposited_amount > 0, CoreError::InvalidAmount);
    require!(batch.total_deposited > 0, CoreError::InvalidAmount);

    let user_deposited = position.deposited_amount;
    let total_deposited = batch.total_deposited;
    let forfeited_collateral = batch.forfeited_collateral;
    let batch_id_bytes = batch.batch_id.to_le_bytes();
    let batch_bump = batch.bump;

    let signer_seeds: &[&[&[u8]]] = &[&[
        BATCH_SEED,
        batch_id_bytes.as_ref(),
        &[batch_bump],
    ]];

    

    // --- Step 1: Withdraw user's proportional shares from yield_vault ---
    // Read current vault position to get total shares held by this batch
    let vault_position_data = ctx.accounts.vault_position.try_borrow_data()?;
    let mut pos_slice: &[u8] = &vault_position_data;
    let vault_pos = yield_vault::state::Position::try_deserialize(&mut pos_slice)?;
    drop(vault_position_data);

    msg!("DEBUG claim: user_deposited={} total_deposited={} vault_shares={}", 
    user_deposited, total_deposited, vault_pos.shares);

    // user_shares = total_batch_shares × (user_deposited / total_deposited)
    let user_shares = (vault_pos.shares as u128)
        .checked_mul(user_deposited as u128)
        .ok_or(CoreError::MathOverflow)?
        .checked_div(total_deposited as u128)
        .ok_or(CoreError::MathOverflow)? as u64;

    if user_shares > 0 {
        yield_vault::cpi::withdraw(
            CpiContext::new_with_signer(
                ctx.accounts.yield_vault_program.key(),
                Withdraw {
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
            user_shares,
        )?;

        // Forward vault withdrawal from batch_token_account to user
        ctx.accounts.batch_token_account.reload()?;
        let vault_payout = ctx.accounts.batch_token_account.amount;
        if vault_payout > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    TransferChecked {
                        mint: ctx.accounts.mint.to_account_info(),
                        from: ctx.accounts.batch_token_account.to_account_info(),
                        to: ctx.accounts.user_token_account.to_account_info(),
                        authority: ctx.accounts.batch.to_account_info(),
                    },
                    signer_seeds,
                ),
                vault_payout,
                ctx.accounts.mint.decimals,
            )?;
        }
    }

    // --- Step 2: If settle_default was called, distribute user's share
    // of forfeited collateral from the collateral escrow account ---
    if forfeited_collateral > 0 {
        let user_collateral_share = (forfeited_collateral as u128)
            .checked_mul(user_deposited as u128)
            .ok_or(CoreError::MathOverflow)?
            .checked_div(total_deposited as u128)
            .ok_or(CoreError::MathOverflow)? as u64;

        if user_collateral_share > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    TransferChecked {
                        mint: ctx.accounts.mint.to_account_info(),
                        from: ctx.accounts.collateral_token_account.to_account_info(),
                        to: ctx.accounts.user_token_account.to_account_info(),
                        authority: ctx.accounts.batch.to_account_info(),
                    },
                    signer_seeds,
                ),
                user_collateral_share,
                ctx.accounts.mint.decimals,
            )?;
        }
    }

    // Mark position as claimed and reduce total_deposited
    // so subsequent claimants' share calculations remain correct
    let position = &mut ctx.accounts.user_position;
    position.claimed = true;

    let batch = &mut ctx.accounts.batch;
    batch.total_deposited = batch.total_deposited.saturating_sub(user_deposited);

    msg!(
        "User {} claimed from batch {} — shares={} deposited={}",
        ctx.accounts.user.key(),
        batch.batch_id,
        user_shares,
        user_deposited,
    );
    Ok(())
}


#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [BATCH_SEED, batch.batch_id.to_le_bytes().as_ref()],
        bump = batch.bump,
    )]
    pub batch: Box<Account<'info, Batch>>,

    #[account(
        mut,
        seeds = [USER_POSITION_SEED, batch.key().as_ref(), user.key().as_ref()],
        bump = user_position.bump,
        constraint = user_position.owner == user.key() @ CoreError::Unauthorized,
    )]
    pub user_position: Box<Account<'info, UserPosition>>,

    #[account(mut)]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = batch,
    )]
    pub batch_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [COLLATERAL_SEED, batch.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = batch,
    )]
    pub collateral_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

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