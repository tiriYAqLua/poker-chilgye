import {describe, it, expect} from "vitest";
import {newTableHand, tableAction, tableView} from "../../../apps/server/src/table.js";

describe("server table hand", () => {
  it("hides private cards, enforces turn order and pays the folded hand", () => {
    const table=newTableHand([{id:"a",stack:1000},{id:"b",stack:1000}],0);
    const first=tableView(table,"a");
    const second=tableView(table,"b");
    expect(first.hole).toHaveLength(2);
    expect(JSON.stringify(first)).not.toContain(second.hole[0]);
    expect(()=>tableAction(table,"b",{type:"check"})).toThrow();
    tableAction(table,"a",{type:"fold"});
    expect(table.betting.street).toBe("complete");
    expect(table.betting.players.map(p=>p.stack)).toEqual([950,1050]);
    expect(tableView(table,"b").result?.winners).toEqual(["b"]);
    expect(tableView(table,"b").result?.players).toEqual([]);
  });
  it("advances on completed betting rounds and settles once after river", () => {
    const table=newTableHand([{id:"a",stack:1000},{id:"b",stack:1000}],0);
    tableAction(table,"a",{type:"call"});
    tableAction(table,"b",{type:"check"});
    expect(tableView(table,"a").board).toHaveLength(3);
    for(let i=0;i<3;i++){tableAction(table,"b",{type:"check"});tableAction(table,"a",{type:"check"});}
    expect(table.betting.street).toBe("complete");
    expect(table.betting.pot).toBe(0);
    expect(table.betting.players.reduce((sum,p)=>sum+p.stack,0)).toBe(2000);
    expect(tableView(table,"a").result?.players).toHaveLength(2);
    expect(()=>tableAction(table,"a",{type:"check"})).toThrow();
  });
  it("keeps already exposed community cards after a fold on the flop", () => {
    const table=newTableHand([{id:"a",stack:1000},{id:"b",stack:1000}],0);
    tableAction(table,"a",{type:"call"}); tableAction(table,"b",{type:"check"});
    const flop=tableView(table,"a").board;
    tableAction(table,"b",{type:"fold"});
    expect(tableView(table,"a").board).toEqual(flop);
  });
  it("pays the main pot and side pot to different players",()=>{
    const table=newTableHand([{id:"a",stack:100},{id:"b",stack:200},{id:"c",stack:300}],0);
    table.cards.holes=new Map([["a",["AS","AD"]],["b",["KS","KD"]],["c",["QS","QD"]]]);
    table.cards.board=["2C","3D","7H","9S","JC"];
    tableAction(table,"a",{type:"call"});
    tableAction(table,"b",{type:"call"});
    tableAction(table,"c",{type:"raise",to:200});
    tableAction(table,"b",{type:"call"});
    expect(table.result?.payouts).toEqual({a:300,b:200,c:0});
    expect(table.betting.players.map(player=>player.stack)).toEqual([300,200,100]);
  });
});
