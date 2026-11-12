import { describe, expect, it } from "vitest";
import {
  EngineValidationError,
  createDeck,
  shuffleDeck,
  cardKey, formatCard, secureRandomInt, type Card
} from "../src/index.js";

describe("createDeck", () => {
  it("creates all 52 unique cards", () => {
    const deck = createDeck();
    const keys = new Set(deck.map((card) => `${card.rank}:${card.suit}`));

    expect(deck).toHaveLength(52);
    expect(keys.size).toBe(52);
  });

  it("creates independent cards and arrays", () => {
    const first = createDeck();
    const second = createDeck();

    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(first).toEqual(second);
  });
});

describe("shuffleDeck", () => {
  it("uses Fisher-Yates without mutating the input", () => {
    const deck = createDeck();
    const original = structuredClone(deck);
    const shuffled = shuffleDeck(deck, () => 0);

    expect(deck).toEqual(original);
    expect(shuffled).not.toEqual(deck);
    expect(new Set(shuffled.map((card) => `${card.rank}:${card.suit}`))).toEqual(
      new Set(deck.map((card) => `${card.rank}:${card.suit}`))
    );
  });

  it("is reproducible with an injected random source", () => {
    const first = shuffleDeck(createDeck(), (maximum) => maximum - 1);
    const second = shuffleDeck(createDeck(), (maximum) => maximum - 1);

    expect(first).toEqual(second);
  });

  it("rejects duplicate cards", () => {
    const deck = createDeck();
    deck[1] = deck[0]!;

    expect(() => shuffleDeck(deck)).toThrowError(
      expect.objectContaining({ code: "DUPLICATE_CARD" })
    );
  });

  it.each([-1, 2, NaN, Infinity, 0.5])("rejects an invalid random value: %s", (value) => {
    expect(() => shuffleDeck(createDeck(), () => value)).toThrowError(
      expect.objectContaining({ code: "INVALID_RANDOM_VALUE" })
    );
  });

  it("exports a typed validation error", () => {
    const error = new EngineValidationError("DUPLICATE_CARD", "duplicate");
    expect(error.code).toBe("DUPLICATE_CARD");
  });
});

describe("card boundaries", () => {
  it("formats face cards and ten without key collisions", () => {
    expect(formatCard({rank: 14, suit: "spades"})).toBe("AS");
    expect(formatCard({rank: 10, suit: "hearts"})).toBe("10H");
    expect(new Set(createDeck().map(cardKey)).size).toBe(52);
    for (const rank of [2,3,4,5,6,7,8,9,10,11,12,13,14]) {
      expect(createDeck().filter(card => card.rank === rank)).toHaveLength(4);
    }
    for (const suit of ["clubs","diamonds","hearts","spades"]) {
      expect(createDeck().filter(card => card.suit === suit)).toHaveLength(13);
    }
  });
  it("shuffles with the production cryptographic source", () => {
    expect(shuffleDeck(createDeck()).map(cardKey).sort()).toEqual(createDeck().map(cardKey).sort());
    expect(secureRandomInt(1)).toBe(0);
  });
  it("handles empty and singleton inputs", () => {
    expect(shuffleDeck([])).toEqual([]);
    expect(shuffleDeck([{rank: 2, suit: "clubs"}])).toEqual([{rank: 2, suit: "clubs"}]);
  });
  it("performs the expected swaps on a small deck", () => {
    const input: Card[] = [2,3,4,5].map(rank => ({rank: rank as Card["rank"], suit: "clubs"}));
    expect(shuffleDeck(input, () => 0).map(card => card.rank)).toEqual([3,4,5,2]);
  });
  it.each([null, {rank: 15, suit: "clubs"}, {rank: 2.5, suit: "clubs"}, {rank: 2, suit: "invalid"}])(
    "rejects malformed runtime cards: %j", card => {
      expect(() => shuffleDeck([card] as Card[])).toThrowError(expect.objectContaining({code: "INVALID_CARD"}));
    }
  );
});
