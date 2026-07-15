export interface Option {
  id: string;
  fixtureId: number;
  participant1: string;
  participant2: string;
  odds: number;
  startTime: number;
  label: string;
  // Present when sourced from the real /api/txodds feed; used to resolve
  // this option to its on-chain bet_terms slot index for voting.
  messageId?: string;
  ts?: number;
  outcomeIndex?: number;
  marketType?: string;
  outcome?: string;
  period?: number;
}

export interface Fixture {
  fixtureId: number;
  participant1: string;
  participant2: string;
  startTime: number;
  options: Option[];
}
