use anchor_lang::prelude::*;

// Mirrors TxOdds IDL types exactly — used for CPI into audit_trade_result.
// Field order and types must match perfectly for Borsh to serialize correctly.

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProofNode {
    pub hash: [u8; 32],
    pub is_right_sibling: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScoresUpdateStats {
    pub update_count: i32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScoresBatchSummary {
    pub fixture_id: i64,
    pub update_stats: ScoresUpdateStats,
    pub events_sub_tree_root: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScoreStat {
    pub key: u32,
    pub value: i32,
    pub period: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct StatTerm {
    pub stat_to_prove: ScoreStat,
    pub event_stat_root: [u8; 32],
    pub stat_proof: Vec<ProofNode>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum Comparison {
    GreaterThan,
    LessThan,
    EqualTo,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TraderPredicate {
    pub threshold: i32,
    pub comparison: Comparison,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum BinaryExpression {
    Add,
    Subtract,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MarketIntentParams {
    pub fixture_id: i64,
    pub period: u16,
    pub stat_a_key: u32,
    pub stat_b_key: Option<u32>,
    pub predicate: TraderPredicate,
    pub op: Option<BinaryExpression>,
    pub negation: bool,
}

// Args struct for audit_trade_result — Borsh-serialized after the discriminator
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct AuditTradeResultArgs {
    pub terms: MarketIntentParams,
    pub fixture_summary: ScoresBatchSummary,
    pub main_tree_proof: Vec<ProofNode>,
    pub fixture_proof: Vec<ProofNode>,
    pub stat_a: StatTerm,
    pub stat_b: Option<StatTerm>,
    pub ts: i64,
}
