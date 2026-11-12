import { createDeck, shuffleDeck, formatCard, evaluateSeven, compareHandValues, type Card, type Rank, type Suit } from "@poker/game-engine";
export type Hand = { stage: number; board: string[]; holes: Map<string, string[]> };
export function createHand(ids: string[]): Hand {
  if (ids.length < 2 || ids.length > 6 || new Set(ids).size !== ids.length) throw new Error("Need 2–6 unique players");
  const deck = shuffleDeck(createDeck()).map(formatCard);
  const holes = new Map(ids.map((id, i) => [id, [deck[i]!, deck[i + ids.length]!]]));
  const remaining = deck.slice(ids.length * 2);
  return {stage: 0, holes, board: [remaining[1]!, remaining[2]!, remaining[3]!, remaining[5]!, remaining[7]!]};
}
export function advanceHand(hand: Hand): void { hand.stage = Math.min(hand.stage + 1, 4); }
type Showdown = {winners: string[]; players: {id: string; hole: string[]; category: number}[]};
export function parseCard(value: string): Card {
  const suit = ({C: "clubs", D: "diamonds", H: "hearts", S: "spades"} as Record<string, Suit>)[value.slice(-1)]!;
  const raw = value.slice(0, -1);
  const rank = ({J: 11, Q: 12, K: 13, A: 14} as Record<string, number>)[raw] ?? Number(raw);
  return {rank: rank as Rank, suit};
}
function resolveShowdown(hand: Hand): Showdown {
  const ranked = [...hand.holes].map(([id, hole]) => ({id, hole: [...hole], value: evaluateSeven([...hole, ...hand.board].map(parseCard))}));
  const best = ranked.reduce((a, b) => compareHandValues(a.value, b.value) >= 0 ? a : b);
  return {winners: ranked.filter(entry => compareHandValues(entry.value, best.value) === 0).map(entry => entry.id),
    players: ranked.map(entry => ({id: entry.id, hole: entry.hole, category: entry.value.category}))};
}
export function viewHand(hand: Hand, id: string): {stage: number; board: string[]; hole: string[]; showdown?: Showdown} {
  const hole = hand.holes.get(id);
  if (!hole) throw new Error("Not in hand");
  return {stage: hand.stage, board: hand.board.slice(0, [0, 3, 4, 5, 5][hand.stage]!), hole: [...hole],
    ...(hand.stage === 4 ? {showdown: resolveShowdown(hand)} : {})};
}
