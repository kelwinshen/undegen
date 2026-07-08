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

/// Sets clock with a unique slot to avoid AlreadyProcessed dedup
fn set_clock_at(svm: &mut LiteSVM, slot: u64, unix_timestamp: i64) {
    svm.set_sysvar(&Clock {
        slot,
        epoch_start_timestamp: 0,
        epoch: 0,
        leader_schedule_epoch: 0,
        unix_timestamp,
    });
}

/// Convenience wrapper using slot=100 for single-use calls
fn set_clock(svm: &mut LiteSVM, unix_timestamp: i64) {
    set_clock_at(svm, 100, unix_timestamp);
}

fn token_balance(svm: &LiteSVM, token_account: &Pubkey) -> u64 {
    match svm.get_account(token_account) {
        Some(acc) => SplTokenAccount::unpack(&acc.data)
            .map(|a| a.amount)
            .unwrap_or(0),
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
    win_prize: u64,
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

    MintTo::new(&mut svm, &operator, &mint, &operator_ata, 2_000_000_000)
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

    for (user, user_ata, user_position) in [
        (&user_a, user_a_ata, user_position_a),
        (&user_b, user_b_ata, user_position_b),
    ] {
        let amount = if user.pubkey() == user_a.pubkey() {
            300_000_000u64
        } else {
            700_000_000u64
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

    send_ix(
        &mut svm,
        Instruction::new_with_bytes(
            core_program_id,
            &undegen_core::instruction::ProposeMatch {
                fixture_id: 999_i64,
                kickoff_timestamp: KICKOFF_TS,
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
                operator: operator.pubkey(),
                batch,
                vault_config,
                vault_position,
            }
            .to_account_metas(None),
        ),
        &operator,
        &[],
    );

    for (voter, position) in [(&user_a, user_position_a), (&user_b, user_position_b)] {
        send_ix(
            &mut svm,
            Instruction::new_with_bytes(
                core_program_id,
                &undegen_core::instruction::CastVote { vote_yes: true }.data(),
                undegen_core::accounts::CastVote {
                    voter: voter.pubkey(),
                    batch,
                    user_position: position,
                }
                .to_account_metas(None),
            ),
            voter,
            &[],
        );
    }

    set_clock(&mut svm, 3600);
    send_ix(
        &mut svm,
        Instruction::new_with_bytes(
            core_program_id,
            &undegen_core::instruction::FinalizeConsensus {}.data(),
            undegen_core::accounts::FinalizeConsensus { batch }.to_account_metas(None),
        ),
        &operator,
        &[],
    );

    let batch_account = svm.get_account(&batch).unwrap();
    let mut data: &[u8] = &batch_account.data;
    let batch_state = undegen_core::state::Batch::try_deserialize(&mut data).unwrap();
    assert_eq!(
        batch_state.status,
        undegen_core::state::BatchStatus::AwaitingCollateral,
        "setup failed: expected AwaitingCollateral"
    );
    let win_prize = batch_state.win_prize;

    let (collateral_token_account, _) = Pubkey::find_program_address(
        &[undegen_core::constants::COLLATERAL_SEED, batch.as_ref()],
        &core_program_id,
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
        operator_ata,
        reserve_token_account,
        collateral_token_account,
        win_prize,
    }
}

fn deposit_collateral_ix(setup: &TestSetup) -> Instruction {
    Instruction::new_with_bytes(
        undegen_core::id(),
        &undegen_core::instruction::DepositCollateral {
            amount: setup.win_prize,
        }
        .data(),
        undegen_core::accounts::DepositCollateral {
            operator: setup.operator.pubkey(),
            mint: setup.mint,
            batch: setup.batch,
            operator_token_account: setup.operator_ata,
            collateral_token_account: setup.collateral_token_account,
            token_program: TOKEN_PROGRAM_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
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

    assert_eq!(batch_state.status, undegen_core::state::BatchStatus::Active);
    assert_eq!(batch_state.collateral_deposited, setup.win_prize);
    assert_eq!(batch_state.proof_deadline, KICKOFF_TS + 3600);
    assert_eq!(
        token_balance(&setup.svm, &setup.collateral_token_account),
        setup.win_prize
    );
    assert_eq!(
        operator_balance_before - token_balance(&setup.svm, &setup.operator_ata),
        setup.win_prize
    );
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
    setup
        .svm
        .airdrop(&impostor.pubkey(), 1_000_000_000)
        .unwrap();
    let impostor_ata = CreateAccount::new(&mut setup.svm, &impostor, &setup.mint)
        .owner(&impostor.pubkey())
        .send()
        .unwrap();
    MintTo::new(
        &mut setup.svm,
        &setup.operator,
        &setup.mint,
        &impostor_ata,
        setup.win_prize,
    )
    .owner(&setup.operator)
    .send()
    .unwrap();

    send_ix_should_fail(
        &mut setup.svm,
        Instruction::new_with_bytes(
            undegen_core::id(),
            &undegen_core::instruction::DepositCollateral {
                amount: setup.win_prize,
            }
            .data(),
            undegen_core::accounts::DepositCollateral {
                operator: impostor.pubkey(),
                mint: setup.mint,
                batch: setup.batch,
                operator_token_account: impostor_ata,
                collateral_token_account: setup.collateral_token_account,
                token_program: TOKEN_PROGRAM_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        ),
        &impostor,
    );
}

#[test]
fn test_penalize_missed_collateral() {
    let mut setup = setup_awaiting_collateral();
    set_clock(&mut setup.svm, KICKOFF_TS);

    send_ix(
        &mut setup.svm,
        Instruction::new_with_bytes(
            undegen_core::id(),
            &undegen_core::instruction::PenalizeMissedCollateral {}.data(),
            undegen_core::accounts::PenalizeMissedCollateral { batch: setup.batch }
                .to_account_metas(None),
        ),
        &setup.operator,
        &[],
    );

    let batch_account = setup.svm.get_account(&setup.batch).unwrap();
    let mut data: &[u8] = &batch_account.data;
    let batch_state = undegen_core::state::Batch::try_deserialize(&mut data).unwrap();

    assert_eq!(batch_state.status, undegen_core::state::BatchStatus::Locked);
    assert_eq!(batch_state.commission_bps, 1000); // unchanged
    assert_eq!(batch_state.kickoff_timestamp, 0);
    assert_eq!(batch_state.win_prize, 0);
    assert_eq!(batch_state.yes_weight, 0);
    assert_eq!(batch_state.no_weight, 0);
    assert_eq!(batch_state.collateral_required, 0);
}

#[test]
fn test_penalize_before_deadline_fails() {
    let mut setup = setup_awaiting_collateral();
    send_ix_should_fail(
        &mut setup.svm,
        Instruction::new_with_bytes(
            undegen_core::id(),
            &undegen_core::instruction::PenalizeMissedCollateral {}.data(),
            undegen_core::accounts::PenalizeMissedCollateral { batch: setup.batch }
                .to_account_metas(None),
        ),
        &setup.operator,
    );
}
