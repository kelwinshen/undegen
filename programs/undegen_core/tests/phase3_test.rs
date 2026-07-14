use {
    anchor_lang::{
        AccountDeserialize, InstructionData, ToAccountMetas, prelude::Pubkey, solana_program::{instruction::Instruction, system_program},
    }, anchor_spl::{associated_token::ID as ASSOCIATED_TOKEN_PROGRAM_ID, token::ID as TOKEN_PROGRAM_ID}, litesvm::LiteSVM, litesvm_token::{CreateAccount, CreateMint, MintTo}, solana_clock::Clock, solana_keypair::Keypair, solana_message::{Message, VersionedMessage}, solana_signer::Signer, solana_transaction::versioned::VersionedTransaction, undegen_core::txodds_types::{Odds, OddsBatchSummary, OddsUpdateStats, TraderPredicate},
};

use anchor_lang::solana_program::program_pack::Pack;
use litesvm_token::spl_token::state::Account as SplTokenAccount;

// Define the TxOdds Program ID constant here for the address constraint
const TXODDS_PROGRAM_ID: Pubkey = 
    anchor_lang::solana_program::pubkey::pubkey!("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");

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

fn set_clock_at(svm: &mut LiteSVM, slot: u64, unix_timestamp: i64) {
    svm.set_sysvar(&Clock {
        slot,
        epoch_start_timestamp: 0,
        epoch: 0,
        leader_schedule_epoch: 0,
        unix_timestamp,
    });
}

fn set_clock(svm: &mut LiteSVM, unix_timestamp: i64) {
    set_clock_at(svm, 100, unix_timestamp);
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
    reserve_token_account: Pubkey,
    collateral_token_account: Pubkey,
    protocol_config: Pubkey,
    bet_size: u64,
}

// Helper to generate the 4-item BetTerms array
fn generate_mock_bet_terms() -> [undegen_core::state::BetTerms; 4] {
    [
        undegen_core::state::BetTerms { fixture_id: 999_i64, period: 0, stat_a_key: 1, stat_b_key: None, predicate: TraderPredicate::default(), negation: false, op: None },
        undegen_core::state::BetTerms { fixture_id: 999_i64, period: 0, stat_a_key: 2, stat_b_key: None,predicate: TraderPredicate::default(), negation: false,  op: None },
        undegen_core::state::BetTerms { fixture_id: 999_i64, period: 0, stat_a_key: 3, stat_b_key: None, predicate: TraderPredicate::default(), negation: false,  op: None },
        undegen_core::state::BetTerms { fixture_id: 999_i64, period: 0, stat_a_key: 4, stat_b_key: None, predicate: TraderPredicate::default(), negation: false,  op: None },
    ]
}

// Helper to generate dummy TxOdds payloads
fn generate_dummy_odds() -> Odds {
    Odds {
        fixture_id: 999,
        message_id: "mock".to_string(),
        ts: KICKOFF_TS,
        bookmaker: "mock".to_string(),
        bookmaker_id: 1,
        super_odds_type: "none".to_string(),
        game_state: None,
        in_running: false,
        market_parameters: None,
        market_period: None,
        price_names: vec!["1X2_1".to_string()],
        prices: vec![25000], // 2.50 odds scaled by 10,000
    }
}

fn generate_dummy_summary() -> OddsBatchSummary {
    OddsBatchSummary {
        fixture_id: 999,
        update_stats: OddsUpdateStats { update_count: 1, min_timestamp: 0, max_timestamp: 0 },
        odds_sub_tree_root: [0; 32],
    }
}

