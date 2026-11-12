import {afterEach,describe,expect,it} from "vitest";
import {WalletStore} from "../../../apps/server/src/wallet.js";
import {startPersistentHand,advancePersistentHand,restorePersistentHand} from "../../../apps/server/src/persistent-hand.js";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";

describe("durable table",()=>{
  let store:WalletStore;
  afterEach(()=>store?.close());
  it("recovers private cards and the exact turn after an action",()=>{
    store=new WalletStore(":memory:");
    const a=store.createGuest(),b=store.createGuest(), key=Buffer.alloc(32,9);
    store.reserve(a.id,"room",1000);store.reserve(b.id,"room",1000);
    const hand=startPersistentHand(store,key,"room","h1",[a.id,b.id],0);
    const own=hand.table.cards.holes.get(a.id);
    const next=advancePersistentHand(store,key,hand,a.id,{type:"call"});
    const restored=restorePersistentHand(store,key,"h1");
    expect(restored.table.cards.holes.get(a.id)).toEqual(own);
    expect(restored.table.betting.turn).toBe(b.id);
    expect(restored.version).toBe(next.version);
    expect(()=>advancePersistentHand(store,key,hand,a.id,{type:"call"})).toThrow();
    expect(()=>advancePersistentHand(store,key,hand,a.id,{type:"fold"})).toThrow();
    expect(store.loadHand("h1",key)?.version).toBe(1);
  });
  it("settles the winner once and releases escrow for withdrawal",()=>{
    store=new WalletStore(":memory:");
    const a=store.createGuest(),b=store.createGuest(), key=Buffer.alloc(32,8);
    store.reserve(a.id,"room",1000);store.reserve(b.id,"room",1000);
    const hand=startPersistentHand(store,key,"room","h2",[a.id,b.id],0);
    const ended=advancePersistentHand(store,key,hand,a.id,{type:"fold"});
    expect(ended.table.betting.street).toBe("complete");
    expect(store.handHistory(a.id)).toEqual([expect.objectContaining({handId:"h2",room:"room",change:-50})]);
    expect(store.handHistory(b.id)).toEqual([expect.objectContaining({handId:"h2",room:"room",change:50})]);
    expect(store.cashOut(a.id)).toBe(9950);
    expect(store.cashOut(b.id)).toBe(10050);
    expect(store.loadHand("h2",key)).toBeNull();
  });
  it("recovers an encrypted ongoing hand after reopening the database",()=>{
    const dir=mkdtempSync(join(tmpdir(),"poker-hand-test-"));
    try {
      const path=join(dir,"db.sqlite"), key=Buffer.alloc(32,4);
      store=new WalletStore(path);
      const a=store.createGuest(),b=store.createGuest();
      store.reserve(a.id,"room",1000);store.reserve(b.id,"room",1000);
      const hand=startPersistentHand(store,key,"room","persist-hand",[a.id,b.id],0);
      const updated=advancePersistentHand(store,key,hand,a.id,{type:"call"});
      store.close();store=new WalletStore(path);
      expect(store.activeHandIds()).toEqual(["persist-hand"]);
      const restored=restorePersistentHand(store,key,"persist-hand");
      expect(restored.table.betting).toEqual(updated.table.betting);
      expect([...restored.table.cards.holes]).toEqual([...updated.table.cards.holes]);
      expect(()=>store.cashOut(a.id)).toThrow();
    } finally {store?.close();store=undefined as unknown as WalletStore;rmSync(dir,{recursive:true,force:true});}
  });
});
