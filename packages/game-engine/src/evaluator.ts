import { SUITS, validateCards, type Card } from "./cards.js";

export enum HandCategory {
  HighCard, OnePair, TwoPair, ThreeOfAKind, Straight, Flush,
  FullHouse, FourOfAKind, StraightFlush
}
export interface HandValue {
  readonly category: HandCategory;
  readonly tiebreak: readonly number[];
  readonly cards: readonly Card[];
}
// Suits only make the chosen physical cards deterministic; they NEVER break poker ties.
function canonicalCards(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => b.rank - a.rank || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));
}

function scoreFive(cards: readonly Card[]): HandValue {
  const sorted = canonicalCards(cards);
  const ranks = sorted.map(card => card.rank);
  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = sorted.every(card => card.suit === sorted[0]!.suit);
  const wheel = ranks.join(",") === "14,5,4,3,2";
  const straightHigh = counts.size === 5 && (ranks[0]! - ranks[4]! === 4 || wheel)
    ? (wheel ? 5 : ranks[0]!) : 0;
  let category: HandCategory;
  let tiebreak: number[];
  if (flush && straightHigh) {
    category = HandCategory.StraightFlush; tiebreak = [straightHigh];
  } else if (groups[0]![1] === 4) {
    category = HandCategory.FourOfAKind; tiebreak = groups.map(group => group[0]);
  } else if (groups[0]![1] === 3 && groups[1]![1] === 2) {
    category = HandCategory.FullHouse; tiebreak = groups.map(group => group[0]);
  } else if (flush) {
    category = HandCategory.Flush; tiebreak = ranks;
  } else if (straightHigh) {
    category = HandCategory.Straight; tiebreak = [straightHigh];
  } else if (groups[0]![1] === 3) {
    category = HandCategory.ThreeOfAKind; tiebreak = groups.map(group => group[0]);
  } else if (groups[0]![1] === 2 && groups[1]![1] === 2) {
    category = HandCategory.TwoPair; tiebreak = groups.map(group => group[0]);
  } else if (groups[0]![1] === 2) {
    category = HandCategory.OnePair; tiebreak = groups.map(group => group[0]);
  } else {
    category = HandCategory.HighCard; tiebreak = ranks;
  }
  return {category, tiebreak, cards: sorted};
}

export function evaluateFive(cards: readonly Card[]): HandValue {
  validateCards(cards, 5);
  return scoreFive(cards);
}

/** Hold'em permits any five cards out of seven, including the board alone. */
export function evaluateSeven(cards: readonly Card[]): HandValue {
  validateCards(cards, 7);
  const sorted = canonicalCards(cards);
  let best: HandValue | undefined;
  // Omitting each distinct pair enumerates C(7,5) = 21 candidates.
  for (let first = 0; first < 6; first++) {
    for (let second = first + 1; second < 7; second++) {
      const candidate = scoreFive(sorted.filter((_, i) => i !== first && i !== second));
      if (!best || compareHandValues(candidate, best) > 0) best = candidate;
    }
  }
  return best!;
}

/** Compare values produced by evaluateFive/evaluateSeven; suits are irrelevant. */
export function compareHandValues(left: HandValue, right: HandValue): -1 | 0 | 1 {
  const category = Math.sign(left.category - right.category);
  if (category !== 0) return category as -1 | 1;
  for (let i = 0; i < left.tiebreak.length; i++) {
    const difference = Math.sign(left.tiebreak[i]! - right.tiebreak[i]!);
    if (difference !== 0) return difference as -1 | 1;
  }
  return 0;
}
