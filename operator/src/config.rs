use std::fs::File;
use std::path::Path;
use anyhow::{Context, Result};
use serde::Deserialize;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
use std::str::FromStr;

#[derive(Debug, Deserialize, Clone)]
pub struct YamlConfig {
    pub tick_interval_secs: u64,
    pub lobby_duration_secs: u64,
    pub max_active_batches: u64,
    pub min_batch_users: u64,
    pub batch_apy_bps: u16,
    pub operator_yield_bps: u16,
    pub undegen_program_id: String,
    pub txodds_program_id: String,
    pub yield_vault_program_id: String,
    pub mint_address: String,
    pub fixtures_lookback_hours: i64,
    pub deposit_collateral_alt: Option<String>,
    pub settle_with_proof_alt: Option<String>,
    pub lottery_program_id: String,
    pub lottery_round_duration_secs: u64,
}

#[derive(Clone)]
pub struct Config {
    pub operator_keypair: std::sync::Arc<Keypair>,
    pub txodds_api_key: String,
    pub txodds_bearer_token: String,
    pub rpc_url: String,
    pub redis_url: String,
    pub tick_interval_secs: u64,
    pub lobby_duration_secs: u64,
    pub max_active_batches: u64,
    pub min_batch_users: u64,
    pub batch_apy_bps: u16,
    #[allow(dead_code)]
    pub operator_yield_bps: u16,
    pub undegen_program_id: Pubkey,
    pub txodds_program_id: Pubkey,
    pub yield_vault_program_id: Pubkey,
    pub mint_address: Pubkey,
    #[allow(dead_code)]
    pub alt_address: Option<Pubkey>,
    pub deposit_collateral_alt: Option<Pubkey>,
    pub settle_with_proof_alt: Option<Pubkey>,
    pub fixtures_lookback_hours: i64,
    pub lottery_program_id: Pubkey,
    pub lottery_round_duration_secs: u64,
}

impl Config {
    pub fn load() -> Result<Self> {
        // Load .env
        dotenv::dotenv().ok();

        // Load config.yml
        let yaml_path = Path::new("config.yml");
        let file = File::open(yaml_path)
            .with_context(|| format!("Failed to open config file: {:?}", yaml_path))?;
        let yaml_config: YamlConfig = serde_yaml::from_reader(file)
            .context("Failed to parse config.yml")?;

        let rpc_url = std::env::var("RPC_URL").context("RPC_URL must be set in .env")?;
        let redis_url = std::env::var("REDIS_URL").context("REDIS_URL must be set in .env")?;
        let txodds_api_key = std::env::var("TXODDS_API_KEY").context("TXODDS_API_KEY must be set in .env")?;
        let txodds_bearer_token = std::env::var("TXODDS_BEARER_TOKEN").context("TXODDS_BEARER_TOKEN must be set in .env")?;
        
        let priv_key_str = std::env::var("OPERATOR_PRIVATE_KEY")
            .context("OPERATOR_PRIVATE_KEY must be set in .env")?;

        let operator_keypair = parse_keypair(&priv_key_str)
            .context("Failed to parse OPERATOR_PRIVATE_KEY")?;

        let undegen_program_id = Pubkey::from_str(&yaml_config.undegen_program_id)
            .context("Invalid undegen_program_id")?;
        let txodds_program_id = Pubkey::from_str(&yaml_config.txodds_program_id)
            .context("Invalid txodds_program_id")?;
        let yield_vault_program_id = Pubkey::from_str(&yaml_config.yield_vault_program_id)
            .context("Invalid yield_vault_program_id")?;
        let mint_address = Pubkey::from_str(&yaml_config.mint_address)
            .context("Invalid mint_address")?;
        let lottery_program_id = Pubkey::from_str(&yaml_config.lottery_program_id)
            .context("Invalid lottery_program_id")?;

        let alt_address = match std::env::var("ADDRESS_LOOKUP_TABLE") {
            Ok(val) if !val.trim().is_empty() => {
                let pubkey = Pubkey::from_str(&val)
                    .context("Invalid ADDRESS_LOOKUP_TABLE pubkey")?;
                Some(pubkey)
            }
            _ => None,
        };

        let deposit_collateral_alt = match &yaml_config.deposit_collateral_alt {
            Some(val) if !val.trim().is_empty() => {
                let pubkey = Pubkey::from_str(val)
                    .context("Invalid deposit_collateral_alt pubkey")?;
                Some(pubkey)
            }
            _ => None,
        };

        let settle_with_proof_alt = match &yaml_config.settle_with_proof_alt {
            Some(val) if !val.trim().is_empty() => {
                let pubkey = Pubkey::from_str(val)
                    .context("Invalid settle_with_proof_alt pubkey")?;
                Some(pubkey)
            }
            _ => None,
        };

        Ok(Config {
            operator_keypair: std::sync::Arc::new(operator_keypair),
            txodds_api_key,
            txodds_bearer_token,
            rpc_url,
            redis_url,
            tick_interval_secs: yaml_config.tick_interval_secs,
            lobby_duration_secs: yaml_config.lobby_duration_secs,
            max_active_batches: yaml_config.max_active_batches,
            min_batch_users: yaml_config.min_batch_users,
            batch_apy_bps: yaml_config.batch_apy_bps,
            operator_yield_bps: yaml_config.operator_yield_bps,
            undegen_program_id,
            txodds_program_id,
            yield_vault_program_id,
            mint_address,
            alt_address,
            deposit_collateral_alt,
            settle_with_proof_alt,
            fixtures_lookback_hours: yaml_config.fixtures_lookback_hours,
            lottery_program_id,
            lottery_round_duration_secs: yaml_config.lottery_round_duration_secs,
        })
    }
}

fn parse_keypair(s: &str) -> Result<Keypair> {
    let s = s.trim();
    if s.starts_with('[') && s.ends_with(']') {
        // Parse as JSON array of u8
        let bytes: Vec<u8> = serde_json::from_str(s)?;
        Keypair::from_bytes(&bytes).map_err(|e| anyhow::anyhow!("Invalid keypair bytes: {:?}", e))
    } else {
        // Parse as base58 string
        let bytes = bs58::decode(s)
            .into_vec()
            .map_err(|e| anyhow::anyhow!("Invalid base58 format for private key: {:?}", e))?;
        Keypair::from_bytes(&bytes).map_err(|e| anyhow::anyhow!("Invalid keypair bytes: {:?}", e))
    }
}
