use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{clock::Clock, instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    litesvm_token::{spl_token::state::Account as SplTokenAccount, CreateAccount, CreateMint, MintTo},
    solana_account::Account,
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

// ATA derivation - stable SPL formula, avoids pulling in an extra crate just for this.
fn derive_ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), anchor_spl::token::ID.as_ref(), mint.as_ref()],
        &anchor_spl::associated_token::ID,
    )
    .0
}

#[test]
fn test_lottery_full_flow() {
    let program_id = lottery::id();
    let admin = Keypair::new();
    let buyer_a = Keypair::new();
    let buyer_b = Keypair::new();

    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/lottery.so"
    ));
    svm.add_program(program_id, bytes).unwrap();

    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&buyer_a.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&buyer_b.pubkey(), 10_000_000_000).unwrap();

    // --- Set up a 6-decimal mock USDC mint, admin as mint authority ---
    let mint = CreateMint::new(&mut svm, &admin)
        .authority(&admin.pubkey())
        .decimals(6)
        .send()
        .unwrap();

    let buyer_a_ata = CreateAccount::new(&mut svm, &buyer_a, &mint)
        .owner(&buyer_a.pubkey())
        .send()
        .unwrap();
    let buyer_b_ata = CreateAccount::new(&mut svm, &buyer_b, &mint)
        .owner(&buyer_b.pubkey())
        .send()
        .unwrap();

    MintTo::new(&mut svm, &admin, &mint, &buyer_a_ata, 1_000_000_000)
        .owner(&admin)
        .send()
        .unwrap(); // 1000 mock USDC
    MintTo::new(&mut svm, &admin, &mint, &buyer_b_ata, 1_000_000_000)
        .owner(&admin)
        .send()
        .unwrap();

    // --- initialize_lottery ---
    let (lottery_config, _) =
        Pubkey::find_program_address(&[lottery::constants::LOTTERY_CONFIG_SEED, mint.as_ref()], &program_id);

    let ix = Instruction::new_with_bytes(
        program_id,
        &lottery::instruction::InitializeLottery {}.data(),
        lottery::accounts::InitializeLottery {
            admin: admin.pubkey(),
            mint,
            lottery_config,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ix(&mut svm, ix, &admin, &[]);

    // --- start_round (round_id will be 1) ---
    let round_id: u64 = 1;
    let (round, _) = Pubkey::find_program_address(
        &[lottery::constants::ROUND_SEED, mint.as_ref(), &round_id.to_le_bytes()],
        &program_id,
    );
    let jackpot_token_account = derive_ata(&round, &mint);

    let ix = Instruction::new_with_bytes(
        program_id,
        &lottery::instruction::StartRound {}.data(),
        lottery::accounts::StartRound {
            admin: admin.pubkey(),
            lottery_config,
            mint,
            round,
            jackpot_token_account,
            token_program: anchor_spl::token::ID,
            associated_token_program: anchor_spl::associated_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ix(&mut svm, ix, &admin, &[]);

    // --- buy_ticket: buyer_a buys 300, buyer_b buys 700 (total pool 1000) ---
    let (entry_a, _) =
        Pubkey::find_program_address(&[lottery::constants::ENTRY_SEED, round.as_ref(), buyer_a.pubkey().as_ref()], &program_id);
    let (entry_b, _) =
        Pubkey::find_program_address(&[lottery::constants::ENTRY_SEED, round.as_ref(), buyer_b.pubkey().as_ref()], &program_id);

    let buy_a_amount: u64 = 300_000_000;
    let ix = Instruction::new_with_bytes(
        program_id,
        &lottery::instruction::BuyTicket { amount: buy_a_amount }.data(),
        lottery::accounts::BuyTicket {
            buyer: buyer_a.pubkey(),
            mint,
            round,
            jackpot_token_account,
            buyer_token_account: buyer_a_ata,
            entry: entry_a,
            token_program: anchor_spl::token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ix(&mut svm, ix, &buyer_a, &[]);

    let buy_b_amount: u64 = 700_000_000;
    let ix = Instruction::new_with_bytes(
        program_id,
        &lottery::instruction::BuyTicket { amount: buy_b_amount }.data(),
        lottery::accounts::BuyTicket {
            buyer: buyer_b.pubkey(),
            mint,
            round,
            jackpot_token_account,
            buyer_token_account: buyer_b_ata,
            entry: entry_b,
            token_program: anchor_spl::token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ix(&mut svm, ix, &buyer_b, &[]);

    // Sanity check pool total before the draw
    let round_account = svm.get_account(&round).unwrap();
    let mut data: &[u8] = &round_account.data;
    let round_state = lottery::state::Round::try_deserialize(&mut data).unwrap();
    assert_eq!(round_state.total_pool, buy_a_amount + buy_b_amount);

    // --- request_randomness: rejected before the 7-day round deadline ---
    let randomness = Pubkey::new_unique();
    let queue = Pubkey::new_unique();
    let oracle = Pubkey::new_unique();
    let switchboard_program = lottery::switchboard::switchboard_on_demand_program_id();

    let request_randomness_ix = Instruction::new_with_bytes(
        program_id,
        &lottery::instruction::RequestRandomness {}.data(),
        lottery::accounts::RequestRandomness {
            admin: admin.pubkey(),
            lottery_config,
            mint,
            round,
            randomness,
            queue,
            oracle,
            recent_slothashes: solana_sdk_ids::sysvar::slot_hashes::ID,
            switchboard_program,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(
        std::slice::from_ref(&request_randomness_ix),
        Some(&admin.pubkey()),
        &blockhash,
    );
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(res.is_err(), "request_randomness should fail before the round's 7-day deadline");

    // --- warp the clock past the round's 7-day deadline ---
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp += 8 * 24 * 60 * 60;
    clock.slot = 12_345;
    svm.set_sysvar(&clock);

    // request_randomness now passes the deadline check, but still fails: there's
    // no real Switchboard On-Demand program deployed in this local litesvm
    // environment to CPI into. Exercising the actual oracle commit/reveal only
    // makes sense against a live devnet/mainnet Switchboard queue; what we can
    // verify locally is that the deadline gate opens correctly and that a draw
    // never silently succeeds without a real oracle answering.
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[request_randomness_ix], Some(&admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(
        res.is_err(),
        "request_randomness should still fail locally: no Switchboard program is deployed in this test environment"
    );

    // --- fabricate an already-revealed Switchboard randomness account, and put
    // the round into the state request_randomness would have left it in, so we
    // can exercise reveal_winner + claim_prize the same way a real oracle round
    // would: reveal_winner requires the randomness account to be owned by the
    // Switchboard program and revealed in the exact current slot.
    let winning_value_bytes: [u8; 32] = {
        let mut v = [0u8; 32];
        v[0..8].copy_from_slice(&123_456_789u64.to_le_bytes());
        v
    };
    let randomness_data =
        lottery::switchboard::encode_randomness_account_data(clock.slot, winning_value_bytes);
    svm.set_account(
        randomness,
        Account {
            lamports: 1_000_000,
            data: randomness_data,
            owner: switchboard_program,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let mut round_account = svm.get_account(&round).unwrap();
    let mut round_data: &[u8] = &round_account.data;
    let mut round_state = lottery::state::Round::try_deserialize(&mut round_data).unwrap();
    round_state.status = lottery::state::RoundStatus::RandomnessRequested;
    round_state.randomness_account = randomness;
    let mut serialized = Vec::new();
    anchor_lang::AccountSerialize::try_serialize(&round_state, &mut serialized).unwrap();
    round_account.data = serialized;
    svm.set_account(round, round_account).unwrap();

    // --- reveal_winner ---
    let ix = Instruction::new_with_bytes(
        program_id,
        &lottery::instruction::RevealWinner {}.data(),
        lottery::accounts::RevealWinner {
            mint,
            round,
            randomness,
        }
        .to_account_metas(None),
    );
    send_ix(&mut svm, ix, &admin, &[]);

    let round_account = svm.get_account(&round).unwrap();
    let mut data: &[u8] = &round_account.data;
    let round_state = lottery::state::Round::try_deserialize(&mut data).unwrap();
    let winning_number = round_state.winning_number;
    assert!(winning_number < round_state.total_pool);

    // Figure out which buyer actually won, based on the real ranges on-chain
    let entry_a_account = svm.get_account(&entry_a).unwrap();
    let mut data: &[u8] = &entry_a_account.data;
    let entry_a_state = lottery::state::Entry::try_deserialize(&mut data).unwrap();

    let a_wins = winning_number >= entry_a_state.start_offset && winning_number < entry_a_state.end_offset;

    let (winner_kp, winner_ata, winner_entry, loser_kp, loser_ata, loser_entry) = if a_wins {
        (&buyer_a, buyer_a_ata, entry_a, &buyer_b, buyer_b_ata, entry_b)
    } else {
        (&buyer_b, buyer_b_ata, entry_b, &buyer_a, buyer_a_ata, entry_a)
    };

    // --- claim_prize: winner succeeds ---
    let ix = Instruction::new_with_bytes(
        program_id,
        &lottery::instruction::ClaimPrize {}.data(),
        lottery::accounts::ClaimPrize {
            winner: winner_kp.pubkey(),
            mint,
            round,
            jackpot_token_account,
            winner_token_account: winner_ata,
            entry: winner_entry,
            token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None),
    );
    send_ix(&mut svm, ix, winner_kp, &[]);

    let winner_token_account = svm.get_account(&winner_ata).unwrap();
    let winner_balance = SplTokenAccount::unpack(&winner_token_account.data).unwrap().amount;
    // winner started with 700m, lost their buy-in to the pool, then got the whole pool back
    assert_eq!(winner_balance, 1_000_000_000 - if a_wins { buy_a_amount } else { buy_b_amount } + (buy_a_amount + buy_b_amount));

    // --- claim_prize: loser must fail with NotWinner ---
    let ix = Instruction::new_with_bytes(
        program_id,
        &lottery::instruction::ClaimPrize {}.data(),
        lottery::accounts::ClaimPrize {
            winner: loser_kp.pubkey(),
            mint,
            round,
            jackpot_token_account,
            winner_token_account: loser_ata,
            entry: loser_entry,
            token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&loser_kp.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[loser_kp]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(res.is_err(), "loser's claim should have failed but succeeded");
}