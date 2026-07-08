use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
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
    reserve_token_account: Pubkey,
}

fn setup() -> TestSetup {
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

    // Operator gets reserve funds, users get deposit funds
    MintTo::new(&mut svm, &operator, &mint, &operator_ata, 500_000_000)
        .owner(&operator)
        .send()
        .unwrap();
    MintTo::new(&mut svm, &operator, &mint, &user_a_ata, 1_000_000_000)
        .owner(&operator)
        .send()
        .unwrap();
    MintTo::new(&mut svm, &operator, &mint, &user_b_ata, 1_000_000_000)
        .owner(&operator)
        .send()
        .unwrap();

    let (vault_config, _) = Pubkey::find_program_address(
        &[yield_vault::constants::VAULT_CONFIG_SEED, mint.as_ref()],
        &vault_program_id,
    );
    let vault_token_account = derive_ata(&vault_config, &mint);
    let (reserve_token_account, _) = Pubkey::find_program_address(
        &[yield_vault::constants::RESERVE_SEED, mint.as_ref()],
        &vault_program_id,
    );

    // Initialize vault
    send_ix(
        &mut svm,
        Instruction::new_with_bytes(
            vault_program_id,
            &yield_vault::instruction::InitializeVault {}.data(),
            yield_vault::accounts::InitializeVault {
                admin: operator.pubkey(),
                mint,
                vault_config,
                vault_token_account,
                reserve_token_account,
                token_program: TOKEN_PROGRAM_ID,
                associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        ),
        &operator,
        &[],
    );

    // Initialize batch
    let batch_id: u64 = 1;
    let (batch, _) = Pubkey::find_program_address(
        &[undegen_core::constants::BATCH_SEED, &batch_id.to_le_bytes()],
        &core_program_id,
    );

    send_ix(
        &mut svm,
        Instruction::new_with_bytes(
            core_program_id,
            &undegen_core::instruction::InitializeBatch { batch_id }.data(),
            undegen_core::accounts::InitializeBatch {
                operator: operator.pubkey(),
                mint,
                batch,
                token_program: TOKEN_PROGRAM_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        ),
        &operator,
        &[],
    );

    let batch_token_account = derive_ata(&batch, &mint);
    let (vault_position, _) = Pubkey::find_program_address(
        &[
            yield_vault::constants::POSITION_SEED,
            vault_config.as_ref(),
            batch.as_ref(),
        ],
        &vault_program_id,
    );
    let (user_position_a, _) = Pubkey::find_program_address(
        &[
            undegen_core::constants::USER_POSITION_SEED,
            batch.as_ref(),
            user_a.pubkey().as_ref(),
        ],
        &core_program_id,
    );
    let (user_position_b, _) = Pubkey::find_program_address(
        &[
            undegen_core::constants::USER_POSITION_SEED,
            batch.as_ref(),
            user_b.pubkey().as_ref(),
        ],
        &core_program_id,
    );

    // Both users join
    for (user, user_ata, user_position) in [
        (&user_a, user_a_ata, user_position_a),
        (&user_b, user_b_ata, user_position_b),
    ] {
        let amount: u64 = if user.pubkey() == user_a.pubkey() {
            300_000_000
        } else {
            700_000_000
        };
        send_ix(
            &mut svm,
            Instruction::new_with_bytes(
                core_program_id,
                &undegen_core::instruction::JoinBatch { amount }.data(),
                undegen_core::accounts::JoinBatch {
                    user: user.pubkey(),
                    mint,
                    batch,
                    user_token_account: user_ata,
                    batch_token_account,
                    vault_config,
                    vault_token_account,
                    vault_position,
                    user_position,
                    yield_vault_program: vault_program_id,
                    token_program: TOKEN_PROGRAM_ID,
                    associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
                    system_program: system_program::ID,
                }
                .to_account_metas(None),
            ),
            user,
            &[],
        );
    }

    // Start batch → Locked + baseline snapshot
    send_ix(
        &mut svm,
        Instruction::new_with_bytes(
            core_program_id,
            &undegen_core::instruction::StartBatch {}.data(),
            undegen_core::accounts::StartBatch {
                operator: operator.pubkey(),
                batch,
            }
            .to_account_metas(None),
        ),
        &operator,
        &[],
    );

    // Fund reserve so tick_yield can grow the vault
    send_ix(
        &mut svm,
        Instruction::new_with_bytes(
            vault_program_id,
            &yield_vault::instruction::FundReserve {
                amount: 500_000_000,
            }
            .data(),
            yield_vault::accounts::FundReserve {
                admin: operator.pubkey(),
                vault_config,
                mint,
                reserve_token_account,
                admin_token_account: operator_ata,
                token_program: TOKEN_PROGRAM_ID,
            }
            .to_account_metas(None),
        ),
        &operator,
        &[],
    );

    // Tick yield — generates 5-10% on 1_000_000_000 = 50-100M yield
    send_ix(
        &mut svm,
        Instruction::new_with_bytes(
            vault_program_id,
            &yield_vault::instruction::TickYield {}.data(),
            yield_vault::accounts::TickYield {
                admin: operator.pubkey(),
                vault_config,
                mint,
                vault_token_account,
                reserve_token_account,
                token_program: TOKEN_PROGRAM_ID,
            }
            .to_account_metas(None),
        ),
        &operator,
        &[],
    );

    TestSetup {
        svm,
        operator,
        user_a,
        user_b,
        mint,
        batch,
        vault_config,
        vault_token_account,
        vault_position,
        batch_token_account,
        user_position_a,
        user_position_b,
        reserve_token_account,
    }
}

fn propose_match_ix(setup: &TestSetup, kickoff_timestamp: i64) -> Instruction {
    Instruction::new_with_bytes(
        undegen_core::id(),
        &undegen_core::instruction::ProposeMatch {
            fixture_id: 999_i64,
            kickoff_timestamp,
            odds_numerator: 2, // 2x odds on the yield
            odds_denominator: 1,
            period: 0,
            stat_a_key: 1,
            stat_b_key: None,
            predicate_threshold: 0,
            predicate_comparison: 0,
            negation: false,
        }
        .data(),
        undegen_core::accounts::ProposeMatch {
            operator: setup.operator.pubkey(),
            batch: setup.batch,
            vault_config: setup.vault_config,
            vault_position: setup.vault_position,
        }
        .to_account_metas(None),
    )
}

#[test]
fn test_propose_match() {
    let mut setup = setup();

    let ix = propose_match_ix(&setup, 7200);
    send_ix(&mut setup.svm, ix, &setup.operator, &[]);

    let batch_account = setup.svm.get_account(&setup.batch).unwrap();
    let mut data: &[u8] = &batch_account.data;
    let batch_state = undegen_core::state::Batch::try_deserialize(&mut data).unwrap();

    assert_eq!(batch_state.bet_terms.fixture_id, 999);
    assert_eq!(batch_state.kickoff_timestamp, 7200);
    assert_eq!(batch_state.proof_deadline, 7200 + 3600);
    assert_eq!(batch_state.odds_numerator, 2);
    assert_eq!(batch_state.odds_denominator, 1);
    assert_eq!(batch_state.status, undegen_core::state::BatchStatus::Locked);
    // win_prize = yield × 2 — yield is 5-10% of 1B so win_prize is 100M-200M range
    assert!(batch_state.win_prize > 0, "win_prize should be > 0");
    assert!(
        batch_state.win_prize >= 100_000_000,
        "win_prize below 5% floor"
    );
    assert!(
        batch_state.win_prize <= 200_000_000,
        "win_prize above 10% ceiling"
    );
    assert_eq!(batch_state.collateral_required, batch_state.win_prize);
}

#[test]
fn test_propose_match_non_operator_fails() {
    let mut setup = setup();
    let impostor = Keypair::new();
    setup
        .svm
        .airdrop(&impostor.pubkey(), 1_000_000_000)
        .unwrap();

    let ix = Instruction::new_with_bytes(
        undegen_core::id(),
        &undegen_core::instruction::ProposeMatch {
            fixture_id: 999_i64,
            kickoff_timestamp: 7200,
            odds_numerator: 2,
            odds_denominator: 1,
            period: 0,
            stat_a_key: 1,
            stat_b_key: None,
            predicate_threshold: 0,
            predicate_comparison: 0,
            negation: false,
        }
        .data(),
        undegen_core::accounts::ProposeMatch {
            operator: impostor.pubkey(),
            batch: setup.batch,
            vault_config: setup.vault_config,
            vault_position: setup.vault_position,
        }
        .to_account_metas(None),
    );
    send_ix_should_fail(&mut setup.svm, ix, &impostor);
}

#[test]
fn test_cast_vote_weights() {
    let mut setup = setup();
    let core_program_id = undegen_core::id();

    let ix = propose_match_ix(&setup, 7200);
    send_ix(&mut setup.svm, ix, &setup.operator, &[]);

    // user_a (300) votes yes
    send_ix(
        &mut setup.svm,
        Instruction::new_with_bytes(
            core_program_id,
            &undegen_core::instruction::CastVote { vote_yes: true }.data(),
            undegen_core::accounts::CastVote {
                voter: setup.user_a.pubkey(),
                batch: setup.batch,
                user_position: setup.user_position_a,
            }
            .to_account_metas(None),
        ),
        &setup.user_a,
        &[],
    );

    // user_b (700) votes no
    send_ix(
        &mut setup.svm,
        Instruction::new_with_bytes(
            core_program_id,
            &undegen_core::instruction::CastVote { vote_yes: false }.data(),
            undegen_core::accounts::CastVote {
                voter: setup.user_b.pubkey(),
                batch: setup.batch,
                user_position: setup.user_position_b,
            }
            .to_account_metas(None),
        ),
        &setup.user_b,
        &[],
    );

    let batch_account = setup.svm.get_account(&setup.batch).unwrap();
    let mut data: &[u8] = &batch_account.data;
    let batch_state = undegen_core::state::Batch::try_deserialize(&mut data).unwrap();
    assert_eq!(batch_state.yes_weight, 300_000_000);
    assert_eq!(batch_state.no_weight, 700_000_000);

    // Double vote must fail
    send_ix_should_fail(
        &mut setup.svm,
        Instruction::new_with_bytes(
            core_program_id,
            &undegen_core::instruction::CastVote { vote_yes: true }.data(),
            undegen_core::accounts::CastVote {
                voter: setup.user_a.pubkey(),
                batch: setup.batch,
                user_position: setup.user_position_a,
            }
            .to_account_metas(None),
        ),
        &setup.user_a,
    );
}

#[test]
fn test_finalize_consensus_yes_wins() {
    let mut setup = setup();
    let core_program_id = undegen_core::id();

    let ix = propose_match_ix(&setup, 7200);
    send_ix(&mut setup.svm, ix, &setup.operator, &[]);

    for (voter, position) in [
        (&setup.user_a, setup.user_position_a),
        (&setup.user_b, setup.user_position_b),
    ] {
        send_ix(
            &mut setup.svm,
            Instruction::new_with_bytes(
                core_program_id,
                &undegen_core::instruction::CastVote { vote_yes: true }.data(),
                undegen_core::accounts::CastVote {
                    voter: voter.pubkey(),
                    batch: setup.batch,
                    user_position: position,
                }
                .to_account_metas(None),
            ),
            voter,
            &[],
        );
    }

    set_clock(&mut setup.svm, 3600);

    send_ix(
        &mut setup.svm,
        Instruction::new_with_bytes(
            core_program_id,
            &undegen_core::instruction::FinalizeConsensus {}.data(),
            undegen_core::accounts::FinalizeConsensus { batch: setup.batch }.to_account_metas(None),
        ),
        &setup.operator,
        &[],
    );

    let batch_account = setup.svm.get_account(&setup.batch).unwrap();
    let mut data: &[u8] = &batch_account.data;
    let batch_state = undegen_core::state::Batch::try_deserialize(&mut data).unwrap();
    assert_eq!(
        batch_state.status,
        undegen_core::state::BatchStatus::AwaitingCollateral
    );
}

#[test]
fn test_finalize_consensus_no_votes_skips() {
    let mut setup = setup();
    let core_program_id = undegen_core::id();

    let ix = propose_match_ix(&setup, 7200);
    send_ix(&mut setup.svm, ix, &setup.operator, &[]);

    set_clock(&mut setup.svm, 3600);

    send_ix(
        &mut setup.svm,
        Instruction::new_with_bytes(
            core_program_id,
            &undegen_core::instruction::FinalizeConsensus {}.data(),
            undegen_core::accounts::FinalizeConsensus { batch: setup.batch }.to_account_metas(None),
        ),
        &setup.operator,
        &[],
    );

    let batch_account = setup.svm.get_account(&setup.batch).unwrap();
    let mut data: &[u8] = &batch_account.data;
    let batch_state = undegen_core::state::Batch::try_deserialize(&mut data).unwrap();
    assert_eq!(batch_state.status, undegen_core::state::BatchStatus::Locked);
    assert_eq!(batch_state.kickoff_timestamp, 0);
    assert_eq!(batch_state.win_prize, 0);
}

#[test]
fn test_finalize_consensus_no_wins_skips() {
    let mut setup = setup();
    let core_program_id = undegen_core::id();

    let ix = propose_match_ix(&setup, 7200);
    send_ix(&mut setup.svm, ix, &setup.operator, &[]);

    for (voter, position) in [
        (&setup.user_a, setup.user_position_a),
        (&setup.user_b, setup.user_position_b),
    ] {
        send_ix(
            &mut setup.svm,
            Instruction::new_with_bytes(
                core_program_id,
                &undegen_core::instruction::CastVote { vote_yes: false }.data(),
                undegen_core::accounts::CastVote {
                    voter: voter.pubkey(),
                    batch: setup.batch,
                    user_position: position,
                }
                .to_account_metas(None),
            ),
            voter,
            &[],
        );
    }

    set_clock(&mut setup.svm, 3600);

    send_ix(
        &mut setup.svm,
        Instruction::new_with_bytes(
            core_program_id,
            &undegen_core::instruction::FinalizeConsensus {}.data(),
            undegen_core::accounts::FinalizeConsensus { batch: setup.batch }.to_account_metas(None),
        ),
        &setup.operator,
        &[],
    );

    let batch_account = setup.svm.get_account(&setup.batch).unwrap();
    let mut data: &[u8] = &batch_account.data;
    let batch_state = undegen_core::state::Batch::try_deserialize(&mut data).unwrap();
    assert_eq!(batch_state.status, undegen_core::state::BatchStatus::Locked);
    assert_eq!(batch_state.kickoff_timestamp, 0);
}
