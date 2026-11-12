import { describe, expect, it } from "vitest";
import {
  HandCategory,
  compareHandValues,
  evaluateFive,
  evaluateSeven,
  type Card,
  type Rank,
  type Suit
} from "../src/index.js";

const suitBySymbol = {
  C: "clubs",
  D: "diamonds",
  H: "hearts",
  S: "spades"
} as const satisfies Record<string, Suit>;

const rankBySymbol: Record<string, Rank> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
  "8": 8, "9": 9, T: 10, J: 11, Q: 12, K: 13, A: 14
};

function cards(value: string): Card[] {
  return value.split(" ").map((token) => ({
    rank: rankBySymbol[token[0]!]!,
    suit: suitBySymbol[token.at(-1)! as keyof typeof suitBySymbol]
  }));
}

describe("evaluateFive", () => {
  it.each([
    ["AS KD QH JC 9D", "AS KD QH JC 8D"],
    ["AS AD KH QC JD", "AS AD KH QC TD"],
    ["AS AD KH QC JD", "AS AD KH JC TD"],
    ["AS AD KH QC JD", "AS AD QH JC TD"],
    ["AS AD KH KC QD", "AS AD KH KC JD"],
    ["AS AD KH KC QD", "AS AD QH QC KD"],
    ["KS KD QH QC AD", "JS JD TH TC AD"],
    ["AS AD AH KC QD", "AS AD AH KC JD"],
    ["AS AD AH KC QD", "AS AD AH QC JD"],
    ["AS KS QS JS 9S", "AH KH QH JH 8H"],
    ["AS AD AH KC KD", "AS AD AH QC QD"],
    ["AS AD AH KC KD", "KS KD KH AC AD"],
    ["AS AD AH AC KD", "AS AD AH AC QD"],
    ["AS AD AH AC KD", "KS KD KH KC AD"],
    ["AS KD QH JC TD", "KS QD JH TC 9D"],
    ["6S 5D 4H 3C 2D", "AS 5D 4H 3C 2D"]
  ])("orders tie breakers: %s > %s", (strong, weak) => {
    expect(compareHandValues(evaluateFive(cards(strong)), evaluateFive(cards(weak)))).toBe(1);
  });
  it("orders all nine categories", () => {
    const hands = ["AS KD 9H 6C 3D","AS AD 9H 6C 3D","AS AD 9H 9C 3D",
      "AS AD AH 6C 3D","9S 8D 7H 6C 5D","AS QS 9S 6S 3S",
      "AS AD AH 6C 6D","AS AD AH AC 3D","9S 8S 7S 6S 5S"].map(h => evaluateFive(cards(h)));
    for (let i = 1; i < hands.length; i++) expect(compareHandValues(hands[i]!, hands[i-1]!)).toBe(1);
  });
  it.each([
    ["AS KD 9H 6C 3D", HandCategory.HighCard, [14, 13, 9, 6, 3]],
    ["AS AD 9H 6C 3D", HandCategory.OnePair, [14, 9, 6, 3]],
    ["AS AD 9H 9C 3D", HandCategory.TwoPair, [14, 9, 3]],
    ["AS AD AH 6C 3D", HandCategory.ThreeOfAKind, [14, 6, 3]],
    ["9S 8D 7H 6C 5D", HandCategory.Straight, [9]],
    ["AS QS 9S 6S 3S", HandCategory.Flush, [14, 12, 9, 6, 3]],
    ["AS AD AH 6C 6D", HandCategory.FullHouse, [14, 6]],
    ["AS AD AH AC 3D", HandCategory.FourOfAKind, [14, 3]],
    ["9S 8S 7S 6S 5S", HandCategory.StraightFlush, [9]]
  ])("evaluates %s", (input, category, tiebreak) => {
    const value = evaluateFive(cards(input));
    expect(value.category).toBe(category);
    expect(value.tiebreak).toEqual(tiebreak);
  });

  it("recognizes the wheel as a five-high straight", () => {
    expect(evaluateFive(cards("AS 2D 3H 4C 5D")).tiebreak).toEqual([5]);
  });

  it("does not confuse a flush with a straight flush", () => {
    expect(evaluateFive(cards("AS JS 8S 6S 3S")).category).toBe(HandCategory.Flush);
  });

  it("compares categories and every kicker lexicographically", () => {
    const pair = evaluateFive(cards("AS AD 9H 6C 3D"));
    const highCard = evaluateFive(cards("AS KD QH JC 9D"));
    const betterPair = evaluateFive(cards("AS AD TH 6C 3D"));

    expect(compareHandValues(pair, highCard)).toBe(1);
    expect(compareHandValues(pair, betterPair)).toBe(-1);
  });

  it("treats equivalent hands of different suits as a tie", () => {
    const first = evaluateFive(cards("AS KD QH JC 9D"));
    const second = evaluateFive(cards("AH KS QD JH 9C"));
    expect(compareHandValues(first, second)).toBe(0);
  });

  it("requires exactly five unique cards", () => {
    expect(() => evaluateFive(cards("AS KD QH JC"))).toThrowError(
      expect.objectContaining({ code: "INVALID_CARD_COUNT" })
    );
    expect(() => evaluateFive(cards("AS AS QH JC 9D"))).toThrowError(
      expect.objectContaining({ code: "DUPLICATE_CARD" })
    );
  });
});