fn setup_awaiting_collateral() -> TestSetup {
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
        .owner(&operator.pubkey())
        .send()
        .unwrap();
    let user_a_ata = CreateAccount::new(&mut svm, &user_a, &mint)
        .owner(&user_a.pubkey())
        .send()
        .unwrap();
    let user_b_ata = CreateAccount::new(&mut svm, &user_b, &mint)
        .owner(&user_b.pubkey())
        .send()
        .unwrap();

    MintTo::new(&mut svm, &operator, &mint, &operator_ata, 2_000_000_000).owner(&operator).send().unwrap();
    MintTo::new(&mut svm, &operator, &mint, &user_a_ata, 1_000_000_000).owner(&operator).send().unwrap();
    MintTo::new(&mut svm, &operator, &mint, &user_b_ata, 1_000_000_000).owner(&operator).send().unwrap();

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

    // Use Array format for propose_match
    send_ix(&mut svm, Instruction::new_with_bytes(
        core_program_id,
        &undegen_core::instruction::ProposeMatch {
            bet_terms_array: generate_mock_bet_terms(), 
            kickoff_timestamp: KICKOFF_TS,
        }.data(),
        undegen_core::accounts::ProposeMatch {
            operator: operator.pubkey(), batch,
        }.to_account_metas(None),
    ), &operator, &[]);

    // Both users vote for Index 4 (Skip Match) to bypass TxOdds CPI in LiteSVM
    for (voter, position) in [(&user_a, user_position_a), (&user_b, user_position_b)] {
        send_ix(&mut svm, Instruction::new_with_bytes(
            core_program_id,
            &undegen_core::instruction::CastVote { vote_index: 4 }.data(),
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

    let batch_account = svm.get_account(&batch).unwrap();
    let mut data: &[u8] = &batch_account.data;
    let batch_state = undegen_core::state::Batch::try_deserialize(&mut data).unwrap();
    assert_eq!(batch_state.status, undegen_core::state::BatchStatus::AwaitingCollateral, "setup failed");

    let (collateral_token_account, _) = Pubkey::find_program_address(
        &[undegen_core::constants::COLLATERAL_SEED, batch.as_ref()],
        &core_program_id,
    );

    TestSetup {
        svm, operator, user_a, user_b, mint, batch,
        vault_config, vault_token_account, vault_position,
        batch_token_account, user_position_a, user_position_b,
        operator_ata, reserve_token_account, collateral_token_account,
        protocol_config, bet_size,
    }
}

fn deposit_collateral_ix(setup: &TestSetup) -> Instruction {
    Instruction::new_with_bytes(
        undegen_core::id(),
        &undegen_core::instruction::DepositCollateral {
            amount: setup.bet_size,
            oracle_price_index: 0,
            odds_snapshot: generate_dummy_odds(),
            summary: generate_dummy_summary(),
            sub_tree_proof: vec![],
            main_tree_proof: vec![]
        }.data(),
        undegen_core::accounts::DepositCollateral {
            operator: setup.operator.pubkey(), mint: setup.mint, batch: setup.batch,
            operator_token_account: setup.operator_ata,
            collateral_token_account: setup.collateral_token_account,
            batch_token_account: setup.batch_token_account,
            daily_odds_merkle_roots: Pubkey::new_unique(), // Dummy since CPI is bypassed for Skip
            txodds_program: TXODDS_PROGRAM_ID,
            token_program: TOKEN_PROGRAM_ID,
            associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
            system_program: system_program::ID,
        }.to_account_metas(None),
    )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[test]
fn test_deposit_collateral_success() {
    let mut setup = setup_awaiting_collateral();
    let operator_balance_before = token_balance(&setup.svm, &setup.operator_ata);

    let ix = deposit_collateral_ix(&setup);
    send_ix(&mut setup.svm, ix, &setup.operator, &[]);

    let batch_account = setup.svm.get_account(&setup.batch).unwrap();
    let mut data: &[u8] = &batch_account.data;
    let batch_state = undegen_core::state::Batch::try_deserialize(&mut data).unwrap();

    // Skip auto-settles inside deposit_collateral — collateral moves through
    // to batch_token_account for user claim, batch returns to Locked for next bet
    assert_eq!(batch_state.status, undegen_core::state::BatchStatus::Locked);
    assert_eq!(batch_state.bets_completed, 1);
    assert_eq!(
        operator_balance_before - token_balance(&setup.svm, &setup.operator_ata),
        setup.bet_size
    );
    assert_eq!(
        token_balance(&setup.svm, &setup.batch_token_account),
        setup.bet_size
    );
    assert_eq!(token_balance(&setup.svm, &setup.collateral_token_account), 0);
}

#[test]
fn test_deposit_collateral_double_deposit_fails() {
    let mut setup = setup_awaiting_collateral();
    let ix = deposit_collateral_ix(&setup);
    send_ix(&mut setup.svm, ix, &setup.operator, &[]);
    let ix = deposit_collateral_ix(&setup);
    send_ix_should_fail(&mut setup.svm, ix, &setup.operator);
}


#[test]
fn test_deposit_collateral_non_operator_fails() {
    let mut setup = setup_awaiting_collateral();
    let impostor = Keypair::new();
    setup.svm.airdrop(&impostor.pubkey(), 1_000_000_000).unwrap();
    let impostor_ata = CreateAccount::new(&mut setup.svm, &impostor, &setup.mint)
        .owner(&impostor.pubkey()).send().unwrap();
    MintTo::new(&mut setup.svm, &setup.operator, &setup.mint, &impostor_ata, setup.bet_size)
        .owner(&setup.operator).send().unwrap();

    send_ix_should_fail(&mut setup.svm, Instruction::new_with_bytes(
        undegen_core::id(),
        &undegen_core::instruction::DepositCollateral {
            amount: setup.bet_size,
            oracle_price_index: 0,
            odds_snapshot: generate_dummy_odds(),
            summary: generate_dummy_summary(),
            sub_tree_proof: vec![],
            main_tree_proof: vec![]
        }.data(),
        undegen_core::accounts::DepositCollateral {
            operator: impostor.pubkey(), mint: setup.mint, batch: setup.batch,
            operator_token_account: impostor_ata,
            collateral_token_account: setup.collateral_token_account,
            batch_token_account: setup.batch_token_account,
            daily_odds_merkle_roots: Pubkey::new_unique(),
            txodds_program: TXODDS_PROGRAM_ID,
            token_program: TOKEN_PROGRAM_ID,
            associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
            system_program: system_program::ID,
        }.to_account_metas(None),
    ), &impostor);
}

#[test]
fn test_penalize_missed_collateral() {
    let mut setup = setup_awaiting_collateral();
    set_clock(&mut setup.svm, KICKOFF_TS);

    send_ix(&mut setup.svm, Instruction::new_with_bytes(
        undegen_core::id(),
        &undegen_core::instruction::PenalizeMissedCollateral {}.data(),
        undegen_core::accounts::PenalizeMissedCollateral { batch: setup.batch }
            .to_account_metas(None),
    ), &setup.operator, &[]);

    let batch_account = setup.svm.get_account(&setup.batch).unwrap();
    let mut data: &[u8] = &batch_account.data;
    let batch_state = undegen_core::state::Batch::try_deserialize(&mut data).unwrap();

    assert_eq!(batch_state.status, undegen_core::state::BatchStatus::Locked);
    assert_eq!(batch_state.operator_yield_bps, 8000); 
    assert_eq!(batch_state.kickoff_timestamp, 0);
    assert_eq!(batch_state.win_prize, 0);
    
    // Updated Assertions for Multi-Option Array
    assert_eq!(batch_state.vote_weights, [0; 5]);
    assert_eq!(batch_state.winning_vote_index, None);
    
    assert_eq!(batch_state.collateral_required, 0);
    assert_eq!(batch_state.bets_completed, 0);
}

#[test]
fn test_penalize_before_deadline_fails() {
    let mut setup = setup_awaiting_collateral();
    send_ix_should_fail(&mut setup.svm, Instruction::new_with_bytes(
        undegen_core::id(),
        &undegen_core::instruction::PenalizeMissedCollateral {}.data(),
        undegen_core::accounts::PenalizeMissedCollateral { batch: setup.batch }
            .to_account_metas(None),
    ), &setup.operator);
}