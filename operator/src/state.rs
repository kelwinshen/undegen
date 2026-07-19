use anyhow::{Context, Result};
use deadpool_redis::Pool;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BatchMetadata {
    #[serde(rename = "fixtureId")]
    pub fixture_id: i64,
    #[serde(rename = "optionsMapping")]
    pub options_mapping: serde_json::Value,
    #[serde(rename = "slotsMapping")]
    pub slots_mapping: serde_json::Value,
    pub timestamps: serde_json::Value,
}

pub struct RedisState {
    pool: Pool,
}

impl RedisState {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    /// Exposes a way to retrieve a connection from the pool.
    pub async fn get_conn(&self) -> Result<deadpool_redis::Connection> {
        self.pool.get().await.context("Failed to get Redis connection from pool")
    }

    /// Try to acquire a lock for a specific batch. Returns true if lock was acquired.
    pub async fn acquire_lock(&self, batch_id: u64, ttl_secs: u64) -> Result<bool> {
        let mut conn = self.get_conn().await?;
        let lock_key = format!("undegen:lock:batch:{}", batch_id);
        
        // Use SET lock_key "locked" NX EX ttl_secs
        let acquired: Option<String> = redis::Cmd::new()
            .arg("SET")
            .arg(&lock_key)
            .arg("locked")
            .arg("NX")
            .arg("EX")
            .arg(ttl_secs)
            .query_async(&mut conn)
            .await
            .context("Failed to execute SET NX EX for lock")?;

        Ok(acquired.is_some())
    }

    /// Release the lock for a specific batch.
    pub async fn release_lock(&self, batch_id: u64) -> Result<()> {
        let mut conn = self.get_conn().await?;
        let lock_key = format!("undegen:lock:batch:{}", batch_id);
        let _: i32 = conn.del(&lock_key).await.context("Failed to delete lock key")?;
        Ok(())
    }

    /// Try to acquire the distributed lock for lottery processing. Returns true if lock was acquired.
    pub async fn acquire_lottery_lock(&self, ttl_secs: u64) -> Result<bool> {
        let mut conn = self.get_conn().await?;
        let lock_key = "lottery:lock";

        let acquired: Option<String> = redis::Cmd::new()
            .arg("SET")
            .arg(lock_key)
            .arg("locked")
            .arg("NX")
            .arg("EX")
            .arg(ttl_secs)
            .query_async(&mut conn)
            .await
            .context("Failed to execute SET NX EX for lottery lock")?;

        Ok(acquired.is_some())
    }

    /// Release the lottery processing lock.
    pub async fn release_lottery_lock(&self) -> Result<()> {
        let mut conn = self.get_conn().await?;
        let _: i32 = conn.del("lottery:lock").await.context("Failed to delete lottery lock key")?;
        Ok(())
    }

    /// Store metadata for a batch.
    pub async fn store_metadata(&self, batch_id: u64, metadata: &BatchMetadata) -> Result<()> {
        let mut conn = self.get_conn().await?;
        let key = format!("undegen:batch:{}", batch_id);
        let val = serde_json::to_string(metadata).context("Failed to serialize BatchMetadata")?;
        
        let _: () = conn.set(key, val).await.context("Failed to store metadata in Redis")?;
        Ok(())
    }

    /// Retrieve metadata for a batch.
    pub async fn get_metadata(&self, batch_id: u64) -> Result<Option<BatchMetadata>> {
        let mut conn = self.get_conn().await?;
        let key = format!("undegen:batch:{}", batch_id);
        let val: Option<String> = conn.get(key).await.context("Failed to get metadata from Redis")?;
        
        match val {
            Some(s) => {
                let meta = serde_json::from_str(&s).context("Failed to deserialize BatchMetadata")?;
                Ok(Some(meta))
            }
            None => Ok(None),
        }
    }
}
