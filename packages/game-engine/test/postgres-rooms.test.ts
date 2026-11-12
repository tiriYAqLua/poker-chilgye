import {afterEach, describe, expect, it} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {PostgresWalletStore} from "../../../apps/server/src/postgres-wallet.js";
import {AsyncRoomManager} from "../../../apps/server/src/rooms-async.js";

describe("AsyncRoomManager",()=>{
  const databases:PGlite[]=[];
  afterEach(async()=>{await Promise.all(databases.splice(0).map(database=>database.close()));});

  it("starts and settles a server-owned hand against PostgreSQL",async()=>{
    const database=new PGlite();databases.push(database);
    await PostgresWalletStore.migrate(database);
    const wallet=await PostgresWalletStore.open(database);
    const alice=await wallet.createGuest(),bob=await wallet.createGuest();
    const rooms=await AsyncRoomManager.restore(wallet,Buffer.alloc(32,6));
    const room=await rooms.create(alice.id,"Alice");
    await rooms.join(room.code,bob.id,"Bob");
    const hand=await rooms.start(room.code,alice.id);

    expect(hand.id).toBeTruthy();
    expect((await wallet.activeHandIds())).toEqual([hand.id]);
  });

  it("deals unique cards to five bots and restores a hand with turns intact",async()=>{
    const database=new PGlite();databases.push(database);
    await PostgresWalletStore.migrate(database);
    const wallet=await PostgresWalletStore.open(database),human=await wallet.createGuest(),key=Buffer.alloc(32,7);
    let rooms=await AsyncRoomManager.restore(wallet,key);
    const room=await rooms.create(human.id,"Alice");await rooms.addBots(room);
    expect(room.players).toHaveLength(6);
    const hand=await rooms.start(room.code,human.id);
    const cards=[...hand.table.cards.board,...[...hand.table.cards.holes.values()].flat()];
    expect(new Set(cards).size).toBe(17);
    const turn=hand.table.betting.turn!;
    const player=hand.table.betting.players.find(p=>p.id===turn)!;
    await expect(rooms.action(room.code,"not-the-turn",hand.id,hand.version,{type:"call"})).rejects.toThrow();
    await rooms.action(room.code,turn,hand.id,hand.version,{type:player.streetBet>=hand.table.betting.currentBet?"check":"call"});
    const current=rooms.get(room.code)!.hand!;
    rooms=await AsyncRoomManager.restore(wallet,key);
    expect(rooms.get(room.code)?.hand?.table.betting.turn).toBe(current.table.betting.turn);
    expect(rooms.get(room.code)?.players.filter(p=>p.id.startsWith("bot:"))).toHaveLength(5);
  });
});
