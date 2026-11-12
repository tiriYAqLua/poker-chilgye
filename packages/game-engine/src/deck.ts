import { randomInt } from "node:crypto";
import { RANKS, SUITS, validateCards, type Card } from "./cards.js";
import { EngineValidationError } from "./errors.js";

export type RandomInt = (maxExclusive: number) => number;

export function createDeck(): Card[] {
  return SUITS.flatMap(suit => RANKS.map(rank => Object.freeze({suit, rank})));
}

export function secureRandomInt(maxExclusive: number): number {
  return randomInt(maxExclusive);
}

/** Server-only shuffle. Pass a deterministic source only in tests. */
export function shuffleDeck(deck: readonly Card[], random: RandomInt = secureRandomInt): Card[] {
  validateCards(deck);
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = random(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) {
      throw new EngineValidationError("INVALID_RANDOM_VALUE", `Expected integer in [0, ${i + 1})`);
    }
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
}
