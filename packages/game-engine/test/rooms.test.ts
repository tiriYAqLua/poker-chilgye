import {afterEach,describe,expect,it} from "vitest";
import {WalletStore} from "../../../apps/server/src/wallet.js";
import {RoomManager} from "../../../apps/server/src/rooms.js";

describe("rooms with a persistent wallet",()=>{
  let store:WalletStore;
  afterEach(()=>store?.close());
  it("reserves chips, settles a hand and returns the correct amounts on exit",()=>{
    store=new WalletStore(":memory:");
    const a=store.createGuest(), b=store.createGuest();
    const manager=new RoomManager(store,Buffer.alloc(32,7));
    const code=manager.create(a.id,"Alice");
    manager.join(code,b.id,"Bob");
    expect(store.balance(a.id)).toBe(0);
    expect(store.seat(a.id)?.stack).toBe(10000);
    const initial=manager.start(code,a.id);
    expect(initial.table.betting.turn).toBe(a.id);
    manager.action(code,a.id,initial.id,initial.version,{type:"fold"});
    manager.leave(code,a.id);manager.leave(code,b.id);
    expect(store.balance(a.id)).toBe(9950);
    expect(store.balance(b.id)).toBe(10050);
  });
  it("does not let a second connection create a second seat for the same account",()=>{
    store=new WalletStore(":memory:");
    const a=store.createGuest(),b=store.createGuest();
    const manager=new RoomManager(store,Buffer.alloc(32,7));
    const first=manager.create(a.id,"Alice");
    const second=manager.create(b.id,"Bob");
    expect(()=>manager.join(second,a.id,"Alice")).toThrow();
    expect(manager.join(first,a.id,"Alice").players).toHaveLength(1);
    expect(store.balance(a.id)).toBe(0);
  });
  it("recovers an unfinished hand from its encrypted snapshot",()=>{
    store=new WalletStore(":memory:");
    const a=store.createGuest(),b=store.createGuest(),key=Buffer.alloc(32,7);
    const old=new RoomManager(store,key), code=old.create(a.id,"Alice");
    old.join(code,b.id,"Bob");
    const start=old.start(code,a.id);
    const progress=old.action(code,a.id,start.id,start.version,{type:"call"});
    const recovered=new RoomManager(store,key);
    expect(recovered.get(code)?.players.map(p=>p.name)).toEqual(["Alice","Bob"]);
    const room=recovered.join(code,a.id,"Alice");
    expect(room.hand?.table.betting.turn).toBe(b.id);
    expect(room.hand?.version).toBe(progress.version);
    expect(room.hand?.table.cards.holes.get(a.id)).toEqual(progress.table.cards.holes.get(a.id));
  });
  it("remembers a pending departure after a restart and returns the chips after the hand",()=>{
    store=new WalletStore(":memory:");
    const a=store.createGuest(),b=store.createGuest(),c=store.createGuest(),key=Buffer.alloc(32,7);
    const old=new RoomManager(store,key),code=old.create(a.id,"Alice");
    old.join(code,b.id,"Bob");old.join(code,c.id,"Carol");old.start(code,a.id);
    old.leave(code,a.id);
    expect(old.get(code)?.hand?.table.result).toBeUndefined();
    const recovered=new RoomManager(store,key);
    expect(recovered.get(code)?.players.find(p=>p.id===a.id)?.leaving).toBe(true);
    expect(()=>recovered.join(code,a.id,"Alice")).toThrow();
    const hand=recovered.get(code)!.hand!;
    const turn=hand.table.betting.turn!;
    recovered.action(code,turn,hand.id,hand.version,{type:"fold"});
    expect(store.seat(a.id)).toBeNull();
    expect(store.balance(a.id)).toBe(10000);
  });
  it("supports six players, rejects a seventh, and conserves chips through a completed hand",()=>{
    store=new WalletStore(":memory:");
    const guests=Array.from({length:7},()=>store.createGuest());
    const manager=new RoomManager(store,Buffer.alloc(32,6));
    const code=manager.create(guests[0]!.id,"Player 1");
    for(let i=1;i<6;i++)manager.join(code,guests[i]!.id,`Player ${i+1}`);
    expect(()=>manager.join(code,guests[6]!.id,"Player 7")).toThrow();
    expect(store.balance(guests[6]!.id)).toBe(10000);
    manager.start(code,guests[0]!.id);
    while(!manager.get(code)!.hand!.table.result) {
      const hand=manager.get(code)!.hand!,turn=hand.table.betting.turn!;
      manager.action(code,turn,hand.id,hand.version,{type:"fold"});
    }
    for(let i=0;i<6;i++)manager.leave(code,guests[i]!.id);
    expect(guests.reduce((sum,guest)=>sum+store.balance(guest.id),0)).toBe(70000);
    expect(guests.slice(0,6).every(guest=>store.handHistory(guest.id).length===1)).toBe(true);
  });
  it("moves the dealer to the next remaining player when the previous dealer leaves",()=>{
    store=new WalletStore(":memory:");
    const a=store.createGuest(),b=store.createGuest(),c=store.createGuest();
    const manager=new RoomManager(store,Buffer.alloc(32,4)),code=manager.create(a.id,"A");
    manager.join(code,b.id,"B");manager.join(code,c.id,"C");
    let hand=manager.start(code,a.id);
    expect(hand.table.betting.players[hand.table.betting.button]?.id).toBe(a.id);
    while(!hand.table.result)hand=manager.action(code,hand.table.betting.turn!,hand.id,hand.version,{type:"fold"});
    manager.leave(code,a.id);
    hand=manager.start(code,b.id);
    expect(hand.table.betting.players[hand.table.betting.button]?.id).toBe(b.id);
  });
});
