use anchor_lang::prelude::*;

#[error_code]
pub enum CoreError {
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Batch is not in Lobby status")]
    NotInLobby,
    #[msg("Batch is not in Locked status")]
    NotLocked,
    #[msg("Batch is not awaiting collateral")]
    NotAwaitingCollateral,
    #[msg("Batch is not active")]
    NotActive,
    #[msg("Batch is not awaiting proof")]
    NotAwaitingProof,
    #[msg("Batch is already settled or cancelled")]
    AlreadyFinished,
    #[msg("User has already voted")]
    AlreadyVoted,
    #[msg("User has already claimed")]
    AlreadyClaimed,
    #[msg("Voting has already concluded")]
    VotingClosed,
    #[msg("Kickoff time has not passed yet")]
    KickoffNotReached,
    #[msg("Collateral deadline has not passed yet")]
    CollateralDeadlineNotPassed,
    #[msg("Proof deadline has not passed yet")]
    ProofDeadlineNotPassed,
    #[msg("Collateral already deposited")]
    CollateralAlreadyDeposited,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("No votes were cast - bet skipped")]
    NoVotesCast,
    #[msg("Ed25519 instruction not found in transaction")]
    MissingEd25519Instruction,
    #[msg("Oracle signature verification failed")]
    InvalidOracleSignature,
    #[msg("Proof match ID does not match this batch")]
    MatchIdMismatch,
    #[msg("No yield generated yet — tick the vault before proposing a match")]
    NothingToGrow,
     #[msg("Invalid Oracle Account")]
    InvalidOracleAccount
}
