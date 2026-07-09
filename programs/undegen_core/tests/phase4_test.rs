use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, AnchorSerialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::associated_token::ID as ASSOCIATED_TOKEN_PROGRAM_ID,
    anchor_spl::token::ID as TOKEN_PROGRAM_ID,
    litesvm::LiteSVM,
    litesvm_token::{CreateAccount, CreateMint, MintTo},
    solana_clock::Clock,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

use anchor_lang::solana_program::program_pack::Pack;
use litesvm_token::spl_token::state::Account as SplTokenAccount;

fn send_ix(svm: &mut LiteSVM, ix: Instruction, payer: &Keypair, extra_signers: &[&Keypair]) {
    let blockhash = svm.latest_blockhash();
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend(extra_signers);
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers).unwrap();
    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "transaction failed: {:?}", res.err());
}

fn send_ix_should_fail(svm: &mut LiteSVM, ix: Instruction, payer: &Keypair) {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(res.is_err(), "transaction should have failed but succeeded");
}

fn derive_ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), TOKEN_PROGRAM_ID.as_ref(), mint.as_ref()],
        &ASSOCIATED_TOKEN_PROGRAM_ID,
    )
    .0
}

fn set_clock(svm: &mut LiteSVM, unix_timestamp: i64) {
    svm.set_sysvar(&Clock {
        slot: 100,
        epoch_start_timestamp: 0,
        epoch: 0,
        leader_schedule_epoch: 0,
        unix_timestamp,
    });
}

fn token_balance(svm: &LiteSVM, token_account: &Pubkey) -> u64 {
    match svm.get_account(token_account) {
        Some(acc) => SplTokenAccount::unpack(&acc.data).map(|a| a.amount).unwrap_or(0),
        None => 0,
    }
}

const KICKOFF_TS: i64 = 7200;

#[allow(dead_code)]
struct TestSetup {
    svm: LiteSVM,
    operator: Keypair,
    user_a: Keypair,
    user_b: Keypair,
    mint: Pubkey,
    batch: Pubkey,
    vault_config: Pubkey,
    vault_token_account: Pubkey,
    vault_position: Pubkey,
    batch_token_account: Pubkey,
    user_position_a: Pubkey,
    user_position_b: Pubkey,
    operator_ata: Pubkey,
    user_a_ata: Pubkey,
    user_b_ata: Pubkey,
    reserve_token_account: Pubkey,
    collateral_token_account: Pubkey,
    protocol_config: Pubkey,
    bet_size: u64,
}

