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

fn token_balance(svm: &LiteSVM, token_account: &Pubkey) -> u64 {
    match svm.get_account(token_account) {
        Some(acc) => SplTokenAccount::unpack(&acc.data).map(|a| a.amount).unwrap_or(0),
        None => 0,
    }
}

#[test]
fn test_phase1_initialize_join_leave() {
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

    // --- Mock USDC mint ---
    let mint = CreateMint::new(&mut svm, &operator)
        .authority(&operator.pubkey())
        .decimals(6)
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

    MintTo::new(&mut svm, &operator, &mint, &user_a_ata, 1_000_000_000)
        .owner(&operator)
        .send()
        .unwrap();
    MintTo::new(&mut svm, &operator, &mint, &user_b_ata, 1_000_000_000)
        .owner(&operator)
        .send()
        .unwrap();

    // --- Initialize yield_vault ---
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

    // --- Initialize protocol ---
    let (protocol_config, _) = Pubkey::find_program_address(
        &[undegen_core::constants::PROTOCOL_CONFIG_SEED],
        &core_program_id,
    );

    send_ix(
        &mut svm,
        Instruction::new_with_bytes(
            core_program_id,
            &undegen_core::instruction::InitializeProtocol {}.data(),
            undegen_core::accounts::InitializeProtocol {
                admin: operator.pubkey(),
                config: protocol_config,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        ),
        &operator,
        &[],
    );

    // --- Initialize batch (batch_id = 1, apy_bps = 500 = 5%) ---
    let batch_id: u64 = 1;
    let (batch, _) = Pubkey::find_program_address(
        &[undegen_core::constants::BATCH_SEED, &batch_id.to_le_bytes()],
        &core_program_id,
    );

    send_ix(
        &mut svm,
        Instruction::new_with_bytes(
            core_program_id,
            &undegen_core::instruction::InitializeBatch { apy_bps: 500 }.data(),
            undegen_core::accounts::InitializeBatch {
                operator: operator.pubkey(),
                mint,
                config: protocol_config,
                batch,
                token_program: TOKEN_PROGRAM_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        ),
        &operator,
        &[],
    );

    // Verify batch state
    let batch_account = svm.get_account(&batch).unwrap();
    let mut data: &[u8] = &batch_account.data;
    let batch_state = undegen_core::state::Batch::try_deserialize(&mut data).unwrap();
    assert_eq!(batch_state.batch_id, batch_id);
    assert_eq!(batch_state.operator, operator.pubkey());
    assert_eq!(batch_state.status, undegen_core::state::BatchStatus::Lobby);
    assert_eq!(batch_state.operator_yield_bps, 10000);
    assert_eq!(batch_state.total_deposited, 0);
    assert_eq!(batch_state.apy_bps, 500);
    assert_eq!(batch_state.bet_size, 0); 
    assert_eq!(batch_state.bets_completed, 0);
    assert_eq!(batch_state.accumulated_winnings, 0);
    
    // NEW: Assert the new fields we added to Batch match their Default state
    assert_eq!(batch_state.outcome, None);
    assert_eq!(batch_state.bet_terms.len(), 4);
    assert_eq!(batch_state.bet_terms[0].fixture_id, 0); // Verify default bet terms
    assert_eq!(batch_state.bet_terms[0].predicate.threshold, 0); // Verify nested TxOdds struct
    assert_eq!(batch_state.vote_weights, [0; 5]);
    assert_eq!(batch_state.winning_vote_index, None);

    // Shared accounts
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

    // --- user_a joins with 300 USDC ---
    let join_amount_a: u64 = 300_000_000;
    send_ix(
        &mut svm,
        Instruction::new_with_bytes(
            core_program_id,
            &undegen_core::instruction::JoinBatch { amount: join_amount_a }.data(),
            undegen_core::accounts::JoinBatch {
                user: user_a.pubkey(),
                mint,
                batch,
                user_token_account: user_a_ata,
                batch_token_account,
                vault_config,
                vault_token_account,
                vault_position,
                user_position: user_position_a,
                yield_vault_program: vault_program_id,
                token_program: TOKEN_PROGRAM_ID,
                associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        ),
        &user_a,
        &[],
    );

    assert_eq!(token_balance(&svm, &user_a_ata), 1_000_000_000 - join_amount_a);
    assert_eq!(token_balance(&svm, &vault_token_account), join_amount_a);

    let pos_account = svm.get_account(&user_position_a).unwrap();
    let mut data: &[u8] = &pos_account.data;
    let pos_state = undegen_core::state::UserPosition::try_deserialize(&mut data).unwrap();
    assert_eq!(pos_state.deposited_amount, join_amount_a);
    assert_eq!(pos_state.vault_shares, join_amount_a); 
    assert_eq!(pos_state.has_voted, false);
    assert_eq!(pos_state.vote_index, 0);

    // --- user_a leaves (only depositor, so gets full vault back) ---
    let user_a_before = token_balance(&svm, &user_a_ata);
    send_ix(
        &mut svm,
        Instruction::new_with_bytes(
            core_program_id,
            &undegen_core::instruction::LeaveBatch { amount: join_amount_a }.data(),
            undegen_core::accounts::LeaveBatch {
                user: user_a.pubkey(),
                mint,
                batch,
                user_token_account: user_a_ata,
                batch_token_account,
                vault_config,
                vault_token_account,
                vault_position,
                user_position: user_position_a,
                yield_vault_program: vault_program_id,
                token_program: TOKEN_PROGRAM_ID,
                associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        ),
        &user_a,
        &[],
    );
    assert_eq!(token_balance(&svm, &user_a_ata) - user_a_before, join_amount_a);
    assert_eq!(token_balance(&svm, &vault_token_account), 0);

    // --- user_b joins with 700 USDC ---
    let join_amount_b: u64 = 700_000_000;
    send_ix(
        &mut svm,
        Instruction::new_with_bytes(
            core_program_id,
            &undegen_core::instruction::JoinBatch { amount: join_amount_b }.data(),
            undegen_core::accounts::JoinBatch {
                user: user_b.pubkey(),
                mint,
                batch,
                user_token_account: user_b_ata,
                batch_token_account,
                vault_config,
                vault_token_account,
                vault_position,
                user_position: user_position_b,
                yield_vault_program: vault_program_id,
                token_program: TOKEN_PROGRAM_ID,
                associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        ),
        &user_b,
        &[],
    );
    assert_eq!(token_balance(&svm, &vault_token_account), join_amount_b);

    // --- start_batch → Locked + bet_size computed ---
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

    let batch_account = svm.get_account(&batch).unwrap();
    let mut data: &[u8] = &batch_account.data;
    let batch_state = undegen_core::state::Batch::try_deserialize(&mut data).unwrap();
    assert_eq!(batch_state.status, undegen_core::state::BatchStatus::Locked);
    assert!(batch_state.bet_size > 0, "bet_size should be > 0");
    println!("bet_size: {}", batch_state.bet_size);
    
    // NEW: Double check arrays reset successfully during the start_batch command
    assert_eq!(batch_state.vote_weights, [0; 5]);
    assert_eq!(batch_state.bet_terms.len(), 4);
    assert_eq!(batch_state.winning_vote_index, None);
    assert_eq!(batch_state.outcome, None); // Verify outcome remains None

    // --- leave_batch must fail once locked ---
    send_ix_should_fail(
        &mut svm,
        Instruction::new_with_bytes(
            core_program_id,
            &undegen_core::instruction::LeaveBatch { amount: join_amount_b }.data(),
            undegen_core::accounts::LeaveBatch {
                user: user_b.pubkey(),
                mint,
                batch,
                user_token_account: user_b_ata,
                batch_token_account,
                vault_config,
                vault_token_account,
                vault_position,
                user_position: user_position_b,
                yield_vault_program: vault_program_id,
                token_program: TOKEN_PROGRAM_ID,
                associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        ),
        &user_b,
    );

    println!("Phase 1 test passed");
}