use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod txodds_types;

use instructions::*;

declare_id!("FLMTi3AzSvyTNsutnirzN6pdsKRDaZaVdeibBCfG8mgL");

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

    pub fn leave_batch(ctx: Context<LeaveBatch>) -> Result<()> {
        instructions::leave_batch::leave_batch_handler(ctx)
    }

    pub fn start_batch(ctx: Context<StartBatch>) -> Result<()> {
        instructions::start_batch::start_batch_handler(ctx)
    }
pub fn propose_match(
    ctx: Context<ProposeMatch>,
    fixture_id: i64,
    kickoff_timestamp: i64,
    period: u16,
    stat_a_key: u32,
    stat_b_key: Option<u32>,
    predicate_threshold: i32,
    predicate_comparison: u8,
    negation: bool,
) -> Result<()> {
    instructions::propose_match::propose_match_handler(
        ctx, fixture_id, kickoff_timestamp,
        period, stat_a_key, stat_b_key,
        predicate_threshold, predicate_comparison, negation,
    )
}
    pub fn cast_vote(ctx: Context<CastVote>, vote_yes: bool) -> Result<()> {
        instructions::cast_vote::cast_vote_handler(ctx, vote_yes)
    }

    pub fn finalize_consensus(ctx: Context<FinalizeConsensus>) -> Result<()> {
        instructions::finalize_consensus::finalize_consensus_handler(ctx)
    }

    pub fn deposit_collateral(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
        instructions::deposit_collateral::deposit_collateral_handler(ctx, amount)
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
        ts: i64,
        outcome: bool,
    ) -> Result<()> {
        instructions::settle_with_proof::settle_with_proof_handler(
            ctx,
            fixture_summary,
            main_tree_proof,
            fixture_proof,
            stat_a,
            stat_b,
            ts,
            outcome,
        )
    }

    pub fn settle_default(ctx: Context<SettleDefault>) -> Result<()> {
        instructions::settle_default::settle_default_handler(ctx)
    }

    pub fn claim_operator_yield(ctx: Context<ClaimOperatorYield>) -> Result<()> {
    instructions::claim_operator_yield::claim_operator_yield_handler(ctx)
}
}
