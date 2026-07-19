use crate::api::{ScoreSnapshot, TxOddsClient, TxOddsItem};
use crate::config::Config;
use crate::solana::{
    BatchStatus, BetTerms, ProofNode, RoundStatus, ScoreStat, ScoresBatchSummary,
    ScoresUpdateStats, SolanaClient, StatTerm,
};
use crate::state::{BatchMetadata, RedisState};
use anyhow::{anyhow, Context, Result};
use tracing::{error, info, warn};

pub struct BatchProcessor {
    config: Config,
    solana: SolanaClient,
    txodds: TxOddsClient,
    redis: RedisState,
}

impl BatchProcessor {
    pub fn new(
        config: Config,
        solana: SolanaClient,
        txodds: TxOddsClient,
        redis: RedisState,
    ) -> Self {
        Self {
            config,
            solana,
            txodds,
            redis,
        }
    }

    /// Entry point for a tick cycle: processes all active/non-final batches
    pub async fn tick(&self) -> Result<()> {
        info!("Starting tick cycle...");

        // Fetch the protocol config to see the next batch ID
        let config_state = match self.solana.fetch_protocol_config().await {
            Ok(c) => c,
            Err(e) => {
                error!("Failed to fetch protocol config: {:?}", e);
                return Err(e);
            }
        };

        let next_batch_id = config_state.next_batch_id;
        info!("On-chain next_batch_id: {}", next_batch_id);

        if next_batch_id == 0 {
            info!("No batches exist. Initializing batch ID 0");
            match self
                .solana
                .initialize_batch(self.config.batch_apy_bps)
                .await
            {
                Ok(sig) => info!("Initialized batch ID 0: sig={}", sig),
                Err(e) => error!("Failed to initialize batch ID 0: {:?}", e),
            }
            return Ok(());
        }

        for batch_id in 1..next_batch_id {
            let batch = match self.solana.fetch_batch(batch_id).await {
                Ok(b) => b,
                Err(e) => {
                    warn!("Failed to fetch batch account {}: {:?}", batch_id, e);
                    continue;
                }
            };

            // Skip final states
            if batch.status == BatchStatus::Settled || batch.status == BatchStatus::Cancelled {
                continue;
            }

            // Try to acquire distributed lock
            let lock_acquired = match self.redis.acquire_lock(batch_id, 25).await {
                Ok(acquired) => acquired,
                Err(e) => {
                    warn!(
                        "Failed to interact with Redis for lock on batch {}: {:?}",
                        batch_id, e
                    );
                    false
                }
            };

            if !lock_acquired {
                info!(
                    "Lock for batch {} is held by another process or tick interval is active.",
                    batch_id
                );
                continue;
            }

            info!("Processing batch {} in status {:?}", batch_id, batch.status);

            let res = self.process_batch(batch_id, batch).await;
            if let Err(e) = res {
                error!("Error processing batch {}: {:?}", batch_id, e);
            }

            // Release lock
            if let Err(e) = self.redis.release_lock(batch_id).await {
                warn!("Failed to release lock for batch {}: {:?}", batch_id, e);
            }
        }

        // Check if we should initialize a new batch (e.g. if the latest batch is started/locked/settled)
        let latest_id = next_batch_id - 1;
        if let Ok(latest_batch) = self.solana.fetch_batch(latest_id).await {
            if latest_batch.status != BatchStatus::Lobby {
                // Count non-settled batches
                let mut active_batches_count = 0;
                let mut consecutive_final = 0;
                for id in (0..next_batch_id).rev() {
                    match self.solana.fetch_batch(id).await {
                        Ok(b) => {
                            if b.status != BatchStatus::Settled
                                && b.status != BatchStatus::Cancelled
                            {
                                active_batches_count += 1;
                                consecutive_final = 0;
                            } else {
                                consecutive_final += 1;
                                if consecutive_final >= 5 {
                                    break;
                                }
                            }
                        }
                        Err(_) => break,
                    }
                }

                if active_batches_count < self.config.max_active_batches {
                    info!("Latest batch {} is in {:?} state and active non-settled batches = {}. Initializing next batch {}", latest_id, latest_batch.status, active_batches_count, next_batch_id);
                    match self
                        .solana
                        .initialize_batch(self.config.batch_apy_bps)
                        .await
                    {
                        Ok(sig) => info!("Initialized next batch {}: sig={}", next_batch_id, sig),
                        Err(e) => {
                            error!("Failed to initialize next batch {}: {:?}", next_batch_id, e)
                        }
                    }
                } else {
                    info!("Latest batch {} is in {:?} state, but active non-settled batches = {} (>= {} limit). Skipping next batch initialization.", latest_id, latest_batch.status, active_batches_count, self.config.max_active_batches);
                }
            }
        }

        // Lottery lifecycle: initialize / start round / draw as needed
        if let Err(e) = self.process_lottery().await {
            error!("Error during lottery processing: {:?}", e);
        }

        Ok(())
    }

