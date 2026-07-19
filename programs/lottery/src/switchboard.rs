//! Minimal client for the Switchboard On-Demand randomness account/instruction
//! layout, built directly against Switchboard's public on-chain interface
//! (https://github.com/switchboard-xyz/solana-sdk) rather than pulling in the
//! `switchboard-on-demand` crate, whose "anchor" feature does not build
//! against this workspace's anchor-lang version.
use std::str::FromStr;

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke;

use crate::error::LotteryError;

/// Switchboard On-Demand program, devnet deployment (this workspace targets
/// devnet per Anchor.toml). Mainnet deployment is `SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv`.
pub fn switchboard_on_demand_program_id() -> Pubkey {
    Pubkey::from_str("Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2").unwrap()
}

/// Anchor account discriminator for `RandomnessAccountData`.
const RANDOMNESS_ACCOUNT_DISCRIMINATOR: [u8; 8] = [10, 66, 229, 135, 220, 239, 217, 114];

/// Anchor instruction discriminator for `randomness_commit`.
const RANDOMNESS_COMMIT_DISCRIMINATOR: [u8; 8] = [52, 170, 152, 201, 179, 133, 242, 141];

/// Byte layout of `RandomnessAccountData`, immediately after the 8-byte
/// discriminator: authority(32) + queue(32) + seed_slothash(32) + seed_slot(8)
/// + oracle(32) + reveal_slot(8) + value(32).
const REVEAL_SLOT_OFFSET: usize = 8 + 32 + 32 + 32 + 8 + 32;
const VALUE_OFFSET: usize = REVEAL_SLOT_OFFSET + 8;
const MIN_ACCOUNT_LEN: usize = VALUE_OFFSET + 32;

/// Encodes a `RandomnessAccountData`-shaped byte buffer with the given reveal
/// slot and value already committed. Exposed for integration tests that need
/// to fabricate an already-revealed account, since litesvm has no real
/// Switchboard oracle to produce one.
pub fn encode_randomness_account_data(reveal_slot: u64, value: [u8; 32]) -> Vec<u8> {
    let mut data = vec![0u8; MIN_ACCOUNT_LEN];
    data[0..8].copy_from_slice(&RANDOMNESS_ACCOUNT_DISCRIMINATOR);
    data[REVEAL_SLOT_OFFSET..REVEAL_SLOT_OFFSET + 8].copy_from_slice(&reveal_slot.to_le_bytes());
    data[VALUE_OFFSET..VALUE_OFFSET + 32].copy_from_slice(&value);
    data
}

/// Reads the revealed randomness value out of a Switchboard On-Demand
/// `RandomnessAccountData` account, requiring that it was revealed in the
/// current slot - the account is only trustworthy as "unpredictable" if read
/// atomically alongside the oracle's reveal, which lands in this same slot.
pub fn read_revealed_value(account: &AccountInfo, current_slot: u64) -> Result<[u8; 32]> {
    require_keys_eq!(
        *account.owner,
        switchboard_on_demand_program_id(),
        LotteryError::RandomnessAccountMismatch
    );

    let data = account.try_borrow_data()?;
    require!(
        data.len() >= MIN_ACCOUNT_LEN,
        LotteryError::RandomnessNotResolved
    );
    require!(
        data[0..8] == RANDOMNESS_ACCOUNT_DISCRIMINATOR,
        LotteryError::RandomnessAccountMismatch
    );

    let reveal_slot = u64::from_le_bytes(
        data[REVEAL_SLOT_OFFSET..REVEAL_SLOT_OFFSET + 8]
            .try_into()
            .unwrap(),
    );
    require!(
        reveal_slot == current_slot,
        LotteryError::RandomnessNotResolved
    );

    let mut value = [0u8; 32];
    value.copy_from_slice(&data[VALUE_OFFSET..VALUE_OFFSET + 32]);
    Ok(value)
}

/// CPIs into Switchboard On-Demand's `randomness_commit` instruction, binding
/// `randomness` to reveal against a future slot on `queue`/`oracle`. `authority`
/// must match the randomness account's stored authority and sign the call.
#[allow(clippy::too_many_arguments)]
pub fn commit_randomness<'info>(
    switchboard_program: &AccountInfo<'info>,
    randomness: &AccountInfo<'info>,
    queue: &AccountInfo<'info>,
    oracle: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    recent_slothashes: &AccountInfo<'info>,
) -> Result<()> {
    require_keys_eq!(
        *switchboard_program.key,
        switchboard_on_demand_program_id(),
        LotteryError::RandomnessCommitFailed
    );
    require_keys_eq!(
        *recent_slothashes.key,
        solana_sdk_ids::sysvar::slot_hashes::ID,
        LotteryError::RandomnessCommitFailed
    );

    let ix = Instruction {
        program_id: switchboard_on_demand_program_id(),
        accounts: vec![
            AccountMeta::new(*randomness.key, false),
            AccountMeta::new_readonly(*queue.key, false),
            AccountMeta::new(*oracle.key, false),
            AccountMeta::new_readonly(solana_sdk_ids::sysvar::slot_hashes::ID, false),
            AccountMeta::new_readonly(*authority.key, true),
        ],
        data: RANDOMNESS_COMMIT_DISCRIMINATOR.to_vec(),
    };

    invoke(
        &ix,
        &[
            randomness.clone(),
            queue.clone(),
            oracle.clone(),
            recent_slothashes.clone(),
            authority.clone(),
        ],
    )
    .map_err(|_| error!(LotteryError::RandomnessCommitFailed))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_randomness_account_data(reveal_slot: u64, value: [u8; 32]) -> Vec<u8> {
        encode_randomness_account_data(reveal_slot, value)
    }

    fn make_account_info<'a>(
        key: &'a Pubkey,
        owner: &'a Pubkey,
        lamports: &'a mut u64,
        data: &'a mut [u8],
    ) -> AccountInfo<'a> {
        AccountInfo::new(key, false, true, lamports, data, owner, false)
    }

    #[test]
    fn reads_value_when_revealed_in_current_slot() {
        let key = Pubkey::new_unique();
        let owner = switchboard_on_demand_program_id();
        let value = [7u8; 32];
        let mut lamports = 0u64;
        let mut data = fake_randomness_account_data(100, value);
        let account = make_account_info(&key, &owner, &mut lamports, &mut data);

        let result = read_revealed_value(&account, 100).unwrap();
        assert_eq!(result, value);
    }

    #[test]
    fn rejects_value_from_a_different_slot() {
        let key = Pubkey::new_unique();
        let owner = switchboard_on_demand_program_id();
        let mut lamports = 0u64;
        let mut data = fake_randomness_account_data(100, [7u8; 32]);
        let account = make_account_info(&key, &owner, &mut lamports, &mut data);

        // Reading one slot late (or early) must fail: this is what stops a
        // stale/replayed value from ever being consumed as "the" draw.
        assert!(read_revealed_value(&account, 101).is_err());
    }

    #[test]
    fn rejects_account_not_owned_by_switchboard() {
        let key = Pubkey::new_unique();
        let owner = Pubkey::new_unique();
        let mut lamports = 0u64;
        let mut data = fake_randomness_account_data(100, [7u8; 32]);
        let account = make_account_info(&key, &owner, &mut lamports, &mut data);

        assert!(read_revealed_value(&account, 100).is_err());
    }

    #[test]
    fn rejects_bad_discriminator() {
        let key = Pubkey::new_unique();
        let owner = switchboard_on_demand_program_id();
        let mut lamports = 0u64;
        let mut data = fake_randomness_account_data(100, [7u8; 32]);
        data[0] ^= 0xFF;
        let account = make_account_info(&key, &owner, &mut lamports, &mut data);

        assert!(read_revealed_value(&account, 100).is_err());
    }

    #[test]
    fn rejects_truncated_account() {
        let key = Pubkey::new_unique();
        let owner = switchboard_on_demand_program_id();
        let mut lamports = 0u64;
        let mut data = fake_randomness_account_data(100, [7u8; 32]);
        data.truncate(MIN_ACCOUNT_LEN - 1);
        let account = make_account_info(&key, &owner, &mut lamports, &mut data);

        assert!(read_revealed_value(&account, 100).is_err());
    }
}