fn setup_active() -> TestSetup {
    let core_program_id = undegen_core::id();
    let vault_program_id = yield_vault::id();
    let operator = Keypair::new();
    let user_a = Keypair::new();
    let user_b = Keypair::new();

    let mut svm = LiteSVM::new();

    let core_bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/undegen_core.so"
    ));
    let vault_bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/yield_vault.so"
    ));
    svm.add_program(core_program_id, core_bytes).unwrap();
    svm.add_program(vault_program_id, vault_bytes).unwrap();

    svm.airdrop(&operator.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&user_a.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&user_b.pubkey(), 10_000_000_000).unwrap();

    let mint = CreateMint::new(&mut svm, &operator)
        .authority(&operator.pubkey())
        .decimals(6)
        .send()
        .unwrap();

    let operator_ata = CreateAccount::new(&mut svm, &operator, &mint)
        .owner(&operator.pubkey()).send().unwrap();
    let user_a_ata = CreateAccount::new(&mut svm, &user_a, &mint)
        .owner(&user_a.pubkey()).send().unwrap();
    let user_b_ata = CreateAccount::new(&mut svm, &user_b, &mint)
        .owner(&user_b.pubkey()).send().unwrap();

    MintTo::new(&mut svm, &operator, &mint, &operator_ata, 2_000_000_000)
        .owner(&operator).send().unwrap();
    MintTo::new(&mut svm, &operator, &mint, &user_a_ata, 1_000_000_000)
        .owner(&operator).send().unwrap();
    MintTo::new(&mut svm, &operator, &mint, &user_b_ata, 1_000_000_000)
        .owner(&operator).send().unwrap();

    let (vault_config, _) = Pubkey::find_program_address(
        &[yield_vault::constants::VAULT_CONFIG_SEED, mint.as_ref()],
        &vault_program_id,
    );
    let vault_token_account = derive_ata(&vault_config, &mint);
    let (reserve_token_account, _) = Pubkey::find_program_address(
        &[yield_vault::constants::RESERVE_SEED, mint.as_ref()],
        &vault_program_id,
    );

    send_ix(&mut svm, Instruction::new_with_bytes(
        vault_program_id,
        &yield_vault::instruction::InitializeVault {}.data(),
        yield_vault::accounts::InitializeVault {
            admin: operator.pubkey(), mint, vault_config, vault_token_account,
            reserve_token_account, token_program: TOKEN_PROGRAM_ID,
            associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
            system_program: system_program::ID,
        }.to_account_metas(None),
    ), &operator, &[]);

    let (protocol_config, _) = Pubkey::find_program_address(
        &[undegen_core::constants::PROTOCOL_CONFIG_SEED],
        &core_program_id,
    );
    send_ix(&mut svm, Instruction::new_with_bytes(
        core_program_id,
        &undegen_core::instruction::InitializeProtocol {}.data(),
        undegen_core::accounts::InitializeProtocol {
            admin: operator.pubkey(),
            config: protocol_config,
            system_program: system_program::ID,
        }.to_account_metas(None),
    ), &operator, &[]);

    let batch_id: u64 = 1;
    let (batch, _) = Pubkey::find_program_address(
        &[undegen_core::constants::BATCH_SEED, &batch_id.to_le_bytes()],
        &core_program_id,
    );
    send_ix(&mut svm, Instruction::new_with_bytes(
        core_program_id,
        &undegen_core::instruction::InitializeBatch { apy_bps: 500 }.data(),
        undegen_core::accounts::InitializeBatch {
            operator: operator.pubkey(), mint, config: protocol_config, batch,
            token_program: TOKEN_PROGRAM_ID, system_program: system_program::ID,
        }.to_account_metas(None),
    ), &operator, &[]);

    let batch_token_account = derive_ata(&batch, &mint);
    let (vault_position, _) = Pubkey::find_program_address(
        &[yield_vault::constants::POSITION_SEED, vault_config.as_ref(), batch.as_ref()],
        &vault_program_id,
    );
    let (user_position_a, _) = Pubkey::find_program_address(
        &[undegen_core::constants::USER_POSITION_SEED, batch.as_ref(), user_a.pubkey().as_ref()],
        &core_program_id,
    );
    let (user_position_b, _) = Pubkey::find_program_address(
        &[undegen_core::constants::USER_POSITION_SEED, batch.as_ref(), user_b.pubkey().as_ref()],
        &core_program_id,
    );

    for (user, user_ata, user_position) in [
        (&user_a, user_a_ata, user_position_a),
        (&user_b, user_b_ata, user_position_b),
    ] {
        let amount = if user.pubkey() == user_a.pubkey() { 300_000_000u64 } else { 700_000_000u64 };
        send_ix(&mut svm, Instruction::new_with_bytes(
            core_program_id,
            &undegen_core::instruction::JoinBatch { amount }.data(),
            undegen_core::accounts::JoinBatch {
                user: user.pubkey(), mint, batch,
                user_token_account: user_ata, batch_token_account,
                vault_config, vault_token_account, vault_position, user_position,
                yield_vault_program: vault_program_id, token_program: TOKEN_PROGRAM_ID,
                associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
                system_program: system_program::ID,
            }.to_account_metas(None),
        ), user, &[]);
    }

    send_ix(&mut svm, Instruction::new_with_bytes(
        core_program_id,
        &undegen_core::instruction::StartBatch {}.data(),
        undegen_core::accounts::StartBatch { operator: operator.pubkey(), batch }
            .to_account_metas(None),
    ), &operator, &[]);

    let batch_account = svm.get_account(&batch).unwrap();
    let mut data: &[u8] = &batch_account.data;
    let batch_state = undegen_core::state::Batch::try_deserialize(&mut data).unwrap();
    let bet_size = batch_state.bet_size;

    send_ix(&mut svm, Instruction::new_with_bytes(
        core_program_id,
        &undegen_core::instruction::ProposeMatch {
            fixture_id: 999_i64, kickoff_timestamp: KICKOFF_TS,
            period: 0, stat_a_key: 1, stat_b_key: None,
            predicate_threshold: 0, predicate_comparison: 0, negation: false,
        }.data(),
        undegen_core::accounts::ProposeMatch {
            operator: operator.pubkey(), batch,
        }.to_account_metas(None),
    ), &operator, &[]);

    for (voter, position) in [(&user_a, user_position_a), (&user_b, user_position_b)] {
        send_ix(&mut svm, Instruction::new_with_bytes(
            core_program_id,
            &undegen_core::instruction::CastVote { vote_yes: true }.data(),
            undegen_core::accounts::CastVote {
                voter: voter.pubkey(), batch, user_position: position,
            }.to_account_metas(None),
        ), voter, &[]);
    }

    set_clock(&mut svm, 3600);
    send_ix(&mut svm, Instruction::new_with_bytes(
        core_program_id,
        &undegen_core::instruction::FinalizeConsensus {}.data(),
        undegen_core::accounts::FinalizeConsensus { batch }.to_account_metas(None),
    ), &operator, &[]);

    let (collateral_token_account, _) = Pubkey::find_program_address(
        &[undegen_core::constants::COLLATERAL_SEED, batch.as_ref()],
        &core_program_id,
    );
    send_ix(&mut svm, Instruction::new_with_bytes(
        core_program_id,
        &undegen_core::instruction::DepositCollateral { amount: bet_size }.data(),
        undegen_core::accounts::DepositCollateral {
            operator: operator.pubkey(), mint, batch,
            operator_token_account: operator_ata,
            collateral_token_account,
            token_program: TOKEN_PROGRAM_ID, system_program: system_program::ID,
        }.to_account_metas(None),
    ), &operator, &[]);

    let batch_account = svm.get_account(&batch).unwrap();
    let mut data: &[u8] = &batch_account.data;
    let batch_state = undegen_core::state::Batch::try_deserialize(&mut data).unwrap();
    assert_eq!(batch_state.status, undegen_core::state::BatchStatus::Active);

    TestSetup {
        svm, operator, user_a, user_b, mint, batch,
        vault_config, vault_token_account, vault_position,
        batch_token_account, user_position_a, user_position_b,
        operator_ata, user_a_ata, user_b_ata,
        reserve_token_account, collateral_token_account,
        protocol_config, bet_size,
    }
}