    /// Entry point for the lottery lifecycle. Acquires a distributed lock so only one
    /// operator instance drives the lottery at a time, then delegates to `process_lottery_inner`.
    async fn process_lottery(&self) -> Result<()> {
        let lock_acquired = match self.redis.acquire_lottery_lock(25).await {
            Ok(acquired) => acquired,
            Err(e) => {
                warn!("Failed to interact with Redis for lottery lock: {:?}", e);
                false
            }
        };

        if !lock_acquired {
            info!("Lottery lock is held by another process or tick interval is active.");
            return Ok(());
        }

        let result = self.process_lottery_inner().await;

        if let Err(e) = self.redis.release_lottery_lock().await {
            warn!("Failed to release lottery lock: {:?}", e);
        }

        result
    }

    /// Drives the lottery lifecycle: initialize the lottery if it doesn't exist yet,
    /// start a new round if none is currently open, or draw the winner once the
    /// current round's entry period has elapsed.
    async fn process_lottery_inner(&self) -> Result<()> {
        let lottery_config = match self.solana.fetch_lottery_config().await {
            Ok(c) => c,
            Err(e) => {
                info!("Lottery config not found: {:?}. Initializing lottery...", e);
                match self.solana.initialize_lottery().await {
                    Ok(sig) => info!("Lottery initialized: sig={}", sig),
                    Err(e) => error!("Failed to initialize lottery: {:?}", e),
                }
                return Ok(());
            }
        };

        let current_round_id = lottery_config.current_round_id;

        // No round has ever been started yet -> start round 1 (the on-chain program
        // derives the new round's seeds from current_round_id + 1, so round IDs are 1-indexed)
        if current_round_id == 0 {
            info!("No lottery round has been started yet. Starting round 1...");
            match self.solana.start_round(1).await {
                Ok(sig) => info!("Started lottery round 1: sig={}", sig),
                Err(e) => error!("Failed to start lottery round 1: {:?}", e),
            }
            return Ok(());
        }

        let latest_round_id = current_round_id;
        let round = match self.solana.fetch_round(latest_round_id).await {
            Ok(r) => r,
            Err(e) => {
                warn!("Failed to fetch lottery round {}: {:?}", latest_round_id, e);
                return Ok(());
            }
        };

        match round.status {
            RoundStatus::Open => {
                // Track round start time in Redis (no deadline field on-chain), same pattern as batch lobbies
                let mut conn = self.redis.get_conn().await?;
                let started_key = format!("lottery:round:{}:started_at", latest_round_id);
                let now = chrono::Utc::now().timestamp();
                let started_at: Option<i64> = redis::cmd("GET")
                    .arg(&started_key)
                    .query_async(&mut conn)
                    .await
                    .ok();

                let should_draw = match started_at {
                    Some(ts) => now >= ts + self.config.lottery_round_duration_secs as i64,
                    None => {
                        let _: () = redis::cmd("SET")
                            .arg(&started_key)
                            .arg(now)
                            .arg("EX")
                            .arg(86400 * 30)
                            .query_async(&mut conn)
                            .await?;
                        false
                    }
                };

                if should_draw {
                    info!(
                        "Lottery round {} entry period elapsed. Drawing winner...",
                        latest_round_id
                    );
                    match self.solana.draw_winner(latest_round_id).await {
                        Ok(sig) => info!(
                            "Drew winner for lottery round {}: sig={}",
                            latest_round_id, sig
                        ),
                        Err(e) => error!(
                            "Failed to draw winner for lottery round {}: {:?}",
                            latest_round_id, e
                        ),
                    }
                } else {
                    info!(
                        "Lottery round {} is Open. Awaiting draw deadline.",
                        latest_round_id
                    );
                }
            }
            RoundStatus::Drawn | RoundStatus::Settled => {
                let new_round_id = current_round_id + 1;
                info!(
                    "Lottery round {} is {:?}. Starting new round {}...",
                    latest_round_id, round.status, new_round_id
                );
                match self.solana.start_round(new_round_id).await {
                    Ok(sig) => info!("Started lottery round {}: sig={}", new_round_id, sig),
                    Err(e) => {
                        error!("Failed to start lottery round {}: {:?}", new_round_id, e)
                    }
                }
            }
        }

        Ok(())
    }

