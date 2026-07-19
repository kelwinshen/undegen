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
    #[msg("Round cannot be drawn until its 7-day duration has elapsed")]
    RoundNotExpired,
    #[msg("Round is not waiting on randomness")]
    RandomnessNotRequested,
    #[msg("Randomness account does not match the one committed for this round")]
    RandomnessAccountMismatch,
    #[msg("Switchboard randomness has not been revealed in this slot yet")]
    RandomnessNotResolved,
    #[msg("Failed to commit the Switchboard randomness request")]
    RandomnessCommitFailed,
}
