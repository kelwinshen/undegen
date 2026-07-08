use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("EBYBucMwfqYEXc9Hh56TpjwqxvgZDoJjWJoVc8sbFqPS");

#[program]
pub mod yield_vault {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        instructions::initialize_vault::initialize_vault_handler(ctx)
    }

    pub fn fund_reserve(ctx: Context<FundReserve>, amount: u64) -> Result<()> {
        instructions::fund_reserve::fund_reserve_handler(ctx, amount)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::deposit_handler(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, shares_amount: u64) -> Result<()> {
        instructions::withdraw::withdraw_handler(ctx, shares_amount)
    }

    pub fn tick_yield(ctx: Context<TickYield>) -> Result<()> {
        instructions::tick_yield::tick_yield_handler(ctx)
    }
}