    /// Process a single batch based on its status
    async fn process_batch(&self, batch_id: u64, batch: crate::solana::Batch) -> Result<()> {
        match batch.status {
            BatchStatus::Lobby => {
                // Lobby: If creation deadline passed -> call start_batch
                let now = chrono::Utc::now().timestamp();
                let lobby_duration = self.config.lobby_duration_secs as i64;

                // We track lobby creation time using a Redis key
                let mut conn = self.redis.get_conn().await?;

                let created_at_key = format!("undegen:batch:{}:created_at", batch_id);
                let created_at: Option<i64> = redis::cmd("GET")
                    .arg(&created_at_key)
                    .query_async(&mut conn)
                    .await
                    .ok();

                let should_start = match created_at {
                    Some(ts) => now >= ts + lobby_duration,
                    None => {
                        // Store current time as creation time
                        let _: () = redis::cmd("SET")
                            .arg(&created_at_key)
                            .arg(now)
                            .arg("EX")
                            .arg(86400 * 7)
                            .query_async(&mut conn)
                            .await?;
                        false
                    }
                };

                if should_start {
                    // Guard: minimum user count must be met before starting
                    let user_count = match self.solana.count_batch_users(batch_id).await {
                        Ok(c) => c,
                        Err(e) => {
                            warn!(
                                "Could not count users for batch {}: {:?}. Skipping start.",
                                batch_id, e
                            );
                            return Ok(());
                        }
                    };
                    if user_count < self.config.min_batch_users {
                        info!(
                            "Batch {} lobby deadline passed but only {} user(s) joined (min {}). Waiting for more users.",
                            batch_id, user_count, self.config.min_batch_users
                        );
                        return Ok(());
                    }

                    info!(
                        "Lobby creation deadline passed for batch {} with {} user(s). Starting batch...",
                        batch_id, user_count
                    );
                    let sig = self.solana.start_batch(batch_id).await?;
                    info!("Batch {} started: sig={}", batch_id, sig);

                    // Propose match immediately after starting the batch
                    self.propose_match_for_batch(batch_id).await?;
                } else {
                    info!(
                        "Batch {} is in Lobby. Waiting for creation deadline.",
                        batch_id
                    );
                }
            }
            BatchStatus::Locked => {
                // Locked: If kickoff_timestamp is 0, we must propose a match first!
                if batch.kickoff_timestamp == 0 {
                    info!(
                        "Batch {} is Locked but kickoff_timestamp is 0. Proposing match...",
                        batch_id
                    );
                    self.propose_match_for_batch(batch_id).await?;
                    return Ok(());
                }

                let now = chrono::Utc::now().timestamp();
                let voting_deadline = batch.kickoff_timestamp - 3600;

                info!(
                    "Batch {} voting deadline is at {} (now is {})",
                    batch_id, voting_deadline, now
                );
                if now >= voting_deadline {
                    info!(
                        "Voting deadline passed for batch {}. Finalizing consensus...",
                        batch_id
                    );
                    let sig = self.solana.finalize_consensus(batch_id).await?;
                    info!("Consensus finalized for batch {}: sig={}", batch_id, sig);
                } else {
                    info!(
                        "Batch {} is Locked (voting phase). Awaiting voting deadline.",
                        batch_id
                    );
                }
            }
            BatchStatus::AwaitingCollateral => {
                // AwaitingCollateral: If no collateral deposited -> call deposit_collateral
                if batch.collateral_deposited == 0 {
                    info!(
                        "No collateral deposited for batch {}. Initiating deposit...",
                        batch_id
                    );

                    // Fetch metadata from Redis to get odds for the single proposed bet (slot 0)
                    let metadata = self.redis.get_metadata(batch_id).await?.ok_or_else(|| {
                        anyhow!("Redis metadata not found for batch {}", batch_id)
                    })?;

                    // Deserialize slots mapping to get raw_odds from slot "0"
                    let slots_mapping: std::collections::HashMap<String, serde_json::Value> =
                        serde_json::from_value(metadata.slots_mapping.clone())
                            .context("Failed to deserialize slots mapping from Redis")?;

                    // Get winning vote index (slot 0 is always the proposed bet, index 4 is skip)
                    let winning_vote_index = batch.winning_vote_index.unwrap_or(0) as usize;

                    // Resolve the slot info to fetch Merkle proof validation from txodds
                    let slot_id = if winning_vote_index < 4 { winning_vote_index } else { 0 };
                    let slot_val = slots_mapping.get(&slot_id.to_string()).ok_or_else(|| {
                        anyhow!("Slot {} not found in slots_mapping for batch {}", slot_id, batch_id)
                    })?;

                    let message_id = slot_val
                        .get("messageId")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| anyhow!("messageId not found in slot metadata"))?;

                    let ts = slot_val
                        .get("ts")
                        .and_then(|v| v.as_i64())
                        .ok_or_else(|| anyhow!("ts not found in slot metadata"))?;

                    let oracle_price_index = slot_val
                        .get("outcomeIndex")
                        .and_then(|v| v.as_u64())
                        .map(|v| v as u8)
                        .ok_or_else(|| anyhow!("outcomeIndex not found in slot metadata"))?;

                    // Fetch the Merkle validation proof from txodds client first
                    let validation = self.txodds.get_odds_validation(message_id, ts).await?;

                    let bet_size = batch.bet_size;
                    let amount = if winning_vote_index == 4 {
                        // Skip bet: amount of collateral should be exactly the bet size
                        bet_size
                    } else {
                        // raw_odds is retrieved from validation.odds.prices using oracle_price_index
                        let raw_odds = validation
                            .odds
                            .prices
                            .get(oracle_price_index as usize)
                            .copied()
                            .ok_or_else(|| {
                                anyhow!(
                                    "outcomeIndex {} out of bounds for prices in odds validation for batch {}",
                                    oracle_price_index,
                                    batch_id
                                )
                            })?;

                        // amount = bet_size * raw_odds / 1000  (raw_odds is in thousandths, e.g. 2100 = 2.1x)
                        (bet_size as u128 * raw_odds as u128 / 1000) as u64
                    };

                    info!(
                        "Batch {} deposit: winning_vote_index={} bet_size={} amount={} slot_id={} message_id={} ts={} oracle_price_index={}",
                        batch_id, winning_vote_index, bet_size, amount, slot_id, message_id, ts, oracle_price_index
                    );

                    let sig = self.solana.deposit_collateral(
                        batch_id,
                        amount,
                        oracle_price_index,
                        validation.odds,
                        validation.summary,
                        validation.sub_tree_proof,
                        validation.main_tree_proof,
                    ).await?;

                    info!("Collateral deposited for batch {}: sig={}", batch_id, sig);
                } else {
                    info!("Collateral already deposited for batch {}.", batch_id);
                }
            }
            BatchStatus::Active => {
                // Active: If match finished (score proof available) -> call settle_with_proof
                let metadata =
                    self.redis.get_metadata(batch_id).await?.ok_or_else(|| {
                        anyhow!("Redis metadata not found for batch {}", batch_id)
                    })?;

                info!(
                    "Checking match status for active batch {} (fixtureId={})",
                    batch_id, metadata.fixture_id
                );

                // Get snapshots
                let snapshots = match self.txodds.get_scores_snapshots(metadata.fixture_id).await {
                    Ok(s) => s,
                    Err(e) => {
                        warn!(
                            "Failed to fetch snapshots for fixture {}: {:?}",
                            metadata.fixture_id, e
                        );
                        return Ok(());
                    }
                };

                let winning_vote_index = batch.winning_vote_index.ok_or_else(|| {
                    anyhow!("Winning vote index not set for active batch {}", batch_id)
                })?;

                if winning_vote_index as usize >= batch.bet_terms.len() {
                    return Err(anyhow!(
                        "Invalid winning vote index {} (out of bounds for bet_terms array)",
                        winning_vote_index
                    ));
                }

                let bet_term = &batch.bet_terms[winning_vote_index as usize];

                // Two-Step Score Validation Strategy to resolve sequence number
                if let Some(resolved_seq) = resolve_sequence_number(&snapshots, bet_term.period) {
                    info!(
                        "Match finished for batch {} with resolved seq {}.",
                        batch_id, resolved_seq
                    );

                    // Fetch score validation proof
                    let proof_resp = self
                        .txodds
                        .get_score_validation(
                            metadata.fixture_id,
                            resolved_seq,
                            bet_term.stat_a_key,
                        )
                        .await?;

                    // Convert structures
                    let fixture_summary = map_scores_summary(&proof_resp.summary);
                    let main_tree_proof = map_proof_nodes(&proof_resp.main_tree_proof);
                    let fixture_proof = map_proof_nodes(&proof_resp.sub_tree_proof);

                    let stat_a = StatTerm {
                        stat_to_prove: map_score_stat(&proof_resp.stat_to_prove),
                        event_stat_root: proof_resp.event_stat_root,
                        stat_proof: map_proof_nodes(&proof_resp.stat_proof),
                    };

                    let stat_b = match proof_resp.stat_to_prove_2 {
                        Some(ref s2) => {
                            let sp2 = proof_resp
                                .stat_proof_2
                                .as_ref()
                                .map(|p| map_proof_nodes(p))
                                .unwrap_or_default();
                            Some(StatTerm {
                                stat_to_prove: map_score_stat(s2),
                                event_stat_root: proof_resp.event_stat_root,
                                stat_proof: sp2,
                            })
                        }
                        None => None,
                    };

                    let sig = self
                        .solana
                        .settle_with_proof(
                            batch_id,
                            fixture_summary,
                            main_tree_proof,
                            fixture_proof,
                            stat_a,
                            stat_b,
                            proof_resp.ts,
                        )
                        .await?;

                    info!("Settle with proof transaction confirmed: sig={}", sig);
                } else {
                    info!("Match not finished yet for batch {} (fixtureId={}). Awaiting finalised state.", batch_id, metadata.fixture_id);
                }
            }
            BatchStatus::Settled => {
                // Settled: Call claim_operator_yield if not claimed
                let mut conn = self.redis.get_conn().await?;

                let claimed_key = format!("undegen:batch:{}:yield_claimed", batch_id);
                let already_claimed: Option<String> = redis::cmd("GET")
                    .arg(&claimed_key)
                    .query_async(&mut conn)
                    .await
                    .ok();

                if already_claimed.is_none() {
                    info!("Claiming operator yield for settled batch {}...", batch_id);
                    match self.solana.claim_operator_yield(batch_id).await {
                        Ok(sig) => {
                            info!("Operator yield claimed for batch {}: sig={}", batch_id, sig);
                            let _: () = redis::cmd("SET")
                                .arg(&claimed_key)
                                .arg("true")
                                .query_async(&mut conn)
                                .await?;
                        }
                        Err(e) => {
                            error!(
                                "Failed to claim operator yield for batch {}: {:?}",
                                batch_id, e
                            );
                        }
                    }
                } else {
                    info!("Operator yield already claimed for batch {}.", batch_id);
                }
            }
            BatchStatus::Cancelled => {
                info!("Batch {} is Cancelled. No actions needed.", batch_id);
            }
        }

