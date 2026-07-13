export interface EnrichedMatch {
  fixtureId: number;
  participant1: string;
  participant2: string;
  p1Goals: number;
  p2Goals: number;
  status: string;
  oddsData: any | null;
  underdogSide: 'p1' | 'p2' | null;
  underdogOdds: number | null;
  homeOdds: number | null;
  awayOdds: number | null;
  drawOdds: number | null;
}

export interface Subcategory {
  id: string;
  name: string;
  multiplier: string;
  description: string;
  currentVotes: number;
}

export interface Category {
  id: string;
  name: string;
  subcategories: Subcategory[];
}

export interface HistoricalMatch {
  home: string;
  away: string;
  score: string;
  status: string;
}

export interface HistoricalBatch {
  date: string;
  winningCategory: string;
  multiplier: string;
  result: "Won" | "Lost";
  totalPooled: string;
  totalPayout: string;
  matches: HistoricalMatch[];
}