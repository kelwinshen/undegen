use anyhow::{anyhow, Context, Result};
use anchor_lang::prelude::*;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::Keypair,
    signer::Signer,
    transaction::Transaction,
};
use tracing::{info, error, warn};
use std::sync::Arc;

use solana_sdk::instruction::InstructionError;
use solana_sdk::transaction::TransactionError;
use solana_client::rpc_request::{RpcError, RpcResponseErrorData};

// Enums and Structs matching Anchor IDL

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum BatchStatus {
    Lobby,
    Locked,
    AwaitingCollateral,
    Active,
    Settled,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum BinaryOp {
    Add,
    Subtract,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, serde::Serialize, serde::Deserialize, Default)]
pub struct BetTerms {
    pub fixture_id: i64,
    pub period: u16,
    pub stat_a_key: u32,
    pub stat_b_key: Option<u32>,
    pub op: Option<BinaryOp>,
    pub predicate_threshold: i32,
    pub predicate_comparison: u8,
    pub negation: bool,
}



#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ProofNode {
    pub hash: [u8; 32],
    #[serde(alias = "isRightSibling", alias = "is_right_sibling")]
    pub is_right_sibling: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ScoresUpdateStats {
    pub update_count: i32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ScoresBatchSummary {
    pub fixture_id: i64,
    pub update_stats: ScoresUpdateStats,
    pub events_sub_tree_root: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Odds {
    #[serde(alias = "FixtureId", alias = "fixtureId")]
    pub fixture_id: i64,
    #[serde(alias = "MessageId", alias = "messageId")]
    pub message_id: String,
    #[serde(alias = "Ts", alias = "ts")]
    pub ts: i64,
    #[serde(alias = "Bookmaker", alias = "bookmaker")]
    pub bookmaker: String,
    #[serde(alias = "BookmakerId", alias = "bookmakerId")]
    pub bookmaker_id: i32,
    #[serde(alias = "SuperOddsType", alias = "superOddsType")]
    pub super_odds_type: String,
    #[serde(alias = "GameState", alias = "gameState")]
    pub game_state: Option<String>,
    #[serde(alias = "InRunning", alias = "inRunning")]
    pub in_running: bool,
    #[serde(alias = "MarketParameters", alias = "marketParameters")]
    pub market_parameters: Option<String>,
    #[serde(alias = "MarketPeriod", alias = "marketPeriod")]
    pub market_period: Option<String>,
    #[serde(alias = "PriceNames", alias = "priceNames", default)]
    pub price_names: Vec<String>,
    #[serde(alias = "Prices", alias = "prices", default)]
    pub prices: Vec<i32>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct OddsUpdateStats {
    #[serde(alias = "updateCount", alias = "update_count")]
    pub update_count: u32,
    #[serde(alias = "minTimestamp", alias = "min_timestamp")]
    pub min_timestamp: i64,
    #[serde(alias = "maxTimestamp", alias = "max_timestamp")]
    pub max_timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct OddsBatchSummary {
    #[serde(alias = "fixtureId", alias = "fixture_id")]
    pub fixture_id: i64,
    #[serde(alias = "updateStats", alias = "update_stats")]
    pub update_stats: OddsUpdateStats,
    #[serde(alias = "oddsSubTreeRoot", alias = "odds_sub_tree_root")]
    pub odds_sub_tree_root: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ScoreStat {
    pub key: u32,
    pub value: i32,
    pub period: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct StatTerm {
    pub stat_to_prove: ScoreStat,
    pub event_stat_root: [u8; 32],
    pub stat_proof: Vec<ProofNode>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct Batch {
    pub batch_id: u64,
    pub operator: Pubkey,
    pub mint: Pubkey,
    pub bump: u8,
    pub vault_position: Pubkey,
    pub status: BatchStatus,
    pub total_deposited: u64,
    pub apy_bps: u16,
    pub bet_size: u64,
    pub bets_completed: u8,
    pub accumulated_winnings: u64,
    pub operator_yield_bps: u16,
    pub bet_terms: [BetTerms; 4],
    pub kickoff_timestamp: i64,
    pub win_prize: u64,
    pub vote_weights: [u64; 5],
    pub winning_vote_index: Option<u8>,
    pub collateral_required: u64,
    pub collateral_deposited: u64,
    pub proof_deadline: i64,
    pub outcome: Option<bool>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ProtocolConfig {
    pub admin: Pubkey,
    pub next_batch_id: u64,
    pub bump: u8,
}

// Lottery program structures

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum RoundStatus {
    Open,
    Drawn,
    Settled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct LotteryConfig {
    pub admin: Pubkey,
    pub mint: Pubkey,
    pub current_round_id: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct Round {
    pub round_id: u64,
    pub mint: Pubkey,
    pub jackpot_token_account: Pubkey,
    pub total_pool: u64,
    pub status: RoundStatus,
    pub winning_number: u64,
    pub bump: u8,
}

// Discriminator constants
pub const INITIALIZE_PROTOCOL_DISCRIMINATOR: [u8; 8] = [188, 233, 252, 106, 134, 146, 202, 91];
pub const INITIALIZE_BATCH_DISCRIMINATOR: [u8; 8] = [126, 44, 205, 90, 220, 105, 105, 193];
pub const START_BATCH_DISCRIMINATOR: [u8; 8] = [147, 69, 236, 227, 64, 168, 57, 68];
pub const PROPOSE_MATCH_DISCRIMINATOR: [u8; 8] = [148, 147, 248, 246, 13, 197, 75, 93];
pub const FINALIZE_CONSENSUS_DISCRIMINATOR: [u8; 8] = [158, 21, 141, 117, 251, 129, 243, 22];
pub const DEPOSIT_COLLATERAL_DISCRIMINATOR: [u8; 8] = [156, 131, 142, 116, 146, 247, 162, 120];
pub const SETTLE_WITH_PROOF_DISCRIMINATOR: [u8; 8] = [37, 77, 147, 139, 128, 174, 33, 158];
pub const CLAIM_OPERATOR_YIELD_DISCRIMINATOR: [u8; 8] = [109, 46, 2, 238, 212, 86, 94, 216];

// Lottery program discriminators
pub const INITIALIZE_LOTTERY_DISCRIMINATOR: [u8; 8] = [113, 199, 243, 247, 73, 217, 33, 11];
pub const START_ROUND_DISCRIMINATOR: [u8; 8] = [144, 144, 43, 7, 193, 42, 217, 215];
pub const DRAW_WINNER_DISCRIMINATOR: [u8; 8] = [250, 103, 118, 147, 219, 235, 169, 220];

// PDA Derivations

pub fn get_protocol_config_pda(program_id: &Pubkey) -> Pubkey {
    let (pda, _) = Pubkey::find_program_address(&[b"protocol_config"], program_id);
    pda
}

pub fn get_batch_pda(batch_id: u64, program_id: &Pubkey) -> Pubkey {
    let (pda, _) = Pubkey::find_program_address(
        &[b"batch", &batch_id.to_le_bytes()],
        program_id,
    );
    pda
}

pub fn get_collateral_token_account_pda(batch_pda: &Pubkey, program_id: &Pubkey) -> Pubkey {
    let (pda, _) = Pubkey::find_program_address(
        &[b"collateral", batch_pda.as_ref()],
        program_id,
    );
    pda
}

pub fn get_associated_token_address_with_program_id(
    wallet: &Pubkey,
    mint: &Pubkey,
    token_program: &Pubkey,
) -> Pubkey {
    let (pda, _) = Pubkey::find_program_address(
        &[wallet.as_ref(), token_program.as_ref(), mint.as_ref()],
        &anchor_spl::associated_token::ID,
    );
    pda
}

pub fn get_daily_odds_merkle_roots_pda(ts: i64, txodds_program_id: &Pubkey) -> Pubkey {
    let epoch_day = (ts / 86_400_000) as u16;
    let (pda, _) = Pubkey::find_program_address(
        &[b"daily_batch_roots", &epoch_day.to_le_bytes()],
        txodds_program_id,
    );
    pda
}

pub fn get_daily_scores_merkle_roots_pda(ts: i64, txodds_program_id: &Pubkey) -> Pubkey {
    let epoch_day = (ts / 86_400_000) as u16;
    let (pda, _) = Pubkey::find_program_address(
        &[b"daily_scores_roots", &epoch_day.to_le_bytes()],
        txodds_program_id,
    );
    pda
}

pub fn get_vault_config_pda(mint: &Pubkey, yield_vault_program_id: &Pubkey) -> Pubkey {
    let (pda, _) = Pubkey::find_program_address(
        &[b"vault_config", mint.as_ref()],
        yield_vault_program_id,
    );
    pda
}

pub fn get_vault_position_pda(vault_config: &Pubkey, batch: &Pubkey, yield_vault_program_id: &Pubkey) -> Pubkey {
    let (pda, _) = Pubkey::find_program_address(
        &[b"vault_position", vault_config.as_ref(), batch.as_ref()],
        yield_vault_program_id,
    );
    pda
}

// Lottery program PDA derivations

pub fn get_lottery_config_pda(mint: &Pubkey, lottery_program_id: &Pubkey) -> Pubkey {
    let (pda, _) = Pubkey::find_program_address(
        &[b"lottery_config", mint.as_ref()],
        lottery_program_id,
    );
    pda
}

pub fn get_round_pda(mint: &Pubkey, round_id: u64, lottery_program_id: &Pubkey) -> Pubkey {
    let (pda, _) = Pubkey::find_program_address(
        &[b"round", mint.as_ref(), &round_id.to_le_bytes()],
        lottery_program_id,
    );
    pda
}

pub struct SolanaClient {
    pub rpc: RpcClient,
    pub operator_keypair: Arc<Keypair>,
    pub undegen_program_id: Pubkey,
    pub txodds_program_id: Pubkey,
    pub yield_vault_program_id: Pubkey,
    pub mint_address: Pubkey,
    pub deposit_collateral_alt: Option<Pubkey>,
    pub settle_with_proof_alt: Option<Pubkey>,
    pub lottery_program_id: Pubkey,
}

impl SolanaClient {
    pub fn new(
        rpc_url: &str,
        operator_keypair: Arc<Keypair>,
        undegen_program_id: Pubkey,
        txodds_program_id: Pubkey,
        yield_vault_program_id: Pubkey,
        mint_address: Pubkey,
        deposit_collateral_alt: Option<Pubkey>,
        settle_with_proof_alt: Option<Pubkey>,
        lottery_program_id: Pubkey,
    ) -> Self {
        let rpc = RpcClient::new(rpc_url.to_string());
        Self {
            rpc,
            operator_keypair,
            undegen_program_id,
            txodds_program_id,
            yield_vault_program_id,
            mint_address,
            deposit_collateral_alt,
            settle_with_proof_alt,
            lottery_program_id,
        }
    }

    pub fn operator_pubkey(&self) -> Pubkey {
        self.operator_keypair.pubkey()
    }

    /// Fetch ProtocolConfig account
    pub async fn fetch_protocol_config(&self) -> Result<ProtocolConfig> {
        let pda = get_protocol_config_pda(&self.undegen_program_id);
        let data = self.rpc.get_account_data(&pda).await
            .context("Failed to get ProtocolConfig account data")?;
        
        if data.len() < 8 {
            return Err(anyhow!("ProtocolConfig account data too short"));
        }
        
        let mut reader = &data[8..];
        let config = ProtocolConfig::deserialize(&mut reader)
            .context("Failed to deserialize ProtocolConfig account data")?;
        Ok(config)
    }

    /// Fetch Batch account
    pub async fn fetch_batch(&self, batch_id: u64) -> Result<Batch> {
        let pda = get_batch_pda(batch_id, &self.undegen_program_id);
        let data = self.rpc.get_account_data(&pda).await
            .context("Failed to get Batch account data")?;
        
        if data.len() < 8 {
            return Err(anyhow!("Batch account data too short"));
        }
        
        let mut reader = &data[8..];
        let batch = Batch::deserialize(&mut reader)
            .context("Failed to deserialize Batch account data")?;
        Ok(batch)
    }

    /// Count how many UserPosition accounts exist for a given batch PDA.
    /// Uses getProgramAccounts with a memcmp filter on the batch field (offset 8).
    pub async fn count_batch_users(&self, batch_id: u64) -> Result<u64> {
        use solana_client::rpc_config::{RpcProgramAccountsConfig, RpcAccountInfoConfig};
        use solana_client::rpc_filter::{RpcFilterType, Memcmp, MemcmpEncodedBytes};

        let batch_pda = get_batch_pda(batch_id, &self.undegen_program_id);

        // UserPosition discriminator: sha256("account:UserPosition")[0..8]
        // Pre-computed: [0x43, 0x1c, 0x9a, 0x01, 0x7b, 0xb4, 0x78, 0xab]
        const USER_POSITION_DISCRIMINATOR: [u8; 8] = [0x43, 0x1c, 0x9a, 0x01, 0x7b, 0xb4, 0x78, 0xab];

        let filters = vec![
            // Match discriminator (first 8 bytes)
            RpcFilterType::Memcmp(Memcmp::new(
                0,
                MemcmpEncodedBytes::Bytes(USER_POSITION_DISCRIMINATOR.to_vec()),
            )),
            // Match batch pubkey (offset 8, after discriminator)
            RpcFilterType::Memcmp(Memcmp::new(
                8,
                MemcmpEncodedBytes::Bytes(batch_pda.to_bytes().to_vec()),
            )),
        ];

        let config = RpcProgramAccountsConfig {
            filters: Some(filters),
            account_config: RpcAccountInfoConfig {
                data_slice: None,
                encoding: None,
                commitment: None,
                min_context_slot: None,
            },
            with_context: None,
        };

        let accounts = self.rpc
            .get_program_accounts_with_config(&self.undegen_program_id, config)
            .await
            .context("Failed to get UserPosition accounts")?;

        Ok(accounts.len() as u64)
    }

    /// Sends a signed transaction and awaits confirmation
    async fn send_and_confirm_tx(&self, ix: Instruction) -> Result<String> {
        let recent_blockhash = self.rpc.get_latest_blockhash().await
            .context("Failed to get latest blockhash")?;
        
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&self.operator_pubkey()),
            &[&*self.operator_keypair],
            recent_blockhash,
        );

        match self.rpc.send_and_confirm_transaction(&tx).await {
            Ok(sig) => Ok(sig.to_string()),
            Err(e) => {
                let parsed_err = parse_solana_error(&anyhow::Error::new(e));
                error!("Transaction failed: {}", parsed_err);
                Err(anyhow::anyhow!("Transaction failed: {}", parsed_err))
            }
        }
    }

    /// Sends a signed VersionedTransaction with lookup tables and awaits confirmation.
    /// Also checks if the lookup table needs to be extended with any candidate addresses first.
    async fn send_and_confirm_versioned_tx(
        &self,
        instructions: Vec<Instruction>,
        alt_address: Option<Pubkey>,
    ) -> Result<String> {
        let recent_blockhash = self.rpc.get_latest_blockhash().await
            .context("Failed to get latest blockhash")?;

        let lookup_table_meta = if let Some(alt_pubkey) = alt_address {
            match self.rpc.get_account(&alt_pubkey).await {
                Ok(lookup_table_account) => {
                    use solana_sdk::address_lookup_table::state::AddressLookupTable;
                    match AddressLookupTable::deserialize(&lookup_table_account.data) {
                        Ok(table_state) => {
                            let mut candidate_addresses = std::collections::HashSet::new();
                            for ix in &instructions {
                                candidate_addresses.insert(ix.program_id);
                                for account in &ix.accounts {
                                    if !account.is_signer {
                                        candidate_addresses.insert(account.pubkey);
                                    }
                                }
                            }

                            let mut missing_addresses = Vec::new();
                            for addr in candidate_addresses {
                                if !table_state.addresses.contains(&addr) {
                                    missing_addresses.push(addr);
                                }
                            }

                            if !missing_addresses.is_empty() {
                                info!("Address Lookup Table is missing {} addresses. Extending ALT...", missing_addresses.len());
                                use solana_sdk::address_lookup_table::instruction::extend_lookup_table;
                                let extend_ix = extend_lookup_table(
                                    alt_pubkey,
                                    self.operator_pubkey(),
                                    Some(self.operator_pubkey()),
                                    missing_addresses,
                                );
                                
                                let extend_tx = Transaction::new_signed_with_payer(
                                    &[extend_ix],
                                    Some(&self.operator_pubkey()),
                                    &[&*self.operator_keypair],
                                    recent_blockhash,
                                );
                                
                                match self.rpc.send_and_confirm_transaction(&extend_tx).await {
                                    Ok(sig) => {
                                        info!("Extended lookup table successfully: sig={}. Waiting 2 seconds for activation...", sig);
                                        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                                    }
                                    Err(e) => {
                                        warn!("Failed to extend lookup table: {:?}. Proceeding without extend.", e);
                                    }
                                }

                                if let Ok(lut_acc) = self.rpc.get_account(&alt_pubkey).await {
                                    if let Ok(state) = AddressLookupTable::deserialize(&lut_acc.data) {
                                        Some(solana_sdk::address_lookup_table::AddressLookupTableAccount {
                                            key: alt_pubkey,
                                            addresses: state.addresses.to_vec(),
                                        })
                                    } else {
                                        None
                                    }
                                } else {
                                    None
                                }
                            } else {
                                Some(solana_sdk::address_lookup_table::AddressLookupTableAccount {
                                    key: alt_pubkey,
                                    addresses: table_state.addresses.to_vec(),
                                })
                            }
                        }
                        Err(_) => None,
                    }
                }
                Err(_) => None,
            }
        } else {
            None
        };

        let message = if let Some(meta) = lookup_table_meta {
            solana_sdk::message::v0::Message::try_compile(
                &self.operator_pubkey(),
                &instructions,
                &[meta],
                recent_blockhash,
            )?
        } else {
            solana_sdk::message::v0::Message::try_compile(
                &self.operator_pubkey(),
                &instructions,
                &[],
                recent_blockhash,
            )?
        };

        let tx = solana_sdk::transaction::VersionedTransaction::try_new(
            solana_sdk::message::VersionedMessage::V0(message),
            &[&*self.operator_keypair],
        )?;

        match self.rpc.send_and_confirm_transaction(&tx).await {
            Ok(sig) => Ok(sig.to_string()),
            Err(e) => {
                let parsed_err = parse_solana_error(&anyhow::Error::new(e));
                error!("Versioned transaction failed: {}", parsed_err);
                Err(anyhow::anyhow!("Versioned transaction failed: {}", parsed_err))
            }
        }
    }



    /// 0. Initialize Protocol Config
    pub async fn initialize_protocol(&self) -> Result<String> {
        let operator = self.operator_pubkey();
        let config_pda = get_protocol_config_pda(&self.undegen_program_id);

        let ix_data = INITIALIZE_PROTOCOL_DISCRIMINATOR.to_vec();

        let ix = Instruction {
            program_id: self.undegen_program_id,
            accounts: vec![
                AccountMeta::new(operator, true),
                AccountMeta::new(config_pda, false),
                AccountMeta::new_readonly(solana_sdk::system_program::ID, false),
            ],
            data: ix_data,
        };

        info!("Sending initialize_protocol tx");
        self.send_and_confirm_tx(ix).await
    }

    /// 1. Initialize Batch
    pub async fn initialize_batch(&self, apy_bps: u16) -> Result<String> {
        let operator = self.operator_pubkey();
        let config_pda = get_protocol_config_pda(&self.undegen_program_id);
        
        // Fetch current protocol config to know the next batch ID
        let config = match self.fetch_protocol_config().await {
            Ok(c) => c,
            Err(e) => {
                info!("Protocol config not found, initializing protocol first. Error: {:?}", e);
                let init_sig = self.initialize_protocol().await
                    .context("Failed to initialize protocol")?;
                info!("Protocol config initialized: sig={}", init_sig);
                self.fetch_protocol_config().await
                    .context("Failed to fetch protocol config after initialization")?
            }
        };
        let batch_pda = get_batch_pda(config.next_batch_id, &self.undegen_program_id);
        
        let mut ix_data = INITIALIZE_BATCH_DISCRIMINATOR.to_vec();
        apy_bps.serialize(&mut ix_data)?;

        let ix = Instruction {
            program_id: self.undegen_program_id,
            accounts: vec![
                AccountMeta::new(operator, true),
                AccountMeta::new_readonly(self.mint_address, false),
                AccountMeta::new(config_pda, false),
                AccountMeta::new(batch_pda, false),
                AccountMeta::new_readonly(anchor_spl::token::ID, false),
                AccountMeta::new_readonly(solana_sdk::system_program::ID, false),
            ],
            data: ix_data,
        };

        info!("Sending initialize_batch tx for batch ID {}", config.next_batch_id);
        self.send_and_confirm_tx(ix).await
    }

    /// 2. Start Batch
    pub async fn start_batch(&self, batch_id: u64) -> Result<String> {
        let operator = self.operator_pubkey();
        let batch_pda = get_batch_pda(batch_id, &self.undegen_program_id);

        let ix_data = START_BATCH_DISCRIMINATOR.to_vec();

        let ix = Instruction {
            program_id: self.undegen_program_id,
            accounts: vec![
                AccountMeta::new_readonly(operator, true),
                AccountMeta::new(batch_pda, false),
            ],
            data: ix_data,
        };

        info!("Sending start_batch tx for batch ID {}", batch_id);
        self.send_and_confirm_tx(ix).await
    }

    /// 3. Propose Match
    /// Args match the deployed IDL exactly:
    ///   bet_terms_array: [BetTerms; 4], kickoff_timestamp: i64
    pub async fn propose_match(
        &self,
        batch_id: u64,
        bets: &[BetTerms; 4],
        kickoff_timestamp: i64,
    ) -> Result<String> {
        let operator = self.operator_pubkey();
        let batch_pda = get_batch_pda(batch_id, &self.undegen_program_id);

        let mut ix_data = PROPOSE_MATCH_DISCRIMINATOR.to_vec();
        bets.serialize(&mut ix_data)?;
        kickoff_timestamp.serialize(&mut ix_data)?;

        let ix = Instruction {
            program_id: self.undegen_program_id,
            accounts: vec![
                AccountMeta::new_readonly(operator, true),
                AccountMeta::new(batch_pda, false),
            ],
            data: ix_data,
        };

        info!("Sending propose_match tx for batch ID {}", batch_id);
        self.send_and_confirm_tx(ix).await
    }

    /// 4. Finalize Consensus
    pub async fn finalize_consensus(&self, batch_id: u64) -> Result<String> {
        let batch_pda = get_batch_pda(batch_id, &self.undegen_program_id);

        let ix_data = FINALIZE_CONSENSUS_DISCRIMINATOR.to_vec();

        // Operator does not need to sign, but someone must pay for fees.
        // We will sign and pay from the operator keypair.
        let ix = Instruction {
            program_id: self.undegen_program_id,
            accounts: vec![
                AccountMeta::new(batch_pda, false),
            ],
            data: ix_data,
        };

        info!("Sending finalize_consensus tx for batch ID {}", batch_id);
        self.send_and_confirm_tx(ix).await
    }

    /// 5. Deposit Collateral
    /// On-chain signature: deposit_collateral_handler(ctx, amount: u64)
    /// Accounts: operator (mut signer), mint, batch (mut), operator_token_account (mut),
    ///           collateral_token_account (mut, PDA init_if_needed), token_program, system_program
    pub async fn deposit_collateral(
        &self,
        batch_id: u64,
        amount: u64,
        oracle_price_index: u8,
        odds_snapshot: Odds,
        summary: OddsBatchSummary,
        sub_tree_proof: Vec<ProofNode>,
        main_tree_proof: Vec<ProofNode>,
    ) -> Result<String> {
        let operator = self.operator_pubkey();
        let batch_pda = get_batch_pda(batch_id, &self.undegen_program_id);
        
        let operator_token_account = anchor_spl::associated_token::get_associated_token_address(
            &operator,
            &self.mint_address,
        );
        let collateral_token_account = get_collateral_token_account_pda(&batch_pda, &self.undegen_program_id);

        let batch_token_account = get_associated_token_address_with_program_id(
            &batch_pda,
            &self.mint_address,
            &anchor_spl::token::ID,
        );

        let daily_odds_merkle_roots = get_daily_odds_merkle_roots_pda(odds_snapshot.ts, &self.txodds_program_id);

        let mut ix_data = DEPOSIT_COLLATERAL_DISCRIMINATOR.to_vec();
        amount.serialize(&mut ix_data)?;
        oracle_price_index.serialize(&mut ix_data)?;
        odds_snapshot.serialize(&mut ix_data)?;
        summary.serialize(&mut ix_data)?;
        sub_tree_proof.serialize(&mut ix_data)?;
        main_tree_proof.serialize(&mut ix_data)?;

        let ix = Instruction {
            program_id: self.undegen_program_id,
            accounts: vec![
                AccountMeta::new(operator, true),
                AccountMeta::new_readonly(self.mint_address, false),
                AccountMeta::new(batch_pda, false),
                AccountMeta::new(operator_token_account, false),
                AccountMeta::new(collateral_token_account, false),
                AccountMeta::new(batch_token_account, false),
                AccountMeta::new_readonly(daily_odds_merkle_roots, false),
                AccountMeta::new_readonly(self.txodds_program_id, false),
                AccountMeta::new_readonly(anchor_spl::token::ID, false),
                AccountMeta::new_readonly(anchor_spl::associated_token::ID, false),
                AccountMeta::new_readonly(solana_sdk::system_program::ID, false),
            ],
            data: ix_data,
        };

        info!("Sending deposit_collateral tx for batch ID {}", batch_id);
        let cu_ix = solana_sdk::compute_budget::ComputeBudgetInstruction::set_compute_unit_limit(400_000);
        self.send_and_confirm_versioned_tx(
            vec![cu_ix, ix],
            self.deposit_collateral_alt,
        ).await
    }

    /// 6. Settle with Proof
    pub async fn settle_with_proof(
        &self,
        batch_id: u64,
        fixture_summary: ScoresBatchSummary,
        main_tree_proof: Vec<ProofNode>,
        fixture_proof: Vec<ProofNode>,
        stat_a: StatTerm,
        stat_b: Option<StatTerm>,
        ts: i64,
    ) -> Result<String> {
        let operator = self.operator_pubkey();
        let batch_pda = get_batch_pda(batch_id, &self.undegen_program_id);
        
        let collateral_token_account = get_collateral_token_account_pda(&batch_pda, &self.undegen_program_id);
        let operator_token_account = anchor_spl::associated_token::get_associated_token_address(
            &operator,
            &self.mint_address,
        );

        let daily_scores_merkle_roots = get_daily_scores_merkle_roots_pda(ts, &self.txodds_program_id);

        let vault_config = get_vault_config_pda(&self.mint_address, &self.yield_vault_program_id);
        let vault_token_account = anchor_spl::associated_token::get_associated_token_address(
            &vault_config,
            &self.mint_address,
        );
        let vault_position = get_vault_position_pda(&vault_config, &batch_pda, &self.yield_vault_program_id);

        let mut ix_data = SETTLE_WITH_PROOF_DISCRIMINATOR.to_vec();
        fixture_summary.serialize(&mut ix_data)?;
        main_tree_proof.serialize(&mut ix_data)?;
        fixture_proof.serialize(&mut ix_data)?;
        stat_a.serialize(&mut ix_data)?;
        stat_b.serialize(&mut ix_data)?;
        ts.serialize(&mut ix_data)?;

        let ix = Instruction {
            program_id: self.undegen_program_id,
            accounts: vec![
                AccountMeta::new(operator, true),
                AccountMeta::new_readonly(self.mint_address, false),
                AccountMeta::new(batch_pda, false),
                AccountMeta::new(collateral_token_account, false),
                AccountMeta::new(operator_token_account, false),
                AccountMeta::new_readonly(daily_scores_merkle_roots, false),
                AccountMeta::new_readonly(self.txodds_program_id, false),
                AccountMeta::new(vault_config, false),
                AccountMeta::new(vault_token_account, false),
                AccountMeta::new(vault_position, false),
                AccountMeta::new_readonly(self.yield_vault_program_id, false),
                AccountMeta::new_readonly(anchor_spl::token::ID, false),
                AccountMeta::new_readonly(anchor_spl::associated_token::ID, false),
                AccountMeta::new_readonly(solana_sdk::system_program::ID, false),
            ],
            data: ix_data,
        };

        info!("Sending settle_with_proof tx for batch ID {}", batch_id);
        let cu_ix = solana_sdk::compute_budget::ComputeBudgetInstruction::set_compute_unit_limit(400_000);
        self.send_and_confirm_versioned_tx(
            vec![cu_ix, ix],
            self.settle_with_proof_alt,
        ).await
    }

    /// 7. Claim Operator Yield
    pub async fn claim_operator_yield(&self, batch_id: u64) -> Result<String> {
        let operator = self.operator_pubkey();
        let batch_pda = get_batch_pda(batch_id, &self.undegen_program_id);
        
        let operator_token_account = anchor_spl::associated_token::get_associated_token_address(
            &operator,
            &self.mint_address,
        );
        let batch_token_account = anchor_spl::associated_token::get_associated_token_address(
            &batch_pda,
            &self.mint_address,
        );

        let vault_config = get_vault_config_pda(&self.mint_address, &self.yield_vault_program_id);
        let vault_token_account = anchor_spl::associated_token::get_associated_token_address(
            &vault_config,
            &self.mint_address,
        );
        let vault_position = get_vault_position_pda(&vault_config, &batch_pda, &self.yield_vault_program_id);

        let ix_data = CLAIM_OPERATOR_YIELD_DISCRIMINATOR.to_vec();

        let ix = Instruction {
            program_id: self.undegen_program_id,
            accounts: vec![
                AccountMeta::new(operator, true),
                AccountMeta::new_readonly(self.mint_address, false),
                AccountMeta::new(batch_pda, false),
                AccountMeta::new(operator_token_account, false),
                AccountMeta::new(batch_token_account, false),
                AccountMeta::new(vault_config, false),
                AccountMeta::new(vault_token_account, false),
                AccountMeta::new(vault_position, false),
                AccountMeta::new_readonly(self.yield_vault_program_id, false),
                AccountMeta::new_readonly(anchor_spl::token::ID, false),
                AccountMeta::new_readonly(anchor_spl::associated_token::ID, false),
                AccountMeta::new_readonly(solana_sdk::system_program::ID, false),
            ],
            data: ix_data,
        };

        info!("Sending claim_operator_yield tx for batch ID {}", batch_id);
        self.send_and_confirm_tx(ix).await
    }

    // --- Lottery program ---

    /// Fetch LotteryConfig account for the operator's mint
    pub async fn fetch_lottery_config(&self) -> Result<LotteryConfig> {
        let pda = get_lottery_config_pda(&self.mint_address, &self.lottery_program_id);
        let data = self.rpc.get_account_data(&pda).await
            .context("Failed to get LotteryConfig account data")?;

        if data.len() < 8 {
            return Err(anyhow!("LotteryConfig account data too short"));
        }

        let mut reader = &data[8..];
        let config = LotteryConfig::deserialize(&mut reader)
            .context("Failed to deserialize LotteryConfig account data")?;
        Ok(config)
    }

    /// Fetch Round account for a given round ID
    pub async fn fetch_round(&self, round_id: u64) -> Result<Round> {
        let pda = get_round_pda(&self.mint_address, round_id, &self.lottery_program_id);
        let data = self.rpc.get_account_data(&pda).await
            .context("Failed to get Round account data")?;

        if data.len() < 8 {
            return Err(anyhow!("Round account data too short"));
        }

        let mut reader = &data[8..];
        let round = Round::deserialize(&mut reader)
            .context("Failed to deserialize Round account data")?;
        Ok(round)
    }

    /// Initialize the lottery (creates LotteryConfig for the operator's mint)
    pub async fn initialize_lottery(&self) -> Result<String> {
        let admin = self.operator_pubkey();
        let lottery_config_pda = get_lottery_config_pda(&self.mint_address, &self.lottery_program_id);

        let ix_data = INITIALIZE_LOTTERY_DISCRIMINATOR.to_vec();

        let ix = Instruction {
            program_id: self.lottery_program_id,
            accounts: vec![
                AccountMeta::new(admin, true),
                AccountMeta::new_readonly(self.mint_address, false),
                AccountMeta::new(lottery_config_pda, false),
                AccountMeta::new_readonly(solana_sdk::system_program::ID, false),
            ],
            data: ix_data,
        };

        info!("Sending initialize_lottery tx");
        self.send_and_confirm_tx(ix).await
    }

    /// Start a new lottery round with the given round ID
    /// (must match LotteryConfig.current_round_id at the time of the call)
    pub async fn start_round(&self, round_id: u64) -> Result<String> {
        let admin = self.operator_pubkey();
        let lottery_config_pda = get_lottery_config_pda(&self.mint_address, &self.lottery_program_id);
        let round_pda = get_round_pda(&self.mint_address, round_id, &self.lottery_program_id);
        let jackpot_token_account = anchor_spl::associated_token::get_associated_token_address(
            &round_pda,
            &self.mint_address,
        );

        let ix_data = START_ROUND_DISCRIMINATOR.to_vec();

        let ix = Instruction {
            program_id: self.lottery_program_id,
            accounts: vec![
                AccountMeta::new(admin, true),
                AccountMeta::new(lottery_config_pda, false),
                AccountMeta::new_readonly(self.mint_address, false),
                AccountMeta::new(round_pda, false),
                AccountMeta::new(jackpot_token_account, false),
                AccountMeta::new_readonly(anchor_spl::token::ID, false),
                AccountMeta::new_readonly(anchor_spl::associated_token::ID, false),
                AccountMeta::new_readonly(solana_sdk::system_program::ID, false),
            ],
            data: ix_data,
        };

        info!("Sending start_round tx for round ID {}", round_id);
        self.send_and_confirm_tx(ix).await
    }

    /// Draw the winner for an open lottery round
    pub async fn draw_winner(&self, round_id: u64) -> Result<String> {
        let admin = self.operator_pubkey();
        let lottery_config_pda = get_lottery_config_pda(&self.mint_address, &self.lottery_program_id);
        let round_pda = get_round_pda(&self.mint_address, round_id, &self.lottery_program_id);

        let ix_data = DRAW_WINNER_DISCRIMINATOR.to_vec();

        let ix = Instruction {
            program_id: self.lottery_program_id,
            accounts: vec![
                AccountMeta::new_readonly(admin, true),
                AccountMeta::new_readonly(lottery_config_pda, false),
                AccountMeta::new_readonly(self.mint_address, false),
                AccountMeta::new(round_pda, false),
            ],
            data: ix_data,
        };

        info!("Sending draw_winner tx for round ID {}", round_id);
        self.send_and_confirm_tx(ix).await
    }
}

// Module-level helper functions for parsing contract and transaction errors

struct ParsedContractError {
    name: String,
    msg: String,
}

fn get_custom_error_by_code(code: u32) -> Option<ParsedContractError> {
    let (name, msg) = match code {
        6000 => ("InvalidAmount", "Invalid amount"),
        6001 => ("NotInLobby", "Batch is not in Lobby status"),
        6002 => ("NotLocked", "Batch is not in Locked status"),
        6003 => ("NotAwaitingCollateral", "Batch is not awaiting collateral"),
        6004 => ("NotActive", "Batch is not active"),
        6005 => ("NotAwaitingProof", "Batch is not awaiting proof"),
        6006 => ("AlreadyFinished", "Batch is already settled or cancelled"),
        6007 => ("AlreadyVoted", "User has already voted"),
        6008 => ("AlreadyClaimed", "User has already claimed"),
        6009 => ("VotingClosed", "Voting has already concluded"),
        6010 => ("KickoffNotReached", "Kickoff time has not passed yet"),
        6011 => ("CollateralDeadlineNotPassed", "Collateral deadline has not passed yet"),
        6012 => ("ProofDeadlineNotPassed", "Proof deadline has not passed yet"),
        6013 => ("CollateralAlreadyDeposited", "Collateral already deposited"),
        6014 => ("MathOverflow", "Math overflow"),
        6015 => ("Unauthorized", "Unauthorized"),
        6016 => ("NoVotesCast", "No votes were cast - bet skipped"),
        6017 => ("MissingEd25519Instruction", "Ed25519 instruction not found in transaction"),
        6018 => ("InvalidOracleSignature", "Oracle signature verification failed"),
        6019 => ("MatchIdMismatch", "Proof match ID does not match this batch"),
        6020 => ("NothingToGrow", "No yield generated yet — tick the vault before proposing a match"),
        
        // Standard Anchor errors
        100 => ("InstructionMissing", "8 byte instruction identifier not provided"),
        101 => ("InstructionFallbackNotFound", "Fallback functions are not supported"),
        102 => ("InstructionDidNotDeserialize", "The program could not deserialize the given instruction"),
        103 => ("InstructionDidNotSerialize", "The program could not serialize the response"),
        
        2000 => ("ConstraintMut", "A mut constraint was violated"),
        2001 => ("ConstraintHasOne", "A has_one constraint was violated"),
        2002 => ("ConstraintSigner", "A signer constraint was violated"),
        2003 => ("ConstraintRaw", "A raw constraint was violated"),
        2004 => ("ConstraintOwner", "An owner constraint was violated"),
        2005 => ("ConstraintRentExempt", "A rent exempt constraint was violated"),
        2006 => ("ConstraintSeeds", "A seeds constraint was violated"),
        2007 => ("ConstraintExecutable", "An executable constraint was violated"),
        2008 => ("ConstraintState", "A state constraint was violated"),
        2009 => ("ConstraintAssociated", "An associated constraint was violated"),
        2010 => ("ConstraintAssociatedGroup", "An associated_group constraint was violated"),
        2011 => ("ConstraintAddress", "An address constraint was violated"),
        2012 => ("ConstraintZero", "A zero constraint was violated"),
        2013 => ("ConstraintTokenMint", "A token mint constraint was violated"),
        2014 => ("ConstraintTokenOwner", "A token owner constraint was violated"),
        2015 => ("ConstraintMintMintAuthority", "A mint mint authority constraint was violated"),
        2016 => ("ConstraintMintFreezeAuthority", "A mint freeze authority constraint was violated"),
        2017 => ("ConstraintMintDecimals", "A mint decimals constraint was violated"),
        2018 => ("ConstraintSpace", "A space constraint was violated"),
        
        _ => return None,
    };
    Some(ParsedContractError {
        name: name.to_string(),
        msg: msg.to_string(),
    })
}

fn format_transaction_error(tx_err: &TransactionError) -> String {
    match tx_err {
        TransactionError::InstructionError(idx, inst_err) => {
            let detail = match inst_err {
                InstructionError::Custom(code) => {
                    if let Some(custom) = get_custom_error_by_code(*code) {
                        format!("Custom Program Error: {} (code={}) - {}", custom.name, code, custom.msg)
                    } else {
                        format!("Custom Program Error (code={})", code)
                    }
                }
                other => format!("{:?}", other),
            };
            format!("Instruction {} failed: {}", idx, detail)
        }
        other => format!("Transaction Error: {:?}", other),
    }
}

fn parse_error_from_logs(logs: &[String]) -> Option<ParsedContractError> {
    for log in logs {
        if log.contains("AnchorError occurred") || log.contains("Error Code:") {
            let code_prefix = "Error Code: ";
            let msg_prefix = "Error Message: ";
            
            let code = if let Some(pos) = log.find(code_prefix) {
                let start = pos + code_prefix.len();
                let end = log[start..].find('.').unwrap_or(log[start..].len());
                log[start..start+end].trim().to_string()
            } else {
                String::new()
            };
            
            let msg = if let Some(pos) = log.find(msg_prefix) {
                let start = pos + msg_prefix.len();
                let end = log[start..].find('.').unwrap_or(log[start..].len());
                log[start..start+end].trim().to_string()
            } else {
                String::new()
            };
            
            if !code.is_empty() {
                return Some(ParsedContractError { name: code, msg });
            }
        }
        
        if log.contains("custom program error:") {
            if let Some(pos) = log.find("custom program error:") {
                let code_str = log[pos + "custom program error:".len()..].trim();
                let code = if code_str.starts_with("0x") {
                    u32::from_str_radix(&code_str[2..], 16).ok()
                } else {
                    code_str.parse::<u32>().ok()
                };
                if let Some(c) = code {
                    if let Some(custom_err) = get_custom_error_by_code(c) {
                        return Some(custom_err);
                    }
                }
            }
        }
    }
    None
}

fn parse_solana_error(err: &anyhow::Error) -> String {
    if let Some(client_err) = err.downcast_ref::<solana_client::client_error::ClientError>() {
        match client_err.kind() {
            solana_client::client_error::ClientErrorKind::RpcError(
                RpcError::RpcResponseError {
                    code,
                    message,
                    data,
                },
            ) => {
                let mut explanation = format!("RPC Response Error (code={}): {}", code, message);
                if let RpcResponseErrorData::SendTransactionPreflightFailure(ref result) = data {
                    if let Some(ref logs) = result.logs {
                        explanation.push_str("\nSimulation Logs:");
                        for log in logs {
                            explanation.push_str(&format!("\n  {}", log));
                        }
                        if let Some(custom_err) = parse_error_from_logs(logs) {
                            explanation = format!("Contract Error: {} - {}", custom_err.name, custom_err.msg);
                        }
                    }
                }
                explanation
            }
            solana_client::client_error::ClientErrorKind::TransactionError(tx_err) => {
                format_transaction_error(tx_err)
            }
            other => format!("Solana Client Error: {:?}", other),
        }
    } else {
        format!("{:?}", err)
    }
}
