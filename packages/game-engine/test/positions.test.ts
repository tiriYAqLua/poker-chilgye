import {describe,expect,it} from "vitest";
import {positionLabels} from "../../../apps/web/src/positions.js";

describe("table position labels",()=>{
  it("uses the button as small blind heads-up",()=>{
    const players=[{id:"a"},{id:"b"}];
    expect(positionLabels(players,0,"a")).toEqual(["D","SB"]);
    expect(positionLabels(players,0,"b")).toEqual(["BB"]);
  });
  it("places blinds clockwise after the button for three or more players",()=>{
    const players=[{id:"a"},{id:"b"},{id:"c"}];
    expect(positionLabels(players,2,"c")).toEqual(["D"]);
    expect(positionLabels(players,2,"a")).toEqual(["SB"]);
    expect(positionLabels(players,2,"b")).toEqual(["BB"]);
    expect(positionLabels(players,2,"unknown")).toEqual([]);
  });
});
