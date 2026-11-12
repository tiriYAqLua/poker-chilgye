import { describe, expect, it } from "vitest";
import { startBetting, act, awardPots, forfeit } from "../src/betting.js";

describe("No Limit betting", () => {
  it("allows a player who checked to raise a short opening all-in", () => {
    const hand=startBetting([{id:"a",stack:1000},{id:"b",stack:1000},{id:"c",stack:150}],0,50,100);
    act(hand,"a",{type:"call"});act(hand,"b",{type:"call"});act(hand,"c",{type:"check"});
    act(hand,"b",{type:"check"});act(hand,"c",{type:"raise",to:50});act(hand,"a",{type:"call"});
    expect(hand.turn).toBe("b");
    expect(()=>act(hand,"b",{type:"raise",to:150})).not.toThrow();
  });
  it("keeps an all-in player eligible after disconnect", () => {
    const hand=startBetting([{id:"a",stack:1000},{id:"b",stack:1000},{id:"c",stack:100}],0,50,100);
    expect(hand.players[2]?.stack).toBe(0);
    forfeit(hand,"c");
    expect(hand.players[2]?.folded).toBe(false);
  });
  it("folds a disconnected player without skipping another player's turn", () => {
    const hand=startBetting([{id:"a",stack:1000},{id:"b",stack:1000},{id:"c",stack:1000}],0,50,100);
    forfeit(hand,"b");
    expect(hand.turn).toBe("a");
    expect(hand.players[1]?.folded).toBe(true);
    act(hand,"a",{type:"call"});
    expect(hand.turn).toBe("c");
  });
  it("advances immediately when the player whose turn it is leaves", () => {
    const hand=startBetting([{id:"a",stack:1000},{id:"b",stack:1000},{id:"c",stack:1000}],0,50,100);
    forfeit(hand,"a");
    expect(hand.turn).toBe("b");
  });
  it("posts blinds and gives heads-up button the first preflop action", () => {
    const hand = startBetting([{id:"a",stack:1000},{id:"b",stack:1000}], 0, 50, 100);
    expect(hand.turn).toBe("a");
    expect(hand.players.map(p => [p.stack,p.streetBet])).toEqual([[950,50],[900,100]]);
    expect(hand.pot).toBe(150);
    act(hand, "a", {type:"call"});
    expect(hand.turn).toBe("b");
    act(hand, "b", {type:"check"});
    expect(hand.street).toBe("flop");
    expect(hand.turn).toBe("b");
  });
  it("rejects out of turn and illegal raises without changing the state", () => {
    const hand = startBetting([{id:"a",stack:1000},{id:"b",stack:1000}], 0, 50, 100);
    const original = structuredClone(hand);
    expect(() => act(hand, "b", {type:"check"})).toThrow();
    expect(() => act(hand, "a", {type:"raise",to:150})).toThrow();
    expect(hand).toEqual(original);
  });
  it("awards the bank immediately when everyone else folds", () => {
    const hand = startBetting([{id:"a",stack:1000},{id:"b",stack:1000}], 0, 50, 100);
    act(hand, "a", {type:"fold"});
    expect(hand.street).toBe("complete");
    expect(hand.players.map(p => p.stack)).toEqual([950,1050]);
    expect(hand.pot).toBe(0);
  });
  it("builds side pots, returns unmatched excess and conserves chips", () => {
    const payouts = awardPots([
      {id:"a",contribution:100,folded:false},
      {id:"b",contribution:250,folded:false},
      {id:"c",contribution:400,folded:false}
    ], [["a"],["b"],["c"]], 0);
    expect(payouts).toEqual({a:300,b:300,c:150});
  });
  it("splits ties with the odd chip clockwise after the button", () => {
    const payouts = awardPots([
      {id:"a",contribution:5,folded:false},
      {id:"b",contribution:5,folded:false},
      {id:"c",contribution:5,folded:true}
    ], [["a","b"]], 0);
    expect(payouts).toEqual({a:7,b:8,c:0});
  });
  it("does not reopen a raise after a single short all-in", () => {
    const hand=startBetting([{id:"a",stack:1000},{id:"b",stack:1000},{id:"c",stack:250}],0,50,100);
    act(hand,"a",{type:"raise",to:200});
    act(hand,"b",{type:"call"});
    act(hand,"c",{type:"raise",to:250});
    expect(hand.turn).toBe("a");
    expect(()=>act(hand,"a",{type:"raise",to:350})).toThrow();
    act(hand,"a",{type:"call"});
    act(hand,"b",{type:"call"});
    expect(hand.street).toBe("flop");
  });
  it("requires the big blind to act after calls before advancing", () => {
    const hand=startBetting([{id:"a",stack:1000},{id:"b",stack:1000},{id:"c",stack:1000}],0,50,100);
    act(hand,"a",{type:"call"});
    act(hand,"b",{type:"call"});
    expect(hand.street).toBe("preflop");
    expect(hand.turn).toBe("c");
    act(hand,"c",{type:"raise",to:200});
    expect(hand.turn).toBe("a");
  });
  it("runs out the board when both players are all in", () => {
    const hand=startBetting([{id:"a",stack:100},{id:"b",stack:100}],0,50,100);
    act(hand,"a",{type:"call"});
    expect(hand.street).toBe("showdown");
    expect(hand.turn).toBeNull();
    expect(hand.pot).toBe(200);
  });
  it("does not offer a raise when the only opponent is already all in", () => {
    const hand=startBetting([{id:"a",stack:1000},{id:"b",stack:100}],0,50,100);
    expect(()=>act(hand,"a",{type:"raise",to:200})).toThrow();
    act(hand,"a",{type:"call"});
    expect(hand.street).toBe("showdown");
  });
});
