export type BatchPhase = 'Lobby' | 'Locked' | 'Active' | 'Settled';

export interface BatchState {
  batchId: number;
  phase: BatchPhase;
  totalDeposited: number;
  weeklyYieldPool: number;
  acceptedPredictions: number;
  maxPredictions: number;
  operatorAddress: string;
  userDeposited: number;
  batchStartTime: number;
  participantCount: number;
  minimumDeposit: number;
}

export interface VoteResult {
  fixtureId: number;
  winnerOptionId: string | null;
  isSkip: boolean;
  accepted: boolean;
  won: boolean;
}

export async function fetchBatchState(batchId: number, userAddress: string | null): Promise<BatchState> {
  const now = Date.now();
  const tvl = 1_250_000;

  if (batchId === 2) {
    const participants = userAddress ? 87 : 86;
    return {
      batchId: 2,
      phase: 'Lobby',
      totalDeposited: 420_000,
      weeklyYieldPool: 420_000 * 0.05 / 52,
      acceptedPredictions: 0,
      maxPredictions: 5,
      operatorAddress: 'OP...',
      userDeposited: userAddress ? 500 : 0,
      batchStartTime: now + 3600000 * 6,
      participantCount: participants,
      minimumDeposit: 100,
    };
  }

  const participants = userAddress ? 1287 : 1286;
  return {
    batchId: 1,
    phase: 'Active',
    totalDeposited: tvl,
    weeklyYieldPool: tvl * 0.05 / 52,
    acceptedPredictions: 2,
    maxPredictions: 5,
    operatorAddress: 'OP...',
    userDeposited: userAddress ? 1000 : 0,
    batchStartTime: now - 3600000 * 24,
    participantCount: participants,
    minimumDeposit: 100,
  };
}

export async function depositToLobby(batchId: number, amount: number): Promise<string> {
  console.log(`Mock deposit to batch ${batchId}: ${amount} USDC`);
  return 'mock-tx-signature';
}

export async function withdrawFromLobby(batchId: number): Promise<string> {
  console.log(`Mock withdraw from batch ${batchId}`);
  return 'mock-tx-signature';
}

export async function submitVote(fixtureId: number, optionId: string): Promise<string> {
  console.log(`Mock vote: fixture ${fixtureId}, option ${optionId}`);
  return 'mock-tx-signature';
}

export async function fetchVotes(fixtures: any[]): Promise<Record<string, number>> {
  const votes: Record<string, number> = {};
  fixtures.forEach((f: any) => {
    f.options.forEach((o: any) => { votes[o.id] = Math.floor(Math.random() * 500) + 50; });
    votes[`${f.fixtureId}-skip`] = Math.floor(Math.random() * 200) + 20;
  });
  return votes;
}

export function generateDecisionForFixture(
  fixtureId: number,
  simulatedVotes: Record<string, number>,
  options: any[],
  betsUsed: number,
  maxBets: number,
  batchStart: number
): VoteResult {
  const skipId = `${fixtureId}-skip`;
  const skipVotes = simulatedVotes[skipId] || 0;
  let maxVotes = skipVotes;
  let winnerId: string | null = skipId;

  options.forEach((opt: any) => {
    const v = simulatedVotes[opt.id] || 0;
    if (v > maxVotes) {
      maxVotes = v;
      winnerId = opt.id;
    }
  });

  const isSkip = winnerId === skipId;
  const isBet = !isSkip && betsUsed < maxBets;
  const won = isBet ? Math.random() > 0.5 : false;

  return {
    fixtureId,
    winnerOptionId: winnerId,
    isSkip,
    accepted: isBet,
    won,
  };
}

export async function submitTxOddsProof(fixtureId: number, proofData: any): Promise<string> {
  console.log('Mock proof submission');
  return 'mock-tx-signature';
}

export async function claimWinnings(): Promise<string> {
  console.log('Mock claim');
  return 'mock-tx-signature';
}

export async function buyLotteryTicket(): Promise<string> {
  console.log('Mock lottery ticket');
  return 'mock-tx-signature';
}