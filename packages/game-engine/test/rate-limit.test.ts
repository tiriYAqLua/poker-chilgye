import {describe,expect,it} from "vitest";
import {AttemptLimiter} from "../../../apps/server/src/rate-limit.js";

describe("room code attempts",()=>{
  it("limits repeated failed attempts per account and restores access after the window",()=>{
    const limiter=new AttemptLimiter(3,60000);
    for(let i=0;i<3;i++){expect(limiter.allowed("a",1000)).toBe(true);limiter.fail("a",1000);}
    expect(limiter.allowed("a",1001)).toBe(false);
    expect(limiter.allowed("b",1001)).toBe(true);
    expect(limiter.allowed("a",61000)).toBe(true);
    limiter.fail("a",61000);limiter.reset("a");
    expect(limiter.allowed("a",61001)).toBe(true);
  });
});
