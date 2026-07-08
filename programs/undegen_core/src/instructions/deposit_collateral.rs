use crate::constants::{BATCH_SEED, COLLATERAL_SEED, PROOF_DEADLINE_SECONDS};
use crate::error::CoreError;
use crate::state::{Batch, BatchStatus};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

pub fn deposit_collateral_handler(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
    let batch = &mut ctx.accounts.batch;
    require!(
        batch.operator == ctx.accounts.operator.key(),
        CoreError::Unauthorized
    );
    require!(
        batch.status == BatchStatus::AwaitingCollateral,
        CoreError::NotAwaitingCollateral
    );
    require!(
        batch.collateral_deposited == 0,
        CoreError::CollateralAlreadyDeposited
    );
    require!(
        amount >= batch.collateral_required,
        CoreError::InvalidAmount
    );

    // Transfer collateral from operator into the collateral escrow PDA
    let cpi_accounts = TransferChecked {
        mint: ctx.accounts.mint.to_account_info(),
        from: ctx.accounts.operator_token_account.to_account_info(),
        to: ctx.accounts.collateral_token_account.to_account_info(),
        authority: ctx.accounts.operator.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;

    batch.collateral_deposited = amount;
    batch.status = BatchStatus::Active;
    // Proof must be submitted within 1hr after kickoff
    batch.proof_deadline = batch
        .kickoff_timestamp
        .checked_add(PROOF_DEADLINE_SECONDS)
        .ok_or(CoreError::MathOverflow)?;

    msg!(
        "Operator deposited {} collateral, batch Active, proof deadline {}",
        amount,
        batch.proof_deadline
    );
    Ok(())
}

#[derive(Accounts)]
pub struct DepositCollateral<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [BATCH_SEED, batch.batch_id.to_le_bytes().as_ref()],
        bump = batch.bump,
    )]
    pub batch: Account<'info, Batch>,

    #[account(mut)]
    pub operator_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Collateral escrow — PDA-owned token account
    #[account(
        init_if_needed,
        payer = operator,
        seeds = [COLLATERAL_SEED, batch.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = batch,
    )]
    pub collateral_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
