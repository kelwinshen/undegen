use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};
use crate::config::Config;
use serde_json::Value;
use crate::solana::{Odds, OddsBatchSummary, ProofNode};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TxOddsItem {
    pub id: String,
    #[serde(rename = "messageId")]
    pub message_id: String,
    pub ts: i64,
    #[serde(rename = "outcomeIndex")]
    pub outcome_index: u8,
    #[serde(rename = "fixtureId")]
    pub fixture_id: i64,
    pub participant1: String,
    pub participant2: String,
    pub odds: f64,
    #[serde(rename = "rawOdds")]
    pub raw_odds: i32,
    pub outcome: String,
    #[serde(rename = "marketType")]
    pub market_type: String,
    #[serde(rename = "marketParameters")]
    pub market_parameters: Option<String>,
    #[serde(rename = "marketPeriod")]
    pub market_period: Option<String>,
    pub kickoff: i64,
    pub period: u16,
    pub bookmaker_id: i32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ScoreParticipant {
    #[serde(alias = "HT")]
    pub ht: Option<i32>,
    #[serde(alias = "H2")]
    pub h2: Option<i32>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SnapshotScore {
    #[serde(alias = "Participant1", alias = "participant1")]
    pub participant1: Option<ScoreParticipant>,
    #[serde(alias = "Participant2", alias = "participant2")]
    pub participant2: Option<ScoreParticipant>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ScoreSnapshot {
    #[serde(alias = "Seq", alias = "seq")]
    pub seq: u64,
    #[serde(alias = "GameState", alias = "game_state")]
    pub game_state: Option<String>,
    #[serde(alias = "Score", alias = "score")]
    pub score: Option<SnapshotScore>,
    #[serde(flatten)]
    pub raw: serde_json::Map<String, serde_json::Value>,
}

// API Proof Structures (camelCase)
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ApiProofNode {
    pub hash: [u8; 32],
    #[serde(rename = "isRightSibling")]
    pub is_right_sibling: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ApiScoresUpdateStats {
    #[serde(rename = "updateCount")]
    pub update_count: i32,
    #[serde(rename = "minTimestamp")]
    pub min_timestamp: i64,
    #[serde(rename = "maxTimestamp")]
    pub max_timestamp: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ApiScoresBatchSummary {
    #[serde(rename = "fixtureId")]
    pub fixture_id: i64,
    #[serde(rename = "updateStats")]
    pub update_stats: ApiScoresUpdateStats,
    #[serde(rename = "eventStatsSubTreeRoot")]
    pub event_stats_sub_tree_root: [u8; 32],
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ApiScoreStat {
    pub key: u32,
    pub value: i32,
    pub period: i32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct StatValidationResponse {
    pub summary: ApiScoresBatchSummary,
    #[serde(rename = "mainTreeProof")]
    pub main_tree_proof: Vec<ApiProofNode>,
    #[serde(rename = "subTreeProof")]
    pub sub_tree_proof: Vec<ApiProofNode>,
    #[serde(rename = "statToProve")]
    pub stat_to_prove: ApiScoreStat,
    #[serde(rename = "statToProve2")]
    pub stat_to_prove_2: Option<ApiScoreStat>,
    #[serde(rename = "eventStatRoot")]
    pub event_stat_root: [u8; 32],
    #[serde(rename = "statProof")]
    pub stat_proof: Vec<ApiProofNode>,
    #[serde(rename = "statProof2")]
    pub stat_proof_2: Option<Vec<ApiProofNode>>,
    pub ts: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct OddsValidationResponse {
    pub odds: Odds,
    pub summary: OddsBatchSummary,
    #[serde(alias = "subTreeProof", alias = "sub_tree_proof")]
    pub sub_tree_proof: Vec<ProofNode>,
    #[serde(alias = "mainTreeProof", alias = "main_tree_proof")]
    pub main_tree_proof: Vec<ProofNode>,
}

pub struct TxOddsClient {
    client: reqwest::Client,
    base_url: String,
    lookback_hours: i64,
}

impl TxOddsClient {
    pub fn new(config: &Config) -> Result<Self> {
        let base_url = std::env::var("TXODDS_API_URL")
            .unwrap_or_else(|_| "https://txline-dev.txodds.com".to_string());
        
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            "X-Api-Token",
            reqwest::header::HeaderValue::from_str(&config.txodds_api_key)?,
        );
        headers.insert(
            "Authorization",
            reqwest::header::HeaderValue::from_str(&format!("Bearer {}", config.txodds_bearer_token))?,
        );

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .context("Failed to create reqwest client")?;

        let lookback_hours = config.fixtures_lookback_hours;

        Ok(Self { client, base_url, lookback_hours })
    }

    /// 3.1 Market Discovery API
    pub async fn get_markets(&self) -> Result<Vec<TxOddsItem>> {
        let now = chrono::Utc::now().timestamp_millis();
        let start_epoch_day = (now - self.lookback_hours * 3600 * 1000) / 86400000;

        let url = format!("{}/api/fixtures/snapshot", self.base_url);
        info!("Fetching fixtures from {} with startEpochDay={}", url, start_epoch_day);

        let fixtures_res = self.client
            .get(&url)
            .query(&[("startEpochDay", &start_epoch_day.to_string())])
            .send()
            .await?;

        if !fixtures_res.status().is_success() {
            let status = fixtures_res.status();
            let body = fixtures_res.text().await.unwrap_or_default();
            warn!("Failed to fetch fixtures: status={}, body={}", status, body);
            return Ok(Vec::new());
        }

        let all_fixtures: Vec<RawFixture> = fixtures_res.json().await?;

        // Filter unique fixtures where StartTime > now and competition is World Cup (CompetitionId 72)
        let mut unique_fixtures = std::collections::HashMap::new();
        for f in all_fixtures {
            let is_world_cup = f.competition_id == Some(72) || f.competition.as_ref().map(|c| c.contains("World Cup")).unwrap_or(false);
            if !is_world_cup {
                continue;
            }

            let start_time_ms = match &f.start_time {
                Value::Number(n) => n.as_i64().unwrap_or(0),
                Value::String(s) => s.parse::<i64>().unwrap_or(0),
                _ => 0,
            };
            if start_time_ms > now - (self.lookback_hours * 3600 * 1000) {
                unique_fixtures.insert(f.fixture_id, (f, start_time_ms));
            }
        }

        let mut options = Vec::new();

        for (fixture_id, (f, start_time_ms)) in unique_fixtures {
            let odds_url = format!("{}/api/odds/snapshot/{}", self.base_url, fixture_id);
            let odds_res = self.client
                .get(&odds_url)
                .query(&[("asOf", &start_time_ms.to_string())])
                .send()
                .await;

            let odds_markets: Vec<RawOddsMarket> = match odds_res {
                Ok(resp) if resp.status().is_success() => {
                    resp.json().await.unwrap_or_default()
                }
                _ => continue,
            };

            let mut seen = std::collections::HashSet::new();

            for market in odds_markets {
                if market.bookmaker_id != 10021 {
                    continue;
                }

                let message_id = market.message_id.clone().unwrap_or_default();
                let ts = market.ts.unwrap_or(0);

                let price_names = match market.price_names {
                    Some(ref pn) => pn,
                    None => continue,
                };
                let prices = match market.prices {
                    Some(ref pr) => pr,
                    None => continue,
                };

                let period = market.market_period.as_deref().unwrap_or("ft");
                let is_first_half = period == "half=1";
                let is_second_half = period == "half=2";

                for j in 0..price_names.len() {
                    if j >= prices.len() {
                        break;
                    }

                    let raw_odds = prices[j];
                    let outcome = &price_names[j];
                    let parameters = market.market_parameters.as_deref().unwrap_or("");

                    let key = format!("{}|{}|{}|{}", market.super_odds_type, outcome, parameters, period);
                    if seen.contains(&key) {
                        continue;
                    }
                    seen.insert(key.clone());

                    let id = format!("{}-{}-{}-{}-{}", fixture_id, market.super_odds_type, parameters, outcome, period);

                    options.push(TxOddsItem {
                        id,
                        message_id: message_id.clone(),
                        ts,
                        outcome_index: j as u8,
                        fixture_id,
                        participant1: f.participant_1.clone(),
                        participant2: f.participant_2.clone(),
                        odds: (raw_odds as f64) / 1000.0,
                        raw_odds,
                        outcome: outcome.clone(),
                        market_type: market.super_odds_type.clone(),
                        market_parameters: market.market_parameters.clone(),
                        market_period: market.market_period.clone(),
                        kickoff: start_time_ms / 1000,
                        period: if is_first_half { 1000 } else if is_second_half { 3000 } else { 0 },
                        bookmaker_id: market.bookmaker_id,
                    });
                }
            }
        }

        Ok(options)
    }

    /// 3.3 Fetch score snapshots
    pub async fn get_scores_snapshots(&self, fixture_id: i64) -> Result<Vec<ScoreSnapshot>> {
        let url = format!("{}/api/scores/snapshot/{}", self.base_url, fixture_id);
        info!("Fetching score snapshots from {}", url);
        let snapshots: Vec<ScoreSnapshot> = self.client
            .get(&url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(snapshots)
    }

    /// 3.3 Fetch score validation proof
    pub async fn get_score_validation(
        &self,
        fixture_id: i64,
        seq: u64,
        stat_key: u32,
    ) -> Result<StatValidationResponse> {
        let url = format!(
            "{}/api/scores/stat-validation?fixtureId={}&seq={}&statKey={}",
            self.base_url, fixture_id, seq, stat_key
        );
        info!("Fetching score validation proof from {}", url);
        let resp: StatValidationResponse = self.client
            .get(&url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(resp)
    }

    /// Fetch odds validation proof/merkle proof
    pub async fn get_odds_validation(
        &self,
        message_id: &str,
        ts: i64,
    ) -> Result<OddsValidationResponse> {
        let url = format!("{}/api/odds/validation", self.base_url);
        info!("Fetching odds validation proof from {} for messageId={}", url, message_id);
        let resp: OddsValidationResponse = self.client
            .get(&url)
            .query(&[("messageId", message_id), ("ts", &ts.to_string())])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(resp)
    }
}

/// Strip param prefix (line=1.5 -> float 1.5 -> ceiling predicate threshold 2)
#[allow(dead_code)]
pub fn parse_threshold(param: &str) -> Option<i32> {
    let line_str = param.strip_prefix("line=").unwrap_or(param);
    let val: f32 = line_str.parse().ok()?;
    Some(val.ceil() as i32)
}

#[derive(Deserialize, Debug, Clone)]
pub struct RawFixture {
    #[serde(rename = "FixtureId")]
    pub fixture_id: i64,
    #[serde(rename = "StartTime")]
    pub start_time: Value,
    #[serde(rename = "Participant1")]
    pub participant_1: String,
    #[serde(rename = "Participant2")]
    pub participant_2: String,
    #[serde(rename = "Competition")]
    pub competition: Option<String>,
    #[serde(rename = "CompetitionId")]
    pub competition_id: Option<i64>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct RawOddsMarket {
    #[serde(rename = "BookmakerId")]
    pub bookmaker_id: i32,
    #[serde(rename = "MessageId")]
    pub message_id: Option<String>,
    #[serde(rename = "Ts")]
    pub ts: Option<i64>,
    #[serde(rename = "SuperOddsType")]
    pub super_odds_type: String,
    #[serde(rename = "PriceNames")]
    pub price_names: Option<Vec<String>>,
    #[serde(rename = "Prices")]
    pub prices: Option<Vec<i32>>,
    #[serde(rename = "MarketParameters")]
    pub market_parameters: Option<String>,
    #[serde(rename = "MarketPeriod")]
    pub market_period: Option<String>,
}
