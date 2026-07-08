use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    litesvm_token::{spl_token::state::Account as SplTokenAccount, CreateAccount, CreateMint, MintTo},
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

use anchor_lang::solana_program::program_pack::Pack;

fn send_ix(svm: &mut LiteSVM, ix: Instruction, payer: &Keypair, extra_signers: &[&Keypair]) {
    let blockhash = svm.latest_blockhash();
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend(extra_signers);
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers).unwrap();
    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "transaction failed: {:?}", res.err());
}

fn derive_ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), anchor_spl::token::ID.as_ref(), mint.as_ref()],
        &anchor_spl::associated_token::ID,
    )
    .0
}

fn token_balance(svm: &LiteSVM, token_account: &Pubkey) -> u64 {
    let account = svm.get_account(token_account).unwrap();
    SplTokenAccount::unpack(&account.data).unwrap().amount
}

#[test]
fn test_yield_vault_full_flow() {
    let program_id = yield_vault::id();
    let admin = Keypair::new();
    let depositor = Keypair::new();

    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/yield_vault.so"
    ));
    svm.add_program(program_id, bytes).unwrap();

    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&depositor.pubkey(), 10_000_000_000).unwrap();

    // --- 6-decimal mock USDC mint, admin as mint authority ---
    let mint = CreateMint::new(&mut svm, &admin)
        .authority(&admin.pubkey())
        .decimals(6)
        .send()
        .unwrap();

    let admin_ata = CreateAccount::new(&mut svm, &admin, &mint)
        .owner(&admin.pubkey())
        .send()
        .unwrap();
    let depositor_ata = CreateAccount::new(&mut svm, &depositor, &mint)
        .owner(&depositor.pubkey())
        .send()
        .unwrap();

    // Admin gets 500 to fund the yield reserve; depositor gets 1000 to deposit
    MintTo::new(&mut svm, &admin, &mint, &admin_ata, 500_000_000)
        .owner(&admin)
        .send()
        .unwrap();
    MintTo::new(&mut svm, &admin, &mint, &depositor_ata, 1_000_000_000)
        .owner(&admin)
        .send()
        .unwrap();

    // --- initialize_vault ---
    let (vault_config, _) =
        Pubkey::find_program_address(&[yield_vault::constants::VAULT_CONFIG_SEED, mint.as_ref()], &program_id);
    let vault_token_account = derive_ata(&vault_config, &mint);
    let (reserve_token_account, _) =
        Pubkey::find_program_address(&[yield_vault::constants::RESERVE_SEED, mint.as_ref()], &program_id);

    let ix = Instruction::new_with_bytes(
        program_id,
        &yield_vault::instruction::InitializeVault {}.data(),
        yield_vault::accounts::InitializeVault {
            admin: admin.pubkey(),
            mint,
            vault_config,
            vault_token_account,
            reserve_token_account,
            token_program: anchor_spl::token::ID,
            associated_token_program: anchor_spl::associated_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ix(&mut svm, ix, &admin, &[]);

    // --- fund_reserve: admin tops up the reserve with 500 mock USDC ---
    let fund_amount: u64 = 500_000_000;
    let ix = Instruction::new_with_bytes(
        program_id,
        &yield_vault::instruction::FundReserve { amount: fund_amount }.data(),
        yield_vault::accounts::FundReserve {
            admin: admin.pubkey(),
            vault_config,
            mint,
            reserve_token_account,
            admin_token_account: admin_ata,
            token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None),
    );
    send_ix(&mut svm, ix, &admin, &[]);
    assert_eq!(token_balance(&svm, &reserve_token_account), fund_amount);

    // --- deposit: depositor deposits 1000 mock USDC (first deposit -> 1:1 shares) ---
    let (position, _) = Pubkey::find_program_address(
        &[yield_vault::constants::POSITION_SEED, vault_config.as_ref(), depositor.pubkey().as_ref()],
        &program_id,
    );

    let deposit_amount: u64 = 1_000_000_000;
    let ix = Instruction::new_with_bytes(
        program_id,
        &yield_vault::instruction::Deposit { amount: deposit_amount }.data(),
        yield_vault::accounts::Deposit {
    depositor: depositor.pubkey(),
    position_payer: depositor.pubkey(), // NEW — same as depositor for direct calls
    vault_config,
    mint,
    vault_token_account,
    depositor_token_account: depositor_ata,
    position,
    token_program: anchor_spl::token::ID,
    system_program: system_program::ID,
}
        .to_account_metas(None),
    );
    send_ix(&mut svm, ix, &depositor, &[]);

    let position_account = svm.get_account(&position).unwrap();
    let mut data: &[u8] = &position_account.data;
    let position_state = yield_vault::state::Position::try_deserialize(&mut data).unwrap();
    assert_eq!(position_state.shares, deposit_amount); // 1:1 on first deposit

    let vault_account = svm.get_account(&vault_config).unwrap();
    let mut data: &[u8] = &vault_account.data;
    let vault_state = yield_vault::state::VaultConfig::try_deserialize(&mut data).unwrap();
    assert_eq!(vault_state.total_shares, deposit_amount);
    assert_eq!(vault_state.total_underlying, deposit_amount);
    assert_eq!(token_balance(&svm, &vault_token_account), deposit_amount);

    // --- tick_yield: admin grows the vault using the reserve ---
    let ix = Instruction::new_with_bytes(
        program_id,
        &yield_vault::instruction::TickYield {}.data(),
        yield_vault::accounts::TickYield {
            admin: admin.pubkey(),
            vault_config,
            mint,
            vault_token_account,
            reserve_token_account,
            token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None),
    );
    send_ix(&mut svm, ix, &admin, &[]);

    let vault_account = svm.get_account(&vault_config).unwrap();
    let mut data: &[u8] = &vault_account.data;
    let vault_state_after_tick = yield_vault::state::VaultConfig::try_deserialize(&mut data).unwrap();

    // Growth should be 5-10% of the pre-tick total_underlying
    let growth = vault_state_after_tick.total_underlying - deposit_amount;
    assert!(growth >= deposit_amount * 5 / 100, "growth below 5% floor: {}", growth);
    assert!(growth <= deposit_amount * 10 / 100, "growth above 10% ceiling: {}", growth);

    // The whole point of the reserve design: vault's real token balance must exactly
    // match the accounting number, so withdrawals never fail for insufficient funds.
    assert_eq!(token_balance(&svm, &vault_token_account), vault_state_after_tick.total_underlying);
    assert_eq!(token_balance(&svm, &reserve_token_account), fund_amount - growth);

    // Shares are untouched by yield - only the underlying-per-share exchange rate moves.
    assert_eq!(vault_state_after_tick.total_shares, deposit_amount);

    // --- withdraw: depositor redeems all shares, should get back principal + yield ---
    let ix = Instruction::new_with_bytes(
        program_id,
        &yield_vault::instruction::Withdraw { shares_amount: deposit_amount }.data(),
        yield_vault::accounts::Withdraw {
            depositor: depositor.pubkey(),
            vault_config,
            mint,
            vault_token_account,
            depositor_token_account: depositor_ata,
            position,
            token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None),
    );
    send_ix(&mut svm, ix, &depositor, &[]);

    // Depositor put in everything they had, so they get back exactly total_underlying (principal + yield)
    assert_eq!(token_balance(&svm, &depositor_ata), vault_state_after_tick.total_underlying);

    // Vault should be fully drained now (all shares redeemed)
    let vault_account = svm.get_account(&vault_config).unwrap();
    let mut data: &[u8] = &vault_account.data;
    let vault_state_final = yield_vault::state::VaultConfig::try_deserialize(&mut data).unwrap();
    assert_eq!(vault_state_final.total_shares, 0);
    assert_eq!(vault_state_final.total_underlying, 0);
    assert_eq!(token_balance(&svm, &vault_token_account), 0);
}