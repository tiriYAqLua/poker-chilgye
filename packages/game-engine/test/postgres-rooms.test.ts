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
});