        Ok(())
    }

    /// Proposes matches for batch
    async fn propose_match_for_batch(&self, batch_id: u64) -> Result<()> {
        info!("Discovering markets for batch proposal...");

        let all_markets = self.txodds.get_markets().await?;

        // Filter and map
        let mut candidates = Vec::new();
        for item in all_markets {
            if item.bookmaker_id != 10021 {
                continue;
            }

            let period_prefix = item.period;
            let stat_key_1 = period_prefix as u32 + 1;
            let stat_key_2 = period_prefix as u32 + 2;

            if item.market_type == "1X2_PARTICIPANT_RESULT" {
                let outcome = item.outcome.to_lowercase();
                let comparison = if outcome == "part1" || outcome == "1" {
                    0 // GreaterThan
                } else if outcome == "part2" || outcome == "2" {
                    1 // LessThan
                } else if outcome == "draw" || outcome == "x" {
                    2 // EqualTo
                } else {
                    continue;
                };

                let bet_term = BetTerms {
                    fixture_id: item.fixture_id,
                    period: period_prefix,
                    stat_a_key: stat_key_1,
                    stat_b_key: Some(stat_key_2),
                    op: Some(crate::solana::BinaryOp::Subtract),
                    predicate_threshold: 0,
                    predicate_comparison: comparison,
                    negation: false,
                };
                candidates.push((item, bet_term));
            } else if item.market_type == "OVERUNDER_PARTICIPANT_GOALS" {
                let raw_line = match &item.market_parameters {
                    Some(param) => {
                        let line_str = param.strip_prefix("line=").unwrap_or(param);
                        line_str.parse::<f32>().unwrap_or(2.5)
                    }
                    None => 2.5,
                };

                if raw_line % 0.5 != 0.0 {
                    continue;
                }

                let outcome = item.outcome.to_lowercase();
                let is_over = outcome == "over";
                let comparison = if is_over { 0 } else { 1 };
                let threshold = if is_over { raw_line.floor() as i32 } else { raw_line.ceil() as i32 };

                let bet_term = BetTerms {
                    fixture_id: item.fixture_id,
                    period: period_prefix,
                    stat_a_key: stat_key_1,
                    stat_b_key: Some(stat_key_2),
                    op: Some(crate::solana::BinaryOp::Add),
                    predicate_threshold: threshold,
                    predicate_comparison: comparison,
                    negation: false,
                };
                candidates.push((item, bet_term));
            }
        }

        // Apply lookback and kickoff windows
        let now_secs = chrono::Utc::now().timestamp();
        let max_secs = now_secs + 7 * 86400;
        let lookback_secs = self.config.fixtures_lookback_hours * 3600;

        candidates.retain(|(item, _)| {
            item.kickoff >= now_secs - lookback_secs && item.kickoff <= max_secs
        });

        if candidates.is_empty() {
            return Err(anyhow!(
                "No valid markets found to propose for batch {}",
                batch_id
            ));
        }

        // Group options by fixture_id
        let mut fixture_groups: std::collections::HashMap<i64, Vec<(TxOddsItem, BetTerms)>> = std::collections::HashMap::new();
        for (item, bet) in candidates {
            fixture_groups.entry(item.fixture_id).or_default().push((item, bet));
        }

        // Sort fixtures by kickoff time ascending
        let mut sorted_fixtures: Vec<(i64, Vec<(TxOddsItem, BetTerms)>)> = fixture_groups.into_iter().collect();
        sorted_fixtures.sort_by_key(|(_, list)| list[0].0.kickoff);

        // Remove the earliest fixture
        let (fixture_id, mut options) = sorted_fixtures.remove(0);

        // Sort the candidate outcomes for this earliest fixture by raw_odds descending
        options.sort_by(|a, b| b.0.raw_odds.cmp(&a.0.raw_odds));

        // Select up to 4 outcomes
        let select_count = options.len().min(4);
        let selected: Vec<(TxOddsItem, BetTerms)> = options.drain(..select_count).collect();

        // Build padded [BetTerms; 4]
        let mut bet_terms_array: [BetTerms; 4] = core::array::from_fn(|_| BetTerms::default());
        for (i, (_, bet)) in selected.iter().enumerate() {
            bet_terms_array[i] = bet.clone();
        }

        let kickoff_timestamp = selected[0].0.kickoff;

        // Check if Redis metadata already exists for this batch and the match (fixture ID and message IDs) is exact same
        if let Some(existing_meta) = self.redis.get_metadata(batch_id).await? {
            let mut proposed_options_map = serde_json::Map::new();
            for (i, (item, _)) in selected.iter().enumerate() {
                let msg_id = if !item.message_id.is_empty() {
                    item.message_id.clone()
                } else {
                    item.id.clone()
                };
                proposed_options_map.insert(i.to_string(), serde_json::json!(msg_id));
            }

            if existing_meta.fixture_id == fixture_id
                && existing_meta.options_mapping == serde_json::Value::Object(proposed_options_map)
            {
                info!(
                    "Match for batch {} is exact same as existing Redis metadata (fixture {} and message IDs). Skipping proposal.",
                    batch_id, fixture_id
                );
                return Ok(());
            }
        }

        info!(
            "Selected earliest fixture {} with {} outcome(s). Proposing to batch {}",
            fixture_id,
            selected.len(),
            batch_id
        );

        let sig = self
            .solana
            .propose_match(batch_id, &bet_terms_array, kickoff_timestamp)
            .await?;
        info!(
            "Proposed matches for batch {} on Solana: sig={}",
            batch_id, sig
        );

        // Store metadata in Redis Namespace: undegen:batch:{batchId}
        let mut slots_map = serde_json::Map::new();
        let mut timestamps_map = serde_json::Map::new();
        let mut options_map = serde_json::Map::new();

        for (i, (item, _)) in selected.iter().enumerate() {
            let outcome_idx = get_outcome_index(&item.outcome);
            let msg_id = if !item.message_id.is_empty() {
                item.message_id.clone()
            } else {
                item.id.clone()
            };
            let ts_ms = item.ts;

            slots_map.insert(
                i.to_string(),
                serde_json::json!({
                    "messageId": msg_id,
                    "ts": ts_ms,
                    "outcomeIndex": outcome_idx,
                }),
            );
            timestamps_map.insert(i.to_string(), serde_json::json!(ts_ms));
            options_map.insert(i.to_string(), serde_json::json!(msg_id));
        }

        let metadata = BatchMetadata {
            fixture_id,
            options_mapping: serde_json::Value::Object(options_map),
            slots_mapping: serde_json::Value::Object(slots_map),
            timestamps: serde_json::Value::Object(timestamps_map),
        };

        self.redis.store_metadata(batch_id, &metadata).await?;
        info!("Stored metadata for batch {} in Redis", batch_id);

        Ok(())
    }
}

