use crate::constants::{BATCH_SEED, COLLATERAL_SEED, MAX_BETS, PROOF_DEADLINE_SECONDS, TXODDS_PROGRAM_ID};
use crate::error::CoreError;
use crate::state::{Batch, BatchStatus, BetTerms};
use crate::txodds_types::{Odds, OddsBatchSummary, ProofNode, ValidateOddsArgs, VALIDATE_ODDS_DISCRIMINATOR};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

pub fn deposit_collateral_handler(
    ctx: Context<DepositCollateral>,
    amount: u64,
    oracle_price_index: u8,
    odds_snapshot: Odds,
    summary: OddsBatchSummary,
    sub_tree_proof: Vec<ProofNode>,
    main_tree_proof: Vec<ProofNode>,
) -> Result<()> {
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


    // 1. Calculate epoch day using milliseconds
let proof_ts_ms = odds_snapshot.ts.checked_mul(1000).ok_or(CoreError::MathOverflow)?;
let epoch_day: u16 = (proof_ts_ms / 86400000) as u16;

// 2. Derive expected PDA
let (expected_pda, _) = Pubkey::find_program_address(
    &[b"daily_batch_roots", &epoch_day.to_le_bytes()],
    &TXODDS_PROGRAM_ID,
);

msg!("{}",expected_pda);

// 3. SECURE THE CPI: Ensure the passed account is the real Oracle account
require!(
    ctx.accounts.daily_odds_merkle_roots.key() == expected_pda,
    CoreError::InvalidOracleAccount
);

    let winning_index = batch.winning_vote_index.expect("Consensus not finalized");
    let is_skip = winning_index == 4;

    let actual_collateral_required = if is_skip {
        // Option 4 is "Skip Match". Bypass TxOdds — operator still owes bet_size
        batch.win_prize
    } else {
        let active_term = batch.bet_terms[winning_index as usize];
        require!(
            odds_snapshot.fixture_id == active_term.fixture_id,
            CoreError::MatchIdMismatch
        );

        let args = ValidateOddsArgs {
            ts: odds_snapshot.ts,
            odds_snapshot: odds_snapshot.clone(),
            summary,
            sub_tree_proof,
            main_tree_proof,
        };

        let mut ix_data = VALIDATE_ODDS_DISCRIMINATOR.to_vec();
        args.serialize(&mut ix_data)
            .map_err(|_| CoreError::InvalidOracleSignature)?;

        let txodds_accounts = vec![
            AccountMeta::new_readonly(ctx.accounts.daily_odds_merkle_roots.key(), false),
        ];

        // CPI Call to TxOdds validate_odds
        anchor_lang::solana_program::program::invoke(
            &Instruction {
                program_id: TXODDS_PROGRAM_ID,
                accounts: txodds_accounts,
                data: ix_data,
            },
            &[ctx.accounts.daily_odds_merkle_roots.to_account_info()],
        ).map_err(|_| CoreError::InvalidOracleSignature)?;

        require!(
            (oracle_price_index as usize) < odds_snapshot.prices.len(),
            CoreError::InvalidAmount
        );
        let verified_odds = odds_snapshot.prices[oracle_price_index as usize] as u64;

        batch.win_prize
            .checked_mul(verified_odds)
            .ok_or(CoreError::MathOverflow)?
            .checked_div(10_000)
            .ok_or(CoreError::MathOverflow)?
    };

    require!(
        amount >= actual_collateral_required,
        CoreError::InvalidAmount
    );

    // Transfer collateral from operator into escrow
    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.operator_token_account.to_account_info(),
                to: ctx.accounts.collateral_token_account.to_account_info(),
                authority: ctx.accounts.operator.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    batch.collateral_deposited = amount;

    if is_skip {
        // Skip: no match to wait for — settle immediately as a user win.
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
                    authority: batch.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        batch.bets_completed = batch.bets_completed.saturating_add(1);

        // Reset current bet state using the Default traits we set up
        batch.bet_terms = [BetTerms::default(); 4];
        batch.winning_vote_index = None;
        batch.vote_weights = [0u64; 5];
        batch.kickoff_timestamp = 0;
        batch.win_prize = 0;
        batch.collateral_required = 0;
        batch.collateral_deposited = 0;
        batch.proof_deadline = 0;

        if batch.bets_completed >= MAX_BETS {
            batch.status = BatchStatus::Settled;
            msg!("Batch {} fully settled after {} bets (last was skip)", batch.batch_id, MAX_BETS);
        } else {
            batch.status = BatchStatus::Locked;
            msg!("Batch {} bet {}/{} skipped — collateral {} moved to claim pool, back to Locked", batch.batch_id, batch.bets_completed, MAX_BETS, amount);
        }
    } else {
        // Normal bet — wait for match to conclude and proof to be submitted
        batch.status = BatchStatus::Active;
        batch.proof_deadline = batch
            .kickoff_timestamp
            .checked_add(PROOF_DEADLINE_SECONDS)
            .ok_or(CoreError::MathOverflow)?;

        msg!("Operator deposited {} collateral for winning option {}, batch Active", amount, winning_index);
    }

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

    #[account(
        init_if_needed,
        payer = operator,
        seeds = [COLLATERAL_SEED, batch.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = batch,
    )]
    pub collateral_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = operator,
        associated_token::mint = mint,
        associated_token::authority = batch,
    )]
    pub batch_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Validated inside the TxOdds manual invoke
    pub daily_odds_merkle_roots: UncheckedAccount<'info>,

    /// CHECK: Program ID verification
    #[account(address = TXODDS_PROGRAM_ID)]
    pub txodds_program: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
}