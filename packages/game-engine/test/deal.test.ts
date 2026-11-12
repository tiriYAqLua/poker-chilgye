import { describe, it, expect } from "vitest";
import { createHand, viewHand, advanceHand } from "../../..//apps/server/src/deal.js";

describe("server hand privacy", () => {
  it("deals distinct private cards and reveals the board by stages", () => {
    const hand = createHand(["a", "b"]);
    const a = viewHand(hand, "a");
    const b = viewHand(hand, "b");
    expect(a.hole).toHaveLength(2);
    expect(b.hole).toHaveLength(2);
    expect(new Set([...a.hole, ...b.hole]).size).toBe(4);
    expect(a.board).toHaveLength(0);
    expect(JSON.stringify(a)).not.toContain(b.hole[0]);
    advanceHand(hand);
    expect(viewHand(hand, "a").board).toHaveLength(3);
    advanceHand(hand);
    expect(viewHand(hand, "b").board).toHaveLength(4);
    advanceHand(hand);
    expect(viewHand(hand, "a").board).toHaveLength(5);
  });
  it("rejects too few players and outsiders", () => {
    expect(() => createHand(["a"])).toThrow();
    expect(() => viewHand(createHand(["a", "b"]), "x")).toThrow();
  });
  it("reveals the winner and hands only at showdown", () => {
    const hand = {stage: 3, board: ["2C","3D","7H","9S","JC"], holes: new Map([["a",["AS","AD"]],["b",["KS","KD"]]])};
    expect(viewHand(hand, "a")).not.toHaveProperty("showdown");
    advanceHand(hand);
    expect(viewHand(hand, "a").showdown).toEqual({
      winners: ["a"],
      players: [{id:"a", hole:["AS","AD"], category:1}, {id:"b", hole:["KS","KD"], category:1}]
    });
  });
  it("reports all winners when the board makes a tie", () => {
    const hand = {stage: 4, board: ["10S","JS","QS","KS","AS"], holes: new Map([["a",["2C","3D"]],["b",["4C","5D"]]])};
    expect(viewHand(hand, "a").showdown?.winners).toEqual(["a","b"]);
  });
});
