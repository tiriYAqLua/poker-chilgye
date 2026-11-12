import {afterEach, describe, expect, it} from "vitest";
import {WalletStore} from "../../../apps/server/src/wallet.js";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

describe("persistent chip accounting", () => {
  let store:WalletStore;
  afterEach(()=>store?.close());
  it("keeps balances and transfers atomic and idempotent", () => {
    store=new WalletStore(":memory:");
    const alice=store.createGuest(), bob=store.createGuest();
    expect(store.balance(alice.id)).toBe(10000);
    expect(store.transfer(alice.id,bob.id,250,"hand-1")).toBe(true);
    expect(store.transfer(alice.id,bob.id,250,"hand-1")).toBe(false);
    expect(store.balance(alice.id)).toBe(9750);
    expect(store.balance(bob.id)).toBe(10250);
    expect(()=>store.transfer(alice.id,bob.id,20000,"hand-2")).toThrow();
    expect(store.balance(alice.id)).toBe(9750);
  });
  it("refuses to reuse a transaction ID for a different transfer", () => {
    store=new WalletStore(":memory:");
    const a=store.createGuest(), b=store.createGuest();
    store.transfer(a.id,b.id,10,"same");
    expect(()=>store.transfer(a.id,b.id,20,"same")).toThrow();
    expect(store.balance(b.id)).toBe(10010);
  });
  it("grants 5000 once per hour regardless of balance", () => {
    store=new WalletStore(":memory:");
    const a=store.createGuest(), b=store.createGuest();
    expect(store.grant(a.id,100000)).toBe(15000);
    store.transfer(a.id,b.id,6000,"spend2");
    expect(()=>store.grant(a.id,100000+3599999)).toThrow();
    expect(store.grant(a.id,100000+3600000)).toBe(14000);
  });
  it("authenticates guests using a secret token", () => {
    store=new WalletStore(":memory:");
    const guest=store.createGuest();
    expect(store.authenticate(guest.token)).toBe(guest.id);
    expect(store.authenticate("wrong")).toBeNull();
  });
  it("links a guest wallet to a verified Google identity and switches without merging wallets",()=>{
    store=new WalletStore(":memory:");
    const guest=store.createGuest(),other=store.createGuest();
    expect(store.profile(guest.id).accountType).toBe("guest");
    store.transfer(guest.id,other.id,1000,"google-test");
    const first=store.loginGoogle(guest.id,"google-subject-1","Alice Google");
    expect(first.id).toBe(guest.id);
    expect(store.profile(guest.id).accountType).toBe("google");
    expect(store.profile(guest.id).googleName).toBe("Alice Google");
    expect(store.authenticate(first.token)).toBe(guest.id);
    const second=store.loginGoogle(guest.id,"google-subject-2");
    expect(second.id).not.toBe(guest.id);
    expect(store.balance(second.id)).toBe(10000);
    const again=store.loginGoogle(other.id,"google-subject-1");
    expect(again.id).toBe(guest.id);
    expect(store.balance(again.id)).toBe(9000);
    expect(store.balance(other.id)).toBe(11000);
    expect(store.profile(other.id).accountType).toBe("guest");
    store.reserve(second.id,"room",1000);
    expect(()=>store.loginGoogle(second.id,"google-subject-1")).toThrow();
  });
  it("reserves a buy-in and cashes it out exactly once", () => {
    store=new WalletStore(":memory:");
    const a=store.createGuest();
    store.reserve(a.id,"room",6000);
    expect(store.balance(a.id)).toBe(4000);
    expect(store.seat(a.id)).toEqual({room:"room",stack:6000});
    expect(store.grant(a.id,100000)).toBe(9000);
    expect(()=>store.reserve(a.id,"other",1000)).toThrow();
    expect(store.cashOut(a.id)).toBe(15000);
    expect(()=>store.cashOut(a.id)).toThrow();
  });
  it("settles table stacks atomically and rejects creating chips or duplicate settlements", () => {
    store=new WalletStore(":memory:");
    const a=store.createGuest(), b=store.createGuest();
    store.reserve(a.id,"room",1000);store.reserve(b.id,"room",1000);
    store.beginHand("room","hand-1",[a.id,b.id]);
    expect(()=>store.cashOut(a.id)).toThrow();
    expect(()=>store.settle("room","hand-1",[{id:a.id,stack:1600},{id:b.id,stack:600}])).toThrow();
    expect(store.seat(a.id)?.stack).toBe(1000);
    expect(store.settle("room","hand-1",[{id:a.id,stack:1300},{id:b.id,stack:700}])).toBe(true);
    expect(store.settle("room","hand-1",[{id:a.id,stack:1300},{id:b.id,stack:700}])).toBe(false);
    expect(store.seat(a.id)?.stack).toBe(1300);
    expect(()=>store.settle("room","hand-1",[{id:a.id,stack:1400},{id:b.id,stack:600}])).toThrow();
    expect(store.cashOut(a.id)).toBe(10300);
    expect(store.cashOut(b.id)).toBe(9700);
  });
  it("refuses incomplete settlements while keeping all stakes locked", () => {
    store=new WalletStore(":memory:");
    const a=store.createGuest(), b=store.createGuest(), c=store.createGuest();
    store.reserve(a.id,"room",1000);store.reserve(b.id,"room",1000);store.reserve(c.id,"room",1000);
    store.beginHand("room","hand-2",[a.id,b.id,c.id]);
    expect(()=>store.settle("room","hand-2",[{id:a.id,stack:1000},{id:b.id,stack:1000}])).toThrow();
    expect(()=>store.cashOut(c.id)).toThrow();
    expect(store.seat(c.id)?.stack).toBe(1000);
  });
  it("does not grant chips while the player's hand is unresolved", () => {
    store=new WalletStore(":memory:");
    const a=store.createGuest(), b=store.createGuest();
    store.transfer(a.id,b.id,7000,"spend");
    store.reserve(a.id,"room",2000);store.reserve(b.id,"room",2000);
    store.beginHand("room","unfinished",[a.id,b.id]);
    expect(()=>store.grant(a.id,100000)).toThrow();
  });
  it("retains the guest session and chips after closing and reopening the database", () => {
    const directory=mkdtempSync(join(tmpdir(),"poker-wallet-test-"));
    try {
      const path=join(directory,"wallet.sqlite");
      store=new WalletStore(path);
      const a=store.createGuest(), b=store.createGuest();
      store.transfer(a.id,b.id,123,"persist");
      store.close();
      store=new WalletStore(path);
      expect(store.authenticate(a.token)).toBe(a.id);
      expect(store.balance(a.id)).toBe(9877);
      expect(store.balance(b.id)).toBe(10123);
    } finally {
      store?.close();
      store=undefined as unknown as WalletStore;
      rmSync(directory,{recursive:true,force:true});
    }
  });
  it("stores encrypted hand snapshots atomically and rejects stale versions", () => {
    store=new WalletStore(":memory:");
    const a=store.createGuest(), b=store.createGuest();
    store.reserve(a.id,"room",1000); store.reserve(b.id,"room",1000);
    const key=Buffer.alloc(32,7);
    store.beginRecoverableHand("room","secret-hand",[a.id,b.id],{deck:["AS","KH"],turn:a.id},key);
    expect(store.loadHand("secret-hand",key)).toEqual({version:0,state:{deck:["AS","KH"],turn:a.id}});
    expect(()=>store.loadHand("secret-hand",Buffer.alloc(32,8))).toThrow();
    expect(store.saveHand("secret-hand",0,{deck:["AS","KH"],turn:b.id},key)).toBe(1);
    expect(()=>store.saveHand("secret-hand",0,{turn:a.id},key)).toThrow();
    expect(store.loadHand("secret-hand",key)).toEqual({version:1,state:{deck:["AS","KH"],turn:b.id}});
    store.settle("room","secret-hand",[{id:a.id,stack:1200},{id:b.id,stack:800}]);
    expect(store.loadHand("secret-hand",key)).toBeNull();
  });
});