// Helpers to map API structures to Solana Structs

fn map_proof_node(node: &crate::api::ApiProofNode) -> ProofNode {
    ProofNode {
        hash: node.hash,
        is_right_sibling: node.is_right_sibling,
    }
}

fn map_proof_nodes(nodes: &[crate::api::ApiProofNode]) -> Vec<ProofNode> {
    nodes.iter().map(map_proof_node).collect()
}

fn map_scores_summary(summary: &crate::api::ApiScoresBatchSummary) -> ScoresBatchSummary {
    ScoresBatchSummary {
        fixture_id: summary.fixture_id,
        update_stats: ScoresUpdateStats {
            update_count: summary.update_stats.update_count,
            min_timestamp: summary.update_stats.min_timestamp,
            max_timestamp: summary.update_stats.max_timestamp,
        },
        events_sub_tree_root: summary.event_stats_sub_tree_root,
    }
}

fn map_score_stat(stat: &crate::api::ApiScoreStat) -> ScoreStat {
    ScoreStat {
        key: stat.key,
        value: stat.value,
        period: stat.period,
    }
}

fn get_outcome_index(outcome: &str) -> u8 {
    match outcome.to_lowercase().as_str() {
        "over" | "part1" => 0,
        "under" | "part2" => 1,
        "draw" => 2,
        _ => 0,
    }
}

