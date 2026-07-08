use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use yield_vault::cpi::accounts::Deposit;
use yield_vault::program::YieldVault;

use crate::constants::{BATCH_SEED, COLLATERAL_SEED};
use crate::error::CoreError;
use crate::state::{Batch, BatchStatus, BetTerms};
use crate::txodds_types::*;

pub const TXODDS_PROGRAM_ID: Pubkey =
    anchor_lang::solana_program::pubkey::pubkey!("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");

pub const AUDIT_TRADE_RESULT_DISCRIMINATOR: [u8; 8] = [50, 242, 243, 5, 209, 75, 76, 91];

fn bet_terms_to_market_params(terms: &BetTerms) -> MarketIntentParams {
    let comparison = match terms.predicate_comparison {
        0 => Comparison::GreaterThan,
        1 => Comparison::LessThan,
        _ => Comparison::EqualTo,
    };
    MarketIntentParams {
        fixture_id: terms.fixture_id,
        period: terms.period,
        stat_a_key: terms.stat_a_key,
        stat_b_key: terms.stat_b_key,
        predicate: TraderPredicate {
            threshold: terms.predicate_threshold,
            comparison,
        },
        op: None,
        negation: terms.negation,
    }
}

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
    require!(
        clock.unix_timestamp >= batch.kickoff_timestamp,
        CoreError::KickoffNotReached
    );
    require!(
        clock.unix_timestamp < batch.proof_deadline,
        CoreError::ProofDeadlineNotPassed
    );

    require!(
        fixture_summary.fixture_id == batch.bet_terms.fixture_id,
        CoreError::MatchIdMismatch
    );

    // --- TxOdds proof verification CPI ---
    let terms = bet_terms_to_market_params(&batch.bet_terms);
    let args = AuditTradeResultArgs {
        terms,
        fixture_summary,
        main_tree_proof,
        fixture_proof,
        stat_a,
        stat_b,
        ts,
    };

    let mut ix_data = AUDIT_TRADE_RESULT_DISCRIMINATOR.to_vec();
    args.serialize(&mut ix_data)
        .map_err(|_| CoreError::InvalidOracleSignature)?;

    let txodds_accounts = vec![
        AccountMeta::new(ctx.accounts.operator.key(), true),
        AccountMeta::new_readonly(ctx.accounts.daily_scores_merkle_roots.key(), false),
    ];

    anchor_lang::solana_program::program::invoke(
        &Instruction {
            program_id: TXODDS_PROGRAM_ID,
            accounts: txodds_accounts,
            data: ix_data,
        },
        &[
            ctx.accounts.operator.to_account_info(),
            ctx.accounts.daily_scores_merkle_roots.to_account_info(),
        ],
    )
    .map_err(|_| CoreError::InvalidOracleSignature)?;

    // --- Proof verified — operator earns commission regardless of bet outcome ---
    // Commission = yield × commission_bps / 10_000
    // yield = baseline was set at start_batch, win_prize was computed from yield at propose_match
    // We use win_prize / (odds_numerator / odds_denominator) to recover yield amount
    let yield_amount = (batch.win_prize as u128)
        .checked_mul(batch.odds_denominator as u128)
        .ok_or(CoreError::MathOverflow)?
        .checked_div(batch.odds_numerator as u128)
        .ok_or(CoreError::MathOverflow)? as u64;

    let commission_amount = (yield_amount as u128)
        .checked_mul(batch.commission_bps as u128)
        .ok_or(CoreError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(CoreError::MathOverflow)? as u64;

    let batch_id_bytes = batch.batch_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[BATCH_SEED, batch_id_bytes.as_ref(), &[batch.bump]]];

    // Withdraw commission from vault to operator
    if commission_amount > 0 {
        msg!("Paying operator commission: {} tokens", commission_amount);
        yield_vault::cpi::withdraw(
            CpiContext::new_with_signer(
                ctx.accounts.yield_vault_program.key(),
                yield_vault::cpi::accounts::Withdraw {
                    depositor: batch.to_account_info(),
                    vault_config: ctx.accounts.vault_config.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    vault_token_account: ctx.accounts.vault_token_account.to_account_info(),
                    depositor_token_account: ctx.accounts.batch_token_account.to_account_info(),
                    position: ctx.accounts.vault_position.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                },
                signer_seeds,
            ),
            commission_amount,
        )?;

        // batch_token_account now holds commission — forward to operator
        ctx.accounts.batch_token_account.reload()?;
        let received = ctx.accounts.batch_token_account.amount;
        if received > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    TransferChecked {
                        mint: ctx.accounts.mint.to_account_info(),
                        from: ctx.accounts.batch_token_account.to_account_info(),
                        to: ctx.accounts.operator_token_account.to_account_info(),
                        authority: batch.to_account_info(),
                    },
                    signer_seeds,
                ),
                received,
                ctx.accounts.mint.decimals,
            )?;
        }
    }

    // Update baseline to current underlying after commission withdrawal
    // so next bet's yield is measured from here
    let vault_config_data = ctx.accounts.vault_config.try_borrow_data()?;
    let mut vault_slice: &[u8] = &vault_config_data;
    let vault_state = yield_vault::state::VaultConfig::try_deserialize(&mut vault_slice)?;
    drop(vault_config_data);

    let vault_position_data = ctx.accounts.vault_position.try_borrow_data()?;
    let mut pos_slice: &[u8] = &vault_position_data;
    let position_state = yield_vault::state::Position::try_deserialize(&mut pos_slice)?;
    drop(vault_position_data);

    let new_baseline = if vault_state.total_shares > 0 {
        (position_state.shares as u128)
            .checked_mul(vault_state.total_underlying as u128)
            .ok_or(CoreError::MathOverflow)?
            .checked_div(vault_state.total_shares as u128)
            .ok_or(CoreError::MathOverflow)? as u64
    } else {
        0
    };
    batch.baseline_underlying = new_baseline;

    // --- Settle the bet outcome ---
    batch.outcome = Some(outcome);
    batch.status = BatchStatus::Settled;

    if outcome {
        // Users won — compound operator's collateral into vault
        msg!("Users won — compounding collateral into yield_vault");
        let collateral_amount = ctx.accounts.collateral_token_account.amount;
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
    } else {
        // Operator won — return collateral to operator
        msg!("Operator won — returning collateral");
        let collateral_amount = ctx.accounts.collateral_token_account.amount;
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

    msg!(
        "Batch {} settled — outcome={} commission={}",
        batch.batch_id,
        outcome,
        commission_amount
    );
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

    /// Batch's ATA — used as intermediate for commission withdrawal from vault
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = batch,
    )]
    pub batch_token_account: InterfaceAccount<'info, TokenAccount>,

    pub yield_vault_program: Program<'info, YieldVault>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
}