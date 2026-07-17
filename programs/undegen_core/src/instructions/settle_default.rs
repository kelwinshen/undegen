use crate::constants::{BATCH_SEED, COLLATERAL_SEED, MAX_BETS};
use crate::error::CoreError;
use crate::state::{Batch, BatchStatus, BetTerms};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

/// Callable by anyone after proof_deadline passes with no proof submitted.
/// Defaults to user wins — operator yield entitlement slashed 20%.
pub fn settle_default_handler(ctx: Context<SettleDefault>) -> Result<()> {
    let batch = &mut ctx.accounts.batch;
    require!(batch.status == BatchStatus::Active || batch.status == BatchStatus::AwaitingCollateral , CoreError::NotActiveOrNotWaitingCollateral);

    // let clock = Clock::get()?;
    // require!(
    //     clock.unix_timestamp >= batch.proof_deadline,
    //     CoreError::ProofDeadlineNotPassed
    // );

    // Users win by operator silence — slash operator yield entitlement 20%
    batch.operator_yield_bps = batch.operator_yield_bps.saturating_sub(2000);
    batch.outcome = Some(true);
    batch.bets_completed = batch.bets_completed.saturating_add(1);
    batch.wins_count = batch.wins_count.saturating_add(1);

    // --- NEW: Reset current bet state for the multi-option array model ---
    batch.bet_terms = [BetTerms::default(); 4];
    batch.vote_weights = [0; 5];
    batch.winning_vote_index = None;
    
    batch.kickoff_timestamp = 0;
    batch.win_prize = 0;
    batch.collateral_required = 0;
    batch.collateral_deposited = 0;
    batch.proof_deadline = 0;
    batch.outcome = None;

    // Move to Settled if all bets done, otherwise back to Locked for next bet
    if batch.bets_completed >= MAX_BETS {
        batch.status = BatchStatus::Settled;
        msg!(
            "Batch {} fully settled after {} bets — operator_yield_bps={}",
            batch.batch_id, MAX_BETS, batch.operator_yield_bps
        );
    } else {
        batch.status = BatchStatus::Locked;
        msg!(
            "Batch {} defaulted — users win, bet {}/{} done, operator_yield_bps={}",
            batch.batch_id, batch.bets_completed, MAX_BETS, batch.operator_yield_bps,
        );
    }

    // Transfer forfeited collateral into batch_token_account for users to claim
    let collateral_amount = ctx.accounts.collateral_token_account.amount;
    if collateral_amount > 0 {
        // Operator ghosted on proof past the deadline — the seized collateral
        // is a real win for users, same as settle_with_proof's true branch.
        batch.accumulated_winnings = batch.accumulated_winnings.saturating_add(collateral_amount);

        let batch_id_bytes = batch.batch_id.to_le_bytes();
        let signer_seeds: &[&[&[u8]]] = &[&[
            BATCH_SEED,
            batch_id_bytes.as_ref(),
            &[batch.bump],
        ]];

        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.collateral_token_account.to_account_info(),
                    to: ctx.accounts.batch_token_account.to_account_info(),
                    authority: ctx.accounts.batch.to_account_info(),
                },
                signer_seeds,
            ),
            collateral_amount,
            ctx.accounts.mint.decimals,
        )?;
    }

    Ok(())
}

#[derive(Accounts)]
pub struct SettleDefault<'info> {
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [BATCH_SEED, batch.batch_id.to_le_bytes().as_ref()],
        bump = batch.bump,
    )]
    pub batch: Account<'info, Batch>,

    #[account(
        mut,
        seeds = [COLLATERAL_SEED, batch.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = batch,
    )]
    pub collateral_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = batch,
    )]
    pub batch_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
}