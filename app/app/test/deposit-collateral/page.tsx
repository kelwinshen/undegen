"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  Keypair,
  ComputeBudgetProgram,
  VersionedTransaction,
  TransactionMessage,
  AddressLookupTableAccount,
  AddressLookupTableProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as borsh from "@coral-xyz/borsh";
import bs58 from "bs58";
import Header from "@/app/components/Header";
import undegenCoreIdl from "@/app/lib/idl/undegen_core.json";

const UNDEGEN_PROGRAM_ID = new PublicKey(undegenCoreIdl.address);
const ALT_ADDRESS_STR = "ETHPWDGA8zLAaxbBMvuJ2Acxy4UNSfi751DqH593tMLY";
const DEVNET_RPC = "https://api.devnet.solana.com";

const DEPOSIT_COLLATERAL_DISCRIMINATOR = Buffer.from([
  156, 131, 142, 116, 146, 247, 162, 120,
]);

const BATCH_DISCRIMINATOR = Buffer.from([
  156, 194, 70, 44, 22, 88, 137, 44,
]);

const COLLATERAL_SEED = "collateral";

const BinaryOpLayout = borsh.rustEnum([
  borsh.struct([], "Add"),
  borsh.struct([], "Subtract"),
]);

const BetTermLayout = borsh.struct([
  borsh.i64("fixture_id"),
  borsh.u16("period"),
  borsh.u32("stat_a_key"),
  borsh.option(borsh.u32(), "stat_b_key"),
  borsh.option(BinaryOpLayout, "op"),
  borsh.i32("predicate_threshold"),
  borsh.u8("predicate_comparison"),
  borsh.bool("negation"),
]);

const BatchLayout = borsh.struct([
  borsh.u64("batch_id"),
  borsh.publicKey("operator"),
  borsh.publicKey("mint"),
  borsh.u8("bump"),
  borsh.publicKey("vault_position"),
  borsh.u8("statusIdx"),
  borsh.u64("total_deposited"),
  borsh.u16("apy_bps"),
  borsh.u64("bet_size"),
  borsh.u8("bets_completed"),
  borsh.u64("accumulated_winnings"),
  borsh.u16("operator_yield_bps"),
  borsh.array(BetTermLayout, 4, "bet_terms"),
  borsh.i64("kickoff_timestamp"),
  borsh.u64("win_prize"),
  borsh.array(borsh.u64(), 5, "vote_weights"),
  borsh.option(borsh.u8(), "winning_vote_index"),
  borsh.u64("collateral_required"),
  borsh.u64("collateral_deposited"),
  borsh.i64("proof_deadline"),
  borsh.option(borsh.bool(), "outcome"),
]);

function writeUInt64LE(value: number | bigint | string): Buffer {
  const buf = Buffer.alloc(8);
  new DataView(buf.buffer, buf.byteOffset, buf.byteLength).setBigUint64(
    0,
    BigInt(value),
    true,
  );
  return buf;
}
function writeInt64LE(value: number | bigint | string): Buffer {
  const buf = Buffer.alloc(8);
  new DataView(buf.buffer, buf.byteOffset, buf.byteLength).setBigInt64(
    0,
    BigInt(value),
    true,
  );
  return buf;
}
function writeUInt32LE(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value);
  return b;
}
function writeInt32LE(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32LE(value);
  return b;
}
function encodeString(s: string): Buffer {
  const buf = Buffer.from(s || "", "utf8");
  return Buffer.concat([writeUInt32LE(buf.length), buf]);
}
function encodeOptionString(s: string | null | undefined): Buffer {
  if (!s) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), encodeString(s)]);
}
function encodeVecString(arr: string[]): Buffer {
  if (!arr || arr.length === 0) return writeUInt32LE(0);
  const parts = arr.map(encodeString);
  return Buffer.concat([writeUInt32LE(arr.length), ...parts]);
}
function encodeVecI32(arr: number[]): Buffer {
  if (!arr || arr.length === 0) return writeUInt32LE(0);
  const parts = arr.map(writeInt32LE);
  return Buffer.concat([writeUInt32LE(arr.length), ...parts]);
}

