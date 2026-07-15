use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod txodds_types;

use instructions::*;

declare_id!("BgAM2mzfbFhcA1F3AfjfnV1nzyTJXb6bSz5BX7Wufwma");

#[program]
pub mod undegen_core {
    use super::*;

    pub fn initialize_batch(ctx: Context<InitializeBatch>, apy_bps: u16) -> Result<()> {
        instructions::initialize_batch::initialize_batch_handler(ctx, apy_bps)
    }

    pub fn initialize_protocol(ctx: Context<InitializeProtocol>) -> Result<()> {
        instructions::initialize_protocol::initialize_protocol_handler(ctx)
    }

    pub fn join_batch(ctx: Context<JoinBatch>, amount: u64) -> Result<()> {
        instructions::join_batch::join_batch_handler(ctx, amount)
    }

    pub fn leave_batch(ctx: Context<LeaveBatch>, amount: u64) -> Result<()> {
        instructions::leave_batch::leave_batch_handler(ctx, amount)
    }

    pub fn start_batch(ctx: Context<StartBatch>) -> Result<()> {
        instructions::start_batch::start_batch_handler(ctx)
    }

    // UPDATED: Now accepts an array of 4 BetTerms instead of individual binary parameters
    pub fn propose_match(
        ctx: Context<ProposeMatch>,
        bet_terms_array: [crate::state::BetTerms; 4],
        kickoff_timestamp: i64,
    ) -> Result<()> {
        instructions::propose_match::propose_match_handler(
            ctx, 
            bet_terms_array, 
            kickoff_timestamp
        )
    }

    // UPDATED: Now takes the vote_index (0-4) instead of a boolean
    pub fn cast_vote(ctx: Context<CastVote>, vote_index: u8) -> Result<()> {
        instructions::cast_vote::cast_vote_handler(ctx, vote_index)
    }

    pub fn finalize_consensus(ctx: Context<FinalizeConsensus>) -> Result<()> {
        instructions::finalize_consensus::finalize_consensus_handler(ctx)
    }

    // UPDATED: Now accepts the oracle_price_index and the full TxOdds validation payload
    pub fn deposit_collateral(
        ctx: Context<DepositCollateral>, 
        amount: u64,
        oracle_price_index: u8,
        odds_snapshot: crate::txodds_types::Odds,
        summary: crate::txodds_types::OddsBatchSummary,
        sub_tree_proof: Vec<crate::txodds_types::ProofNode>,
        main_tree_proof: Vec<crate::txodds_types::ProofNode>,
    ) -> Result<()> {
        instructions::deposit_collateral::deposit_collateral_handler(
            ctx, 
            amount, 
            oracle_price_index, 
            odds_snapshot, 
            summary, 
            sub_tree_proof, 
            main_tree_proof
        )
    }

    pub fn penalize_missed_collateral(ctx: Context<PenalizeMissedCollateral>) -> Result<()> {
        instructions::penalize_missed_collateral::penalize_missed_collateral_handler(ctx)
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        instructions::claim::claim_handler(ctx)
    }

    pub fn settle_with_proof(
        ctx: Context<SettleWithProof>,
        fixture_summary: crate::txodds_types::ScoresBatchSummary,
        main_tree_proof: Vec<crate::txodds_types::ProofNode>,
        fixture_proof: Vec<crate::txodds_types::ProofNode>,
        stat_a: crate::txodds_types::StatTerm,
        stat_b: Option<crate::txodds_types::StatTerm>,
        ts: i64
    ) -> Result<()> {
        instructions::settle_with_proof::settle_with_proof_handler(
            ctx,
            fixture_summary,
            main_tree_proof,
            fixture_proof,
            stat_a,
            stat_b,
            ts
        )
    }

    pub fn settle_default(ctx: Context<SettleDefault>) -> Result<()> {
        instructions::settle_default::settle_default_handler(ctx)
    }

    pub fn claim_operator_yield(ctx: Context<ClaimOperatorYield>) -> Result<()> {
        instructions::claim_operator_yield::claim_operator_yield_handler(ctx)
    }
}