use anchor_lang::prelude::*;

#[error_code]
pub enum LotteryError {
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Round is not open for entries")]
    RoundNotOpen,
    #[msg("Round has not been drawn yet")]
    RoundNotDrawn,
    #[msg("Pool is empty")]
    EmptyPool,
    #[msg("This entry did not win")]
    NotWinner,
    #[msg("Prize already claimed")]
    AlreadyClaimed,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Unauthorized")]
    Unauthorized,
}