function serializeOdds(odds: any): Buffer {
  const fixtureId = odds.FixtureId ?? odds.fixture_id;
  const msgId = odds.MessageId ?? odds.message_id;
  const ts = odds.Ts ?? odds.ts;
  const bookmaker = odds.Bookmaker ?? odds.bookmaker;
  const bookmakerId = odds.BookmakerId ?? odds.bookmaker_id;
  const superOddsType = odds.SuperOddsType ?? odds.super_odds_type;
  const gameState = odds.GameState ?? odds.game_state;
  const inRunning = odds.InRunning ?? odds.in_running;
  const marketParams = odds.MarketParameters ?? odds.market_parameters;
  const marketPeriod = odds.MarketPeriod ?? odds.market_period;
  const priceNames = odds.PriceNames ?? odds.price_names ?? [];
  const prices = odds.Prices ?? odds.prices ?? [];

  return Buffer.concat([
    writeInt64LE(fixtureId),
    encodeString(msgId),
    writeInt64LE(ts),
    encodeString(bookmaker),
    writeInt32LE(bookmakerId),
    encodeString(superOddsType),
    encodeOptionString(gameState),
    Buffer.from([inRunning ? 1 : 0]),
    encodeOptionString(marketParams),
    encodeOptionString(marketPeriod),
    encodeVecString(priceNames),
    encodeVecI32(prices),
  ]);
}

function serializeSummary(s: any): Buffer {
  const oddsRoot = s.oddsSubTreeRoot ?? s.odds_sub_tree_root;
  const rootBuf = Array.isArray(oddsRoot)
    ? Buffer.from(oddsRoot)
    : Buffer.from(oddsRoot, "base64");
  if (rootBuf.length !== 32) throw new Error("oddsSubTreeRoot must be 32 bytes");

  const stats = s.updateStats ?? s.update_stats;
  const updateCount = stats.updateCount ?? stats.update_count;
  const minTs = stats.minTimestamp ?? stats.min_timestamp;
  const maxTs = stats.maxTimestamp ?? stats.max_timestamp;
  const fixtureId = s.fixtureId ?? s.fixture_id;

  return Buffer.concat([
    writeInt64LE(fixtureId),
    writeUInt32LE(updateCount),
    writeInt64LE(minTs),
    writeInt64LE(maxTs),
    rootBuf,
  ]);
}

function serializeProofVec(proofs: any[]): Buffer {
  if (!proofs || proofs.length === 0) return Buffer.alloc(4, 0);

  const parts = proofs.map((p) => {
    let hashBuf: Buffer = Array.isArray(p.hash)
      ? Buffer.from(p.hash)
      : Buffer.from(p.hash, "base64");
    if (hashBuf.length !== 32) throw new Error("Proof hash must be 32 bytes");
    const isRight = Boolean(p.isRightSibling ?? p.is_right_sibling ?? false);
    return Buffer.concat([hashBuf, Buffer.from([isRight ? 1 : 0])]);
  });

  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32LE(proofs.length);
  return Buffer.concat([lengthBuf, ...parts]);
}

function serializeEmptyOdds(): Buffer {
  return Buffer.concat([
    writeInt64LE(0),
    encodeString(""),
    writeInt64LE(0),
    encodeString(""),
    writeInt32LE(0),
    encodeString(""),
    Buffer.from([0]),
    Buffer.from([0]),
    Buffer.from([0]),
    Buffer.from([0]),
    writeUInt32LE(0),
    writeUInt32LE(0),
  ]);
}

function serializeEmptySummary(): Buffer {
  const zeroRoot = Buffer.alloc(32, 0);
  return Buffer.concat([
    writeInt64LE(0),
    writeUInt32LE(0),
    writeInt64LE(0),
    writeInt64LE(0),
    zeroRoot,
  ]);
}

function serializeEmptyProofVec(): Buffer {
  return Buffer.alloc(4, 0);
}