describe("evaluateSeven", () => {
  it.each([
    ["AS KS QS JS TS 2D 3C", HandCategory.StraightFlush, [14]],
    ["AS 2D 3H 4C 5S KD QC", HandCategory.Straight, [5]],
    ["AS AD KH KC QD QS 2H", HandCategory.TwoPair, [14,13,12]],
    ["AS KS 9S 7S 3S QD JC", HandCategory.Flush, [14,13,9,7,3]],
    ["AS AD AH AC KS KD KH", HandCategory.FourOfAKind, [14,13]],
    ["2D 3C AS KS QS JS TS", HandCategory.StraightFlush, [14]],
    ["AS 2C KS QS JS TS 3D", HandCategory.StraightFlush, [14]]
  ])("selects the best hand for %s", (input, category, tiebreak) => {
    const original = cards(input);
    const copy = structuredClone(original);
    const result = evaluateSeven(original);
    expect(result.category).toBe(category);
    expect(result.tiebreak).toEqual(tiebreak);
    expect(result.cards).toHaveLength(5);
    expect(original).toEqual(copy);
  });
  it("canonicalizes ties where either suit can fill a straight", () => {
    const input = cards("AS AH KD QC JS TD 2C");
    expect(evaluateSeven(input)).toEqual(evaluateSeven([...input].reverse()));
  });
  it.each([null, {rank: 1, suit: "clubs"}, {rank: 14, suit: "stars"}])("validates card values: %j", invalid => {
    const input = cards("AS KD QH JC 9D 8S 7C");
    input[0] = invalid as Card;
    expect(() => evaluateSeven(input)).toThrowError(expect.objectContaining({code: "INVALID_CARD"}));
    expect(() => evaluateFive(input.slice(0, 5))).toThrowError(expect.objectContaining({code: "INVALID_CARD"}));
  });
  it("chooses the best five cards from all 21 combinations", () => {
    const value = evaluateSeven(cards("AS AD AH KC KD 2S 3D"));
    expect(value.category).toBe(HandCategory.FullHouse);
    expect(value.tiebreak).toEqual([14, 13]);
  });

  it("selects the stronger of two possible full houses", () => {
    const value = evaluateSeven(cards("AS AD AH KC KD KH 2S"));
    expect(value.tiebreak).toEqual([14, 13]);
  });

  it("selects the five highest cards from a seven-card flush", () => {
    const value = evaluateSeven(cards("AS QS 9S 7S 5S 3S 2S"));
    expect(value.category).toBe(HandCategory.Flush);
    expect(value.tiebreak).toEqual([14, 12, 9, 7, 5]);
  });

  it("is independent of input order", () => {
    const input = cards("AS KS QS JS TS 2D 3C");
    const forward = evaluateSeven(input);
    const reverse = evaluateSeven([...input].reverse());
    expect(reverse.category).toBe(forward.category);
    expect(reverse.tiebreak).toEqual(forward.tiebreak);
    expect(reverse.cards).toEqual(forward.cards);
  });

  it("requires exactly seven unique cards", () => {
    expect(() => evaluateSeven(cards("AS KD QH JC 9D 8S"))).toThrowError(
      expect.objectContaining({ code: "INVALID_CARD_COUNT" })
    );
    expect(() => evaluateSeven(cards("AS AS QH JC 9D 8S 7C"))).toThrowError(
      expect.objectContaining({ code: "DUPLICATE_CARD" })
    );
  });
});
