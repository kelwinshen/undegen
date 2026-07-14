use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use yield_vault::cpi::accounts::Deposit;
use yield_vault::program::YieldVault;

use crate::constants::{BATCH_SEED, COLLATERAL_SEED, MAX_BETS};
use crate::error::CoreError;
use crate::state::{Batch, BatchStatus, BetTerms};
use crate::txodds_types::*;

use crate::constants::TXODDS_PROGRAM_ID;

pub fn settle_with_proof_handler(
    ctx: Context<SettleWithProof>,
    fixture_summary: ScoresBatchSummary,
    main_tree_proof: Vec<ProofNode>,
    fixture_proof: Vec<ProofNode>,
    stat_a: StatTerm,
    stat_b: Option<StatTerm>,
    ts: i64,
    outcome: bool,
) -> Result<()> {
    let batch = &mut ctx.accounts.batch;
    require!(batch.status == BatchStatus::Active, CoreError::NotActive);

    let clock = Clock::get()?;
    require!(clock.unix_timestamp >= batch.kickoff_timestamp, CoreError::KickoffNotReached);
    require!(clock.unix_timestamp < batch.proof_deadline, CoreError::ProofDeadlineNotPassed);

    // Retrieve the winning index
    let winning_index = batch.winning_vote_index.expect("Consensus not finalized");

    // Only invoke TxOdds if a specific bet was chosen (Indices 0-3)
    if winning_index < 4 {
        let active_term = &batch.bet_terms[winning_index as usize];
        require!(fixture_summary.fixture_id == active_term.fixture_id, CoreError::MatchIdMismatch);

        // --- PHASE 4 FIX: TxOdds proof verification using validate_stat ---
        // Pass the predicate and op directly from our IDL-compliant BetTerms
        let args = ValidateStatArgs {
            ts,
            fixture_summary,
            fixture_proof,
            main_tree_proof,
            predicate: active_term.predicate, // Exact match to TraderPredicate
            stat_a,
            stat_b,
            op: active_term.op,               // Exact match to BinaryExpression
        };

        // Use the new VALIDATE_STAT_DISCRIMINATOR
        let mut ix_data = VALIDATE_STAT_DISCRIMINATOR.to_vec();
        args.serialize(&mut ix_data)
            .map_err(|_| CoreError::InvalidOracleSignature)?;

        // The IDL for validate_stat only expects the Merkle roots account
        let txodds_accounts = vec![
            AccountMeta::new_readonly(ctx.accounts.daily_scores_merkle_roots.key(), false),
        ];

        anchor_lang::solana_program::program::invoke(
            &Instruction {
                program_id: TXODDS_PROGRAM_ID,
                accounts: txodds_accounts,
                data: ix_data,
            },
            &[
                ctx.accounts.daily_scores_merkle_roots.to_account_info(),
            ],
        ).map_err(|_| CoreError::InvalidOracleSignature)?;
    } else {
        // Option 4 (Skip) was selected. Bypass oracle CPI.
        msg!("Skip option selected. Bypassing TxOdds verification.");
    }

    // Operator submitted proof on time — operator_yield_bps unchanged
    // Operator claims vault yield via claim_operator_yield after batch settles
    // No commission transfer here

    let batch_id_bytes = batch.batch_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[BATCH_SEED, batch_id_bytes.as_ref(), &[batch.bump]]];

    // --- Handle bet outcome ---
    batch.bets_completed = batch.bets_completed.saturating_add(1);

    if outcome {
        // Users won (or match was skipped, compounding the base bet size)
        msg!("Users won — compounding collateral into vault");
        let collateral_amount = ctx.accounts.collateral_token_account.amount;
        if collateral_amount > 0 {
            yield_vault::cpi::deposit(
                CpiContext::new_with_signer(
                    ctx.accounts.yield_vault_program.key(),
                    Deposit {
                        depositor: batch.to_account_info(),
                        position_payer: ctx.accounts.operator.to_account_info(),
                        vault_config: ctx.accounts.vault_config.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        vault_token_account: ctx.accounts.vault_token_account.to_account_info(),
                        depositor_token_account: ctx.accounts.collateral_token_account.to_account_info(),
                        position: ctx.accounts.vault_position.to_account_info(),
                        token_program: ctx.accounts.token_program.to_account_info(),
                        system_program: ctx.accounts.system_program.to_account_info(),
                    },
                    signer_seeds,
                ),
                collateral_amount,
            )?;
        }
    } else {
        // Operator won — return collateral to operator
        msg!("Operator won — returning collateral");
        let collateral_amount = ctx.accounts.collateral_token_account.amount;
        if collateral_amount > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    TransferChecked {
                        mint: ctx.accounts.mint.to_account_info(),
                        from: ctx.accounts.collateral_token_account.to_account_info(),
                        to: ctx.accounts.operator_token_account.to_account_info(),
                        authority: batch.to_account_info(),
                    },
                    signer_seeds,
                ),
                collateral_amount,
                ctx.accounts.mint.decimals,
            )?;
        }
    }

    // --- Reset current bet state ---
    batch.bet_terms = [BetTerms::default(); 4];
    batch.vote_weights = [0; 5];
    batch.winning_vote_index = None;

    batch.kickoff_timestamp = 0;
    batch.win_prize = 0;
    batch.collateral_required = 0;
    batch.collateral_deposited = 0;
    batch.proof_deadline = 0;
    batch.outcome = None;

    // Move to Settled if all bets done, otherwise back to Locked
    if batch.bets_completed >= MAX_BETS {
        batch.status = BatchStatus::Settled;
        msg!(
            "Batch {} fully settled after {} bets — operator_yield_bps={}",
            batch.batch_id, MAX_BETS, batch.operator_yield_bps
        );
    } else {
        batch.status = BatchStatus::Locked;
        msg!(
            "Batch {} bet {}/{} settled outcome={} — back to Locked",
            batch.batch_id, batch.bets_completed, MAX_BETS, outcome,
        );
    }

    Ok(())
}

#[derive(Accounts)]
pub struct SettleWithProof<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,

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

    #[account(mut)]
    pub operator_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: TxOdds daily_scores_merkle_roots PDA
    pub daily_scores_merkle_roots: UncheckedAccount<'info>,

    /// CHECK: TxOdds program
    #[account(address = TXODDS_PROGRAM_ID)]
    pub txodds_program: UncheckedAccount<'info>,

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
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
}