fn claim_ix(setup: &TestSetup, user: &Keypair, user_ata: Pubkey, user_position: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        undegen_core::id(),
        &undegen_core::instruction::Claim {}.data(),
        undegen_core::accounts::Claim {
            user: user.pubkey(),
            mint: setup.mint,
            batch: setup.batch,
            user_position,
            user_token_account: user_ata,
            batch_token_account: setup.batch_token_account,
            vault_config: setup.vault_config,
            vault_token_account: setup.vault_token_account,
            vault_position: setup.vault_position,
            yield_vault_program: yield_vault::id(),
            token_program: TOKEN_PROGRAM_ID,
            associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
            system_program: system_program::ID,
        }.to_account_metas(None),
    )
}

/// Force batch to Settled via god-mode set_account
fn force_settle(svm: &mut LiteSVM, batch: Pubkey) {
    let batch_account = svm.get_account(&batch).unwrap();
    let discriminator = batch_account.data[..8].to_vec();
    let mut data_slice: &[u8] = &batch_account.data;
    let mut batch_state = undegen_core::state::Batch::try_deserialize(&mut data_slice).unwrap();
    batch_state.status = undegen_core::state::BatchStatus::Settled;
    batch_state.bets_completed = 5;
    let mut new_data = vec![0u8; batch_account.data.len()];
    new_data[..8].copy_from_slice(&discriminator);
    let mut cursor = std::io::Cursor::new(&mut new_data[8..]);
    batch_state.serialize(&mut cursor).unwrap();
    let mut new_account = batch_account.clone();
    new_account.data = new_data;
    svm.set_account(batch, new_account).unwrap();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[test]
fn test_claim_after_settle_default() {
    let mut setup = setup_active();

    setup.svm.warp_to_slot(500);
    setup.svm.set_sysvar(&Clock {
        slot: 500,
        epoch_start_timestamp: 0,
        epoch: 0,
        leader_schedule_epoch: 0,
        unix_timestamp: KICKOFF_TS + 3600 + 1,
    });

    let batch_ata = derive_ata(&setup.batch, &setup.mint);
    send_ix(&mut setup.svm, Instruction::new_with_bytes(
        undegen_core::id(),
        &undegen_core::instruction::SettleDefault {}.data(),
        undegen_core::accounts::SettleDefault {
            mint: setup.mint,
            batch: setup.batch,
            collateral_token_account: setup.collateral_token_account,
            batch_token_account: batch_ata,
            token_program: TOKEN_PROGRAM_ID,
            associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
        }.to_account_metas(None),
    ), &setup.operator, &[]);

    let batch_account = setup.svm.get_account(&setup.batch).unwrap();
    let mut data: &[u8] = &batch_account.data;
    let batch_state = undegen_core::state::Batch::try_deserialize(&mut data).unwrap();

    assert_eq!(batch_state.bets_completed, 1);
    assert_eq!(batch_state.operator_yield_bps, 8000); // slashed 20%
    assert_eq!(batch_state.status, undegen_core::state::BatchStatus::Locked);

    // Force to Settled so we can test claim
    force_settle(&mut setup.svm, setup.batch);

    let user_a_before = token_balance(&setup.svm, &setup.user_a_ata);
    let user_b_before = token_balance(&setup.svm, &setup.user_b_ata);

    let ix = claim_ix(&setup, &setup.user_a, setup.user_a_ata, setup.user_position_a);
    send_ix(&mut setup.svm, ix, &setup.user_a, &[]);

    let ix = claim_ix(&setup, &setup.user_b, setup.user_b_ata, setup.user_position_b);
    send_ix(&mut setup.svm, ix, &setup.user_b, &[]);

    let user_a_received = token_balance(&setup.svm, &setup.user_a_ata) - user_a_before;
    let user_b_received = token_balance(&setup.svm, &setup.user_b_ata) - user_b_before;

    assert!(user_a_received > 0, "user_a should receive tokens");
    assert!(user_b_received > 0, "user_b should receive tokens");

    // user_b deposited 7/3 more than user_a
    let ratio = user_b_received as f64 / user_a_received as f64;
    assert!(ratio > 2.2 && ratio < 2.5,
        "ratio should be ~7/3=2.33, got {:.2}", ratio);

    println!("user_a: {} user_b: {} ratio: {:.2}", user_a_received, user_b_received, ratio);
}

#[test]
fn test_claim_double_claim_fails() {
    let mut setup = setup_active();
    force_settle(&mut setup.svm, setup.batch);

    let ix = claim_ix(&setup, &setup.user_a, setup.user_a_ata, setup.user_position_a);
    send_ix(&mut setup.svm, ix, &setup.user_a, &[]);

    let ix = claim_ix(&setup, &setup.user_a, setup.user_a_ata, setup.user_position_a);
    send_ix_should_fail(&mut setup.svm, ix, &setup.user_a);
}

#[test]
fn test_claim_before_settled_fails() {
    let mut setup = setup_active();
    let ix = claim_ix(&setup, &setup.user_a, setup.user_a_ata, setup.user_position_a);
    send_ix_should_fail(&mut setup.svm, ix, &setup.user_a);
}

#[test]
fn test_settle_default_increments_bets_completed() {
    let mut setup = setup_active();

    setup.svm.warp_to_slot(500);
    setup.svm.set_sysvar(&Clock {
        slot: 500,
        epoch_start_timestamp: 0,
        epoch: 0,
        leader_schedule_epoch: 0,
        unix_timestamp: KICKOFF_TS + 3600 + 1,
    });

    let batch_ata = derive_ata(&setup.batch, &setup.mint);
    send_ix(&mut setup.svm, Instruction::new_with_bytes(
        undegen_core::id(),
        &undegen_core::instruction::SettleDefault {}.data(),
        undegen_core::accounts::SettleDefault {
            mint: setup.mint,
            batch: setup.batch,
            collateral_token_account: setup.collateral_token_account,
            batch_token_account: batch_ata,
            token_program: TOKEN_PROGRAM_ID,
            associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
        }.to_account_metas(None),
    ), &setup.operator, &[]);

    let batch_account = setup.svm.get_account(&setup.batch).unwrap();
    let mut data: &[u8] = &batch_account.data;
    let batch_state = undegen_core::state::Batch::try_deserialize(&mut data).unwrap();

    assert_eq!(batch_state.bets_completed, 1);
    assert_eq!(batch_state.operator_yield_bps, 8000); // slashed 20%
    assert_eq!(batch_state.status, undegen_core::state::BatchStatus::Locked);
    assert_eq!(batch_state.kickoff_timestamp, 0);
    assert_eq!(batch_state.win_prize, 0);
}