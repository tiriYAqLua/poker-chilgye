import { EngineValidationError } from "./errors.js";

export const SUITS = Object.freeze(["clubs", "diamonds", "hearts", "spades"] as const);
export const RANKS = Object.freeze([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const);
export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
export interface Card {
  readonly suit: Suit;
  readonly rank: Rank;
}
export function cardKey(card: Card): string {
  return `${card.rank}:${card.suit}`;
}

export function formatCard(card: Card): string {
  const faces: Partial<Record<Rank, string>> = {11: "J", 12: "Q", 13: "K", 14: "A"};
  const suits: Record<Suit, string> = {clubs: "C", diamonds: "D", hearts: "H", spades: "S"};
  return `${faces[card.rank] ?? card.rank}${suits[card.suit]}`;
}

/** Runtime validation is necessary even when callers use TypeScript. */
export function validateCards(cards: readonly Card[], count?: number): void {
  if (!Array.isArray(cards) || (count !== undefined && cards.length !== count)) {
    throw new EngineValidationError("INVALID_CARD_COUNT", `Expected ${count ?? "an array of"} cards`);
  }
  const seen = new Set<string>();
  for (const card of cards) {
    if (!card || !RANKS.includes(card.rank) || !SUITS.includes(card.suit)) {
      throw new EngineValidationError("INVALID_CARD", "Invalid rank or suit");
    }
    const key = cardKey(card);
    if (seen.has(key)) {
      throw new EngineValidationError("DUPLICATE_CARD", `Duplicate card: ${key}`);
    }
    seen.add(key);
  }
}