fn has_match_state(snapshot: &ScoreSnapshot, state_name: &str) -> bool {
    // 1. Check direct properties
    for key in &["Action", "action", "status", "Status", "match_state", "MatchState"] {
        if let Some(val) = snapshot.raw.get(*key) {
            if let Some(s) = val.as_str() {
                if s == state_name {
                    return true;
                }
            }
        }
    }
    
    if let Some(ref gs) = snapshot.game_state {
        if gs == state_name {
            return true;
        }
    }

    // 2. Check inside game events arrays
    for events_key in &["events", "Events", "game_events", "GameEvents"] {
        if let Some(val) = snapshot.raw.get(*events_key) {
            if let Some(arr) = val.as_array() {
                for e in arr {
                    if let Some(obj) = e.as_object() {
                        for key in &["type", "Type", "code", "Code", "event", "Event", "action", "Action"] {
                            if let Some(ev_val) = obj.get(*key) {
                                if let Some(s) = ev_val.as_str() {
                                    if s == state_name {
                                        return true;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    false
}

/// Helper function to resolve sequence number from snapshots list based on Period
pub fn resolve_sequence_number(snapshots: &[ScoreSnapshot], period: u16) -> Option<u64> {
    if period == 0 {
        // Full Time: Scan for game_finalised
        snapshots
            .iter()
            .find(|s| has_match_state(s, "game_finalised"))
            .map(|s| s.seq)
    } else if period == 1000 {
        // 1st Half: Scan for halftime_finalised. If missing, iterate backward through the snapshots array
        // to find the point where Score.Participant1.HT is present but Score.Participant1.H2 is completely absent
        if let Some(s) = snapshots
            .iter()
            .find(|s| has_match_state(s, "halftime_finalised"))
        {
            return Some(s.seq);
        }
        // Fallback: iterate backward
        for s in snapshots.iter().rev() {
            if let Some(ref score) = s.score {
                if let Some(ref p1) = score.participant1 {
                    if p1.ht.is_some() && p1.h2.is_none() {
                        return Some(s.seq);
                    }
                }
            }
        }
        None
    } else {
        None
    }
}
