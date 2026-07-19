mod config;
mod state;
mod solana;
mod api;
mod processor;

use anyhow::{Context, Result};
use deadpool_redis::Config as RedisConfig;
use solana_sdk::signer::Signer;
use std::time::Duration;
use tracing::{info, error};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Starting Undegen Operator Service...");

    let config = crate::config::Config::load()
        .context("Failed to load configuration")?;

    info!("Loaded config. Operator pubkey: {}", config.operator_keypair.pubkey());
    info!("RPC URL: {}", config.rpc_url);
    info!("Redis URL: {}", config.redis_url);

    let redis_cfg = RedisConfig::from_url(&config.redis_url);
    let redis_pool = redis_cfg
        .create_pool(Some(deadpool_redis::Runtime::Tokio1))
        .context("Failed to create Redis connection pool")?;

    let redis_state = crate::state::RedisState::new(redis_pool);

    let solana_client = crate::solana::SolanaClient::new(
        &config.rpc_url,
        config.operator_keypair.clone(),
        config.undegen_program_id,
        config.txodds_program_id,
        config.yield_vault_program_id,
        config.mint_address,
        config.deposit_collateral_alt,
        config.settle_with_proof_alt,
        config.lottery_program_id,
    );

    let txodds_client = crate::api::TxOddsClient::new(&config)?;

    let processor = crate::processor::BatchProcessor::new(
        config.clone(),
        solana_client,
        txodds_client,
        redis_state,
    );

    // Setup polling tick loop
    let tick_interval = Duration::from_secs(config.tick_interval_secs);
    info!("Scheduler running with tick interval of {}s", config.tick_interval_secs);

    // Spawn an immediate Ctrl-C shutdown listener task
    tokio::spawn(async {
        tokio::signal::ctrl_c().await.ok();
        info!("Received shutdown signal. Exiting operator service immediately.");
        std::process::exit(0);
    });

    let mut interval = tokio::time::interval(tick_interval);
    
    loop {
        tokio::select! {
            _ = interval.tick() => {
                if let Err(e) = processor.tick().await {
                    error!("Error during processor tick: {:?}", e);
                }
            }
            _ = tokio::signal::ctrl_c() => {
                info!("Received shutdown signal. Exiting operator service gracefully.");
                break;
            }
        }
    }

    Ok(())
}