function describeTerm(term: any): string {
  if (BigInt(term.fixture_id) === BigInt(0)) return "(empty slot)";
  const compMap: Record<number, string> = { 0: ">", 1: "<", 2: "==" };
  const compStr = compMap[term.predicate_comparison] ?? "?";
  let statAName = `Stat ${term.stat_a_key}`;
  if (term.stat_a_key === 1002) statAName = "Home Goals";
  if (term.stat_a_key === 1003) statAName = "Away Goals";
  if (term.stat_a_key === 1004) statAName = "Total Goals";
  if (term.stat_b_key !== null) {
    let statBName = `Stat ${term.stat_b_key}`;
    if (term.stat_b_key === 1002) statBName = "Home Goals";
    if (term.stat_b_key === 1003) statBName = "Away Goals";
    const opStr = term.op?.Subtract !== undefined ? "-" : "+";
    return `Fixture ${term.fixture_id.toString()} | (${statAName} ${opStr} ${statBName}) ${compStr} ${term.predicate_threshold}`;
  }
  return `Fixture ${term.fixture_id.toString()} | ${statAName} ${compStr} ${term.predicate_threshold}`;
}

type SlotMapping = {
  messageId: string;
  ts: number;
  outcomeIndex: number;
};

function DepositCollateralContent() {
  const searchParams = useSearchParams();
  const batchIdParam = searchParams.get("batchId") || "";
  const [batchId, setBatchId] = useState(batchIdParam);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [batchPda, setBatchPda] = useState<PublicKey | null>(null);
  const [batchData, setBatchData] = useState<any>(null);
  const [slotsMapping, setSlotsMapping] = useState<Record<
    number,
    SlotMapping
  > | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [validationData, setValidationData] = useState<any>(null);
  const [depositAmount, setDepositAmount] = useState<string>("");

  const addLog = (msg: string) =>
    setLogs((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] ${msg}`,
    ]);

  const getOperatorKeypair = (): Keypair => {
    const secretKeyEnv = process.env.NEXT_PUBLIC_OPERATOR_SECRET_KEY;
    if (!secretKeyEnv)
      throw new Error("NEXT_PUBLIC_OPERATOR_SECRET_KEY not set.");
    if (secretKeyEnv.startsWith("[")) {
      return Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(secretKeyEnv)),
      );
    }
    return Keypair.fromSecretKey(bs58.decode(secretKeyEnv));
  };

  const computeDepositAmount = () => {
    if (!batchData || !validationData || selectedSlot === null || !slotsMapping)
      return;
    const slot = slotsMapping[selectedSlot];
    if (!slot) return;
    const odds = validationData.odds;
    const prices = odds?.Prices ?? odds?.prices;
    if (!prices) return;
    const price = prices[slot.outcomeIndex];
    if (price === undefined) return;
    try {
      const betSize = BigInt(batchData.bet_size.toString());
      const priceBig = BigInt(price);
      const amount = (betSize * priceBig) / BigInt(1000);
      setDepositAmount(amount.toString());
      addLog(
        `Computed deposit amount: ${amount.toString()} (bet_size * price / 1000)`,
      );
    } catch (e: any) {
      addLog(`Amount computation error: ${e.message}`);
    }
  };

  useEffect(() => {
    computeDepositAmount();
  }, [validationData, selectedSlot, batchData, slotsMapping]);

  const fetchBatch = async () => {
    setLogs([]);
    setBatchPda(null);
    setBatchData(null);
    setSlotsMapping(null);
    setSelectedSlot(null);
    setValidationData(null);
    setResult(null);
    setDepositAmount("");

    const id = parseInt(batchId);
    if (isNaN(id) || id < 0) {
      setResult({ type: "error", message: "Invalid batch ID" });
      return;
    }

    setLoading(true);
    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");
      const programId = UNDEGEN_PROGRAM_ID;
      const batchIdBuffer = writeUInt64LE(id);
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("batch"), batchIdBuffer],
        programId,
      );
      setBatchPda(pda);
      addLog(`Batch PDA: ${pda.toBase58()}`);

      const accountInfo = await connection.getAccountInfo(pda);
      if (
        !accountInfo ||
        !accountInfo.data.slice(0, 8).equals(BATCH_DISCRIMINATOR)
      ) {
        throw new Error("Batch not found or not initialized.");
      }

      const decoded = BatchLayout.decode(accountInfo.data.slice(8));
      setBatchData(decoded);
      addLog("Batch loaded successfully.");

      const mapRes = await fetch(`/api/batch-mapping?batchId=${id}`);
      if (mapRes.ok) {
        const mapData = await mapRes.json();
        setSlotsMapping(mapData.slotsMapping || {});
        addLog(
          `Redis mapping loaded for ${Object.keys(mapData.slotsMapping || {}).length} slots.`,
        );
      } else {
        addLog("Warning: No Redis mapping found for this batch.");
      }
    } catch (err: any) {
      addLog(`Error: ${err.message}`);
      setResult({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const fetchValidationProof = async () => {
    if (selectedSlot === null || !slotsMapping || !batchData) return;
    addLog(`Fetching proof for slot ${selectedSlot}...`);
    try {
      const slotData = slotsMapping[selectedSlot];
      if (!slotData) throw new Error("No slot data for the selected slot.");
      const res = await fetch(
        `/api/odds/validation?messageId=${encodeURIComponent(slotData.messageId)}&ts=${slotData.ts}`,
      );
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText);
      }
      const data = await res.json();
      setValidationData(data);
      addLog("Validation proof received.");
    } catch (err: any) {
      addLog(`Proof fetch error: ${err.message}`);
    }
  };

  const handleDeposit = async () => {
    if (!batchPda || !batchData) {
      setResult({ type: "error", message: "Load batch data first." });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");
      const programId = UNDEGEN_PROGRAM_ID;
      const operator = getOperatorKeypair();
      const mint = batchData.mint;
      const operatorTokenAccount = await getAssociatedTokenAddress(
        mint,
        operator.publicKey,
      );
      const batchTokenAccount = await getAssociatedTokenAddress(
        mint,
        batchPda,
        true,
      );

      const [collateralPda] = PublicKey.findProgramAddressSync(
        [Buffer.from(COLLATERAL_SEED), batchPda.toBuffer()],
        programId,
      );

      const useRealProof = validationData !== null;
      const oddsBuf = useRealProof
        ? serializeOdds(validationData.odds)
        : serializeEmptyOdds();
      const summaryBuf = useRealProof
        ? serializeSummary(validationData.summary)
        : serializeEmptySummary();
      const subTreeProofBuf = useRealProof
        ? serializeProofVec(
            validationData.subTreeProof ?? validationData.sub_tree_proof,
          )
        : serializeEmptyProofVec();
      const mainTreeProofBuf = useRealProof
        ? serializeProofVec(
            validationData.mainTreeProof ?? validationData.main_tree_proof,
          )
        : serializeEmptyProofVec();

      const oraclePriceIndex = useRealProof
        ? slotsMapping?.[selectedSlot!]?.outcomeIndex ?? 0
        : 0; 

      const amountBigInt = (() => {
        const raw = depositAmount.trim();
        if (raw === "") return BigInt(0); 
        return BigInt(raw);
      })();

      const TXODDS_PROGRAM_ID = new PublicKey(
        "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
      );
      const epochDay = Math.floor(
        Number(useRealProof ? (validationData.odds.Ts ?? validationData.odds.ts) : 0) /
          86400000,
      );
      const bufLE = Buffer.alloc(2);
      bufLE.writeUInt16LE(epochDay);
      const [dailyOddsMerkleRoots] = PublicKey.findProgramAddressSync(
        [Buffer.from("daily_batch_roots"), bufLE],
        TXODDS_PROGRAM_ID,
      );

      const data = Buffer.concat([
        DEPOSIT_COLLATERAL_DISCRIMINATOR,
        writeUInt64LE(amountBigInt),
        Buffer.from([oraclePriceIndex]),
        oddsBuf,
        summaryBuf,
        subTreeProofBuf,
        mainTreeProofBuf,
      ]);

      console.log("========== TRANSACTION SIZE BREAKDOWN ==========");
      console.log("Discriminator bytes:", DEPOSIT_COLLATERAL_DISCRIMINATOR.length);
      console.log("Amount bytes:", 8);
      console.log("Oracle Price Index bytes:", 1);
      console.log("Odds Data bytes:", oddsBuf.length);
      console.log("Summary Data bytes:", summaryBuf.length);
      console.log("SubTree Proof bytes:", subTreeProofBuf.length);
      console.log("MainTree Proof bytes:", mainTreeProofBuf.length);
      console.log("Total Instruction Data bytes:", data.length);
      
      const keys = [
        { pubkey: operator.publicKey, isSigner: true, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: batchPda, isSigner: false, isWritable: true },
        { pubkey: operatorTokenAccount, isSigner: false, isWritable: true },
        { pubkey: collateralPda, isSigner: false, isWritable: true },
        { pubkey: batchTokenAccount, isSigner: false, isWritable: true },
        { pubkey: dailyOddsMerkleRoots, isSigner: false, isWritable: false },
        { pubkey: TXODDS_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ];

      console.log("--- ACCOUNT KEYS BREAKDOWN (32 bytes each uncompressed) ---");
      keys.forEach((k, i) => {
        console.log(`Key ${i} [${k.pubkey.toBase58()}]: 32 bytes (Signer: ${k.isSigner}, Writable: ${k.isWritable})`);
      });
      console.log(`Total Keys: ${keys.length} (${keys.length * 32} bytes uncompressed)`);
      console.log("Note: Any non-signer key above can be added to an ALT to save 31 bytes each. Signer keys cannot benefit from ALT compression.");
      console.log("================================================");

      addLog(`Data Payload Size: ${data.length} bytes (Odds: ${oddsBuf.length}, Summary: ${summaryBuf.length}, SubTree: ${subTreeProofBuf.length}, MainTree: ${mainTreeProofBuf.length})`);
      addLog(`Accounts Size: ${keys.length * 32} bytes (${keys.length} keys total before compression)`);

      console.log("--- DYNAMIC ACCOUNTS TO ADD TO ALT ---");
      console.log("Batch PDA:", batchPda.toBase58());
      console.log("Collateral PDA:", collateralPda.toBase58());
      console.log("Batch Token:", batchTokenAccount.toBase58());
      console.log("Daily Roots:", dailyOddsMerkleRoots.toBase58());
      const ix = new TransactionInstruction({ programId, keys, data });
      
      const altAddress = new PublicKey(ALT_ADDRESS_STR);
      let lookupTableAccount = (await connection.getAddressLookupTable(altAddress, {
        commitment: "confirmed",
      })).value;
      if (!lookupTableAccount) {
        throw new Error(`Lookup table ${altAddress.toBase58()} not found`);
      }

      const candidateAddresses = [
        programId,
        ComputeBudgetProgram.programId,
        ...keys.filter(k => !k.isSigner).map(k => k.pubkey)
      ];
      const uniqueCandidates = Array.from(
        new Set(candidateAddresses.map(p => p.toBase58()))
      ).map(s => new PublicKey(s));

      const existingAddressesSet = new Set(
        lookupTableAccount.state.addresses.map(a => a.toBase58())
      );
      const missingAddresses = uniqueCandidates.filter(
        addr => !existingAddressesSet.has(addr.toBase58())
      );

      if (missingAddresses.length > 0) {
        addLog(`ALT is missing ${missingAddresses.length} addresses. Extending ALT...`);
        const extendInstruction = AddressLookupTableProgram.extendLookupTable({
          payer: operator.publicKey,
          authority: operator.publicKey,
          lookupTable: altAddress,
          addresses: missingAddresses,
        });

        const { blockhash: extendBlockhash } = await connection.getLatestBlockhash("confirmed");
        const extendMessage = new TransactionMessage({
          payerKey: operator.publicKey,
          recentBlockhash: extendBlockhash,
          instructions: [extendInstruction],
        }).compileToV0Message();

        const extendTx = new VersionedTransaction(extendMessage);
        extendTx.sign([operator]);

        const extendSig = await connection.sendRawTransaction(extendTx.serialize(), {
          skipPreflight: false,
        });
        addLog(`ALT extend tx sent: ${extendSig}. Waiting for confirmation...`);
        
        const latestBlockHash = await connection.getLatestBlockhash("confirmed");
        await connection.confirmTransaction({
          blockhash: latestBlockHash.blockhash,
          lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
          signature: extendSig,
        }, "confirmed");

        addLog("ALT extended successfully. Waiting 2 seconds for lookup table activation slot...");
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const updatedLut = (await connection.getAddressLookupTable(altAddress, {
          commitment: "confirmed",
        })).value;
        if (updatedLut) {
          lookupTableAccount = updatedLut;
          addLog(`Re-loaded ALT. Now contains ${lookupTableAccount.state.addresses.length} addresses.`);
        } else {
          throw new Error("Failed to re-fetch extended ALT");
        }
      } else {
        addLog("All required addresses already present in ALT.");
      }

      const lookupTables = [lookupTableAccount];
      const { blockhash } = await connection.getLatestBlockhash("confirmed");

      const messageV0 = new TransactionMessage({
        payerKey: operator.publicKey,
        recentBlockhash: blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
          ix,
        ],
      }).compileToV0Message(lookupTables);

      addLog(`Compiled V0 Message Size Estimate: ~${messageV0.serialize().length} bytes / 1232 limit`);

      const tx = new VersionedTransaction(messageV0);
      tx.sign([operator]);

      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
      });

      await connection.confirmTransaction(sig);
      setResult({ type: "success", message: `Success! Tx: ${sig}` });
    } catch (err: any) {
      addLog(`Error: ${err.message}`);
      setResult({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (batchIdParam) fetchBatch();
  }, [batchIdParam]);

  return (
    <div className="relative min-h-screen overflow-x-clip bg-bg1 text-foreground">
      <main className="relative z-10 mx-auto flex min-h-screen max-w-3xl flex-col gap-8 border-x border-border-low px-6 py-12">
        <Header />
        <Link
          href="/test"
          className="text-xs text-gray-400 hover:text-gray-200 -mb-4"
        >
          ← Back to Test Hub
        </Link>
        <div className="p-6 bg-bg2 rounded-xl border border-border-low space-y-6">
          <h2 className="text-xl font-bold">Deposit Collateral (Test)</h2>
          <p className="text-sm text-gray-400">
            Load a batch, optionally select a slot and fetch proof, then deposit
            collateral. If no proof is loaded, empty (skip) data will be used.
          </p>

          <div className="flex gap-2">
            <input
              type="number"
              placeholder="Batch ID"
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              className="flex-1 bg-bg1 border border-border-low rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-400"
              disabled={loading}
            />
            <button
              onClick={fetchBatch}
              disabled={loading || !batchId}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-400 transition disabled:opacity-50"
            >
              {loading ? "Loading..." : "Load Batch"}
            </button>
          </div>

          {batchData && (
            <div className="space-y-4">
              <div className="text-sm text-gray-400 p-3 bg-black/20 rounded-lg border border-border-low">
                <span className="block mb-1">
                  <strong>Batch ID:</strong> {batchData.batch_id.toString()}
                </span>
                <span className="block">
                  <strong>Status:</strong>{" "}
                  <span className="text-emerald-300 font-semibold">
                    {
                      [
                        "Lobby",
                        "Locked",
                        "AwaitingCollateral",
                        "Active",
                        "Settled",
                        "Cancelled",
                      ][batchData.statusIdx]
                    }
                  </span>
                </span>
                <span className="block">
                  <strong>Bet Size:</strong> {batchData.bet_size.toString()}
                </span>
                <span className="block">
                  <strong>Collateral Required:</strong>{" "}
                  {batchData.collateral_required.toString()}
                </span>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold mb-1">
                  Bet Terms &amp; Redis Mapping
                </h3>
                <div className="grid grid-cols-1 gap-2">
                  {batchData.bet_terms.map((term: any, idx: number) => {
                    const isEmpty = BigInt(term.fixture_id) === BigInt(0);
                    const slot = slotsMapping?.[idx];
                    return (
                      <div
                        key={idx}
                        className={`p-3 bg-bg1 rounded-lg border ${
                          selectedSlot === idx
                            ? "border-emerald-400 bg-emerald-500/10"
                            : "border-border-low"
                        } ${isEmpty ? "opacity-50" : ""}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-gray-200">
                            Slot {idx + 1} {isEmpty ? "(empty)" : ""}
                          </span>
                          <button
                            disabled={isEmpty || !slot}
                            onClick={() => {
                              setSelectedSlot(idx);
                              setValidationData(null);
                            }}
                            className="text-xs px-2 py-1 bg-blue-600 rounded hover:bg-blue-500 disabled:opacity-40"
                          >
                            Select
                          </button>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">
                          {describeTerm(term)}
                        </p>
                        {!isEmpty && slot && (
                          <p className="text-xs text-gray-500 mt-1">
                            Redis: msgId={slot.messageId}, ts={slot.ts}, idx=
                            {slot.outcomeIndex}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-2 items-end">
                <button
                  onClick={fetchValidationProof}
                  disabled={selectedSlot === null || !slotsMapping}
                  className="px-4 py-2 bg-purple-500 text-white rounded-lg font-semibold hover:bg-purple-400 transition disabled:opacity-50"
                >
                  Fetch Validation Proof
                </button>
                {validationData && (
                  <span className="text-xs text-green-400">
                    Real proof loaded – will be used
                  </span>
                )}
                {!validationData && (
                  <span className="text-xs text-yellow-300">
                    No proof loaded → empty (skip) data
                  </span>
                )}
              </div>

              {validationData && (
                <div className="p-3 bg-black/30 rounded-lg border border-border-low max-h-48 overflow-y-auto">
                  <pre className="text-xs text-green-300 whitespace-pre-wrap">
                    {JSON.stringify(validationData.odds, null, 2)}
                  </pre>
                </div>
              )}

              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-400">
                  Deposit Amount (raw):
                </label>
                <input
                  type="text"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="Amount"
                  className="flex-1 bg-bg1 border border-border-low rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-400"
                  disabled={loading}
                />
              </div>

              <button
                onClick={handleDeposit}
                disabled={!batchData || loading}
                className="w-full mt-4 px-6 py-3 bg-emerald-500 text-black font-semibold rounded-lg hover:bg-emerald-400 transition disabled:opacity-50"
              >
                {loading
                  ? "Depositing..."
                  : `Deposit ${depositAmount || "0"} Collateral`}
              </button>
            </div>
          )}

          {result && (
            <div
              className={`p-3 rounded-lg text-sm ${
                result.type === "success"
                  ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
                  : "bg-red-500/10 border border-red-500/30 text-red-300"
              }`}
            >
              {result.message}
            </div>
          )}

          {logs.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold mb-2 text-gray-400">
                Execution Log
              </h3>
              <div className="bg-black/40 rounded-lg p-4 max-h-64 overflow-y-auto space-y-1 text-xs font-mono border border-border-low">
                {logs.map((msg, i) => (
                  <div
                    key={i}
                    className={
                      msg.includes("Error") || msg.includes("Failed")
                        ? "text-red-400"
                        : msg.includes("Success") || msg.includes("success")
                          ? "text-emerald-300"
                          : "text-gray-400"
                    }
                  >
                    {msg}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function DepositCollateral() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg1 text-white flex items-center justify-center">Loading...</div>}>
      <DepositCollateralContent />
    </Suspense>
  );
}