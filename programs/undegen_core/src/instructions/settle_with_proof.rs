use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use yield_vault::cpi::accounts::Deposit;
use yield_vault::program::YieldVault;

use crate::constants::{BATCH_SEED, COLLATERAL_SEED, MAX_BETS, TXODDS_PROGRAM_ID};
use crate::error::CoreError;
use crate::state::{Batch, BatchStatus, BetTerms};
use crate::txodds_types::*;

pub fn settle_with_proof_handler(
    ctx: Context<SettleWithProof>,
    fixture_summary: ScoresBatchSummary,
    main_tree_proof: Vec<ProofNode>,
    fixture_proof: Vec<ProofNode>,
    stat_a: StatTerm,
    stat_b: Option<StatTerm>,
    ts: i64,
    // Note: outcome: bool is REMOVED! We get this directly from the Oracle return data now.
) -> Result<()> {
    let batch = &mut ctx.accounts.batch;
    require!(batch.status == BatchStatus::Active, CoreError::NotActive);

    let clock = Clock::get()?;
    require!(clock.unix_timestamp >= batch.kickoff_timestamp, CoreError::KickoffNotReached);
    // require!(clock.unix_timestamp < batch.proof_deadline, CoreError::ProofDeadlineNotPassed);

    let winning_index = batch.winning_vote_index.expect("Consensus not finalized");
    
    // Skip option (4) never reaches this instruction because deposit_collateral 
    // bypasses the Active state entirely for skips.
    require!(winning_index < 4, CoreError::Unauthorized); 

    let active_term = batch.bet_terms[winning_index as usize];
    require!(fixture_summary.fixture_id == active_term.fixture_id, CoreError::MatchIdMismatch);

    // --- 1. PDA SECURITY CHECK FOR SCORES MERKLE ROOT ---
    // TxOdds Docs: For scores, use validation.summary.updateStats.minTimestamp
    let proof_ts_ms = fixture_summary.update_stats.min_timestamp;
    let epoch_day: u16 = (proof_ts_ms / 86400000) as u16;
    
    let (expected_pda, _) = Pubkey::find_program_address(
        &[b"daily_scores_roots", &epoch_day.to_le_bytes()],
        &TXODDS_PROGRAM_ID,
    );

    require!(
        ctx.accounts.daily_scores_merkle_roots.key() == expected_pda,
        CoreError::InvalidOracleAccount
    );

    // --- 2. EXECUTE THE CPI TO TXODDS ---
    let args = ValidateStatArgs {
        ts,
        fixture_summary,
        fixture_proof,
        main_tree_proof,
        predicate: active_term.predicate, 
        stat_a,
        stat_b,
        op: active_term.op,               
    };

    let mut ix_data = VALIDATE_STAT_DISCRIMINATOR.to_vec();
    args.serialize(&mut ix_data)
        .map_err(|_| CoreError::InvalidOracleSignature)?;

    let txodds_accounts = vec![
        AccountMeta::new_readonly(ctx.accounts.daily_scores_merkle_roots.key(), false),
    ];

    anchor_lang::solana_program::program::invoke(
        &Instruction {
            program_id: TXODDS_PROGRAM_ID,
            accounts: txodds_accounts,
            data: ix_data,
        },
        &[ctx.accounts.daily_scores_merkle_roots.to_account_info()],
    ).map_err(|_| CoreError::InvalidOracleSignature)?;

    // --- 3. GET THE OUTCOME FROM THE ORACLE RETURN DATA ---
    // Added explicit (Pubkey, Vec<u8>) type annotation here to fix the compiler error!
    let (_program_id, return_data): (Pubkey, Vec<u8>) = anchor_lang::solana_program::program::get_return_data()
        .ok_or(CoreError::OracleReturnDataMissing)?;

    // Anchor serializes a boolean as a single byte: [1] for true, [0] for false
    let outcome = return_data.first() == Some(&1);


    let batch_id_bytes = batch.batch_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[BATCH_SEED, batch_id_bytes.as_ref(), &[batch.bump]]];

    // --- 4. HANDLE PAYOUT BASED ON ORACLE OUTCOME ---
    batch.bets_completed = batch.bets_completed.saturating_add(1);

    if outcome {
        // TRUE = Predicate Met (Users won)
        msg!("Oracle says Users won — compounding collateral into vault");
        let collateral_amount = ctx.accounts.collateral_token_account.amount;
          batch.accumulated_winnings = batch.accumulated_winnings.saturating_add(collateral_amount);
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
        // FALSE = Predicate Failed (Operator won)
        msg!("Oracle says Operator won — returning collateral to operator");
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

    // --- 5. RESET STATE FOR NEXT ROUND ---
    batch.bet_terms = [BetTerms::default(); 4];
    batch.vote_weights = [0; 5];
    batch.winning_vote_index = None;
    batch.kickoff_timestamp = 0;
    batch.win_prize = 0;
    batch.collateral_required = 0;
    batch.collateral_deposited = 0;
    batch.proof_deadline = 0;
    batch.outcome = None;

    if batch.bets_completed >= MAX_BETS {
        batch.status = BatchStatus::Settled;
        msg!("Batch {} fully settled after {} bets.", batch.batch_id, MAX_BETS);
    } else {
        batch.status = BatchStatus::Locked;
        msg!("Batch {} round settled (outcome={}) — back to Locked", batch.batch_id, outcome);
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