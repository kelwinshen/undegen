use anchor_lang::prelude::*;

// ==========================================
// TXODDS: DISCRIMINATORS
// ==========================================
pub const VALIDATE_ODDS_DISCRIMINATOR: [u8; 8] = [192, 19, 91, 138, 104, 100, 212, 86];
// NEW: validate_stat replaces the old audit_trade_result
pub const VALIDATE_STAT_DISCRIMINATOR: [u8; 8] = [107, 197, 232, 90, 191, 136, 105, 185];

// ==========================================
// TXODDS: SHARED TYPES
// ==========================================
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ProofNode {
    pub hash: [u8; 32],
    pub is_right_sibling: bool,
}

// ==========================================
// TXODDS: SCORE VERIFICATION TYPES (Phase 4)
// ==========================================
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ScoresUpdateStats {
    pub update_count: i32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ScoresBatchSummary {
    pub fixture_id: i64,
    pub update_stats: ScoresUpdateStats,
    pub events_sub_tree_root: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ScoreStat {
    pub key: u32,
    pub value: i32,
    pub period: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct StatTerm {
    pub stat_to_prove: ScoreStat,
    pub event_stat_root: [u8; 32],
    pub stat_proof: Vec<ProofNode>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum Comparison {
    GreaterThan,
    LessThan,
    EqualTo,
}
impl Default for Comparison {
    fn default() -> Self { Comparison::GreaterThan }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum BinaryExpression {
    Add,
    Subtract,
}
impl Default for BinaryExpression {
    fn default() -> Self { BinaryExpression::Add }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug, Default)]
pub struct TraderPredicate {
    pub threshold: i32,
    pub comparison: Comparison,
}

// Args struct for validate_stat (Matches exact order of new IDL)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ValidateStatArgs {
    pub ts: i64,
    pub fixture_summary: ScoresBatchSummary,
    pub fixture_proof: Vec<ProofNode>,
    pub main_tree_proof: Vec<ProofNode>,
    pub predicate: TraderPredicate,
    pub stat_a: StatTerm,
    pub stat_b: Option<StatTerm>,
    pub op: Option<BinaryExpression>,
}

// ==========================================
// TXODDS: ODDS VERIFICATION TYPES (Phase 3)
// ==========================================
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct OddsUpdateStats {
    pub update_count: u32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct OddsBatchSummary {
    pub fixture_id: i64,
    pub update_stats: OddsUpdateStats,
    pub odds_sub_tree_root: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct Odds {
    pub fixture_id: i64,
    pub message_id: String,
    pub ts: i64,
    pub bookmaker: String,
    pub bookmaker_id: i32,
    pub super_odds_type: String,
    pub game_state: Option<String>,
    pub in_running: bool,
    pub market_parameters: Option<String>,
    pub market_period: Option<String>,
    pub price_names: Vec<String>,
    pub prices: Vec<i32>,
}

// Args struct for validate_odds
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ValidateOddsArgs {
    pub ts: i64,
    pub odds_snapshot: Odds,
    pub summary: OddsBatchSummary,
    pub sub_tree_proof: Vec<ProofNode>,
    pub main_tree_proof: Vec<ProofNode>,
}