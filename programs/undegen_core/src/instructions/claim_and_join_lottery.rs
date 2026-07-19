use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use lottery::program::Lottery;
use yield_vault::program::YieldVault;

use crate::constants::{BATCH_SEED, USER_POSITION_SEED};
use crate::error::CoreError;
use crate::state::{Batch, BatchStatus, UserPosition};

/// Same payout as `claim` (principal from the vault, plus this user's share
/// of the batch's accumulated winnings) except the winnings portion is spent
/// straight into a `lottery::buy_ticket` CPI instead of landing in the
/// user's wallet — principal is always claimed to the wallet, only the
/// "reward" leg is wagered. Reuses `buy_ticket`'s own interface unmodified:
/// the human `user` is passed through as `buyer` (their signature already
/// covers this whole transaction), so the resulting Entry is owned by them,
/// not by the batch PDA — they can claim_prize normally if it wins.
pub fn claim_and_join_lottery_handler(ctx: Context<ClaimAndJoinLottery>) -> Result<()> {
    let batch = &mut ctx.accounts.batch;
    let position = &ctx.accounts.user_position;

    require!(batch.status == BatchStatus::Settled, CoreError::AlreadyFinished);
    require!(!position.claimed, CoreError::AlreadyClaimed);
    require!(position.deposited_amount > 0, CoreError::InvalidAmount);

    let user_deposited = position.deposited_amount;
    let total_deposited = batch.total_deposited;
    let batch_id_bytes = batch.batch_id.to_le_bytes();
    let batch_bump = batch.bump;

    let signer_seeds: &[&[&[u8]]] = &[&[BATCH_SEED, batch_id_bytes.as_ref(), &[batch_bump]]];

    // --- Step 1: Withdraw principal only from yield_vault, straight to the user's wallet ---
    let vault_config_data = ctx.accounts.vault_config.try_borrow_data()?;
    let mut vault_slice: &[u8] = &vault_config_data;
    let vault_state = yield_vault::state::VaultConfig::try_deserialize(&mut vault_slice)?;
    drop(vault_config_data);

    let vault_position_data = ctx.accounts.vault_position.try_borrow_data()?;
    let mut pos_slice: &[u8] = &vault_position_data;
    let position_state = yield_vault::state::Position::try_deserialize(&mut pos_slice)?;
    drop(vault_position_data);

    require!(vault_state.total_shares > 0, CoreError::InvalidAmount);
    require!(vault_state.total_underlying > 0, CoreError::InvalidAmount);

    let user_shares = (position_state.shares as u128)
        .checked_mul(user_deposited as u128)
        .ok_or(CoreError::MathOverflow)?
        .checked_div(total_deposited as u128)
        .ok_or(CoreError::MathOverflow)? as u64;

    let user_underlying = (user_shares as u128)
        .checked_mul(vault_state.total_underlying as u128)
        .ok_or(CoreError::MathOverflow)?
        .checked_div(vault_state.total_shares as u128)
        .ok_or(CoreError::MathOverflow)? as u64;

    let withdraw_underlying = user_underlying.min(user_deposited);

    let shares_to_withdraw = (withdraw_underlying as u128)
        .checked_mul(vault_state.total_shares as u128)
        .ok_or(CoreError::MathOverflow)?
        .checked_div(vault_state.total_underlying as u128)
        .ok_or(CoreError::MathOverflow)? as u64;

    if shares_to_withdraw > 0 {
        ctx.accounts.batch_token_account.reload()?;
        let balance_before = ctx.accounts.batch_token_account.amount;

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
            shares_to_withdraw,
        )?;

        ctx.accounts.batch_token_account.reload()?;
        let balance_after = ctx.accounts.batch_token_account.amount;
        let vault_payout = balance_after.checked_sub(balance_before).ok_or(CoreError::MathOverflow)?;

        if vault_payout > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    TransferChecked {
                        mint: ctx.accounts.mint.to_account_info(),
                        from: ctx.accounts.batch_token_account.to_account_info(),
                        to: ctx.accounts.user_token_account.to_account_info(),
                        authority: batch.to_account_info(),
                    },
                    signer_seeds,
                ),
                vault_payout,
                ctx.accounts.mint.decimals,
            )?;
        }
    }

    // --- Step 2: user's proportional share of the batch's real balance —
    // routed to their wallet first (same math as `claim`), then immediately
    // wagered via CPI below instead of staying there. ---
    ctx.accounts.batch_token_account.reload()?;
    let batch_balance = ctx.accounts.batch_token_account.amount;

    let mut reward_amount: u64 = 0;
    if batch_balance > 0 && total_deposited > 0 {
        let user_batch_share = (batch_balance as u128)
            .checked_mul(user_deposited as u128)
            .ok_or(CoreError::MathOverflow)?
            .checked_div(total_deposited as u128)
            .ok_or(CoreError::MathOverflow)? as u64;

        if user_batch_share > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    TransferChecked {
                        mint: ctx.accounts.mint.to_account_info(),
                        from: ctx.accounts.batch_token_account.to_account_info(),
                        to: ctx.accounts.user_token_account.to_account_info(),
                        authority: batch.to_account_info(),
                    },
                    signer_seeds,
                ),
                user_batch_share,
                ctx.accounts.mint.decimals,
            )?;
            reward_amount = user_batch_share;
        }
    }

    // --- Step 3: state updates (same as claim) ---
    batch.total_deposited = batch.total_deposited.checked_sub(user_deposited).ok_or(CoreError::MathOverflow)?;

    let position = &mut ctx.accounts.user_position;
    position.claimed = true;

    // --- Step 4: wager the reward leg into the active lottery round, on
    // behalf of the real user — `user` already signed this transaction, so
    // that signature carries through the CPI without needing PDA seeds. ---
    if reward_amount > 0 {
        let cpi_accounts = lottery::cpi::accounts::BuyTicket {
            buyer: ctx.accounts.user.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            round: ctx.accounts.lottery_round.to_account_info(),
            jackpot_token_account: ctx.accounts.lottery_jackpot_token_account.to_account_info(),
            buyer_token_account: ctx.accounts.user_token_account.to_account_info(),
            entry: ctx.accounts.lottery_entry.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.lottery_program.key(), cpi_accounts);
        lottery::cpi::buy_ticket(cpi_ctx, reward_amount)?;
    }

    msg!(
        "User {} claimed batch {} — principal={} reward_wagered={}",
        ctx.accounts.user.key(),
        ctx.accounts.batch.batch_id,
        withdraw_underlying,
        reward_amount,
    );
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimAndJoinLottery<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [BATCH_SEED, batch.batch_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub batch: Box<Account<'info, Batch>>,

    #[account(
        mut,
        seeds = [USER_POSITION_SEED, batch.key().as_ref(), user.key().as_ref()],
        bump,
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

    /// CHECK: yield_vault VaultConfig
    #[account(mut)]
    pub vault_config: UncheckedAccount<'info>,

    /// CHECK: yield_vault main token account
    #[account(mut)]
    pub vault_token_account: UncheckedAccount<'info>,

    /// CHECK: yield_vault Position PDA for this batch
    #[account(mut)]
    pub vault_position: UncheckedAccount<'info>,

    /// CHECK: lottery Round PDA for the currently active round — must be
    /// Open, enforced inside buy_ticket's own handler, not re-checked here.
    #[account(mut)]
    pub lottery_round: UncheckedAccount<'info>,

    /// CHECK: that round's jackpot token account (its ATA, authority = round)
    #[account(mut)]
    pub lottery_jackpot_token_account: UncheckedAccount<'info>,

    /// CHECK: lottery Entry PDA for this user+round — init_if_needed inside
    /// the buy_ticket CPI itself, not by this program.
    #[account(mut)]
    pub lottery_entry: UncheckedAccount<'info>,

    pub yield_vault_program: Program<'info, YieldVault>,
    pub lottery_program: Program<'info, Lottery>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
