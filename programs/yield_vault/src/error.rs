use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Deposit amount too small to mint any shares")]
    DepositTooSmall,
    #[msg("Withdraw amount too small")]
    WithdrawTooSmall,
    #[msg("Not enough shares in this position")]
    InsufficientShares,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Nothing to grow, vault is empty")]
    NothingToGrow,
    #[msg("Reserve is depleted, fund it before ticking again")]
    ReserveDepleted,
}