import {afterEach, describe, expect, it} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {PostgresWalletStore} from "../../../apps/server/src/postgres-wallet.js";

describe("PostgresWalletStore", () => {
  const databases:PGlite[]=[];
  afterEach(async()=>{await Promise.all(databases.splice(0).map(database=>database.close()));});
  const open=async(database:PGlite)=>{await PostgresWalletStore.migrate(database);return PostgresWalletStore.open(database);};

  it("does not modify a database until an explicit migration is requested",async()=>{
    const database=new PGlite();
    databases.push(database);
    const store=await PostgresWalletStore.open(database);
    await expect(store.createGuest()).rejects.toThrow();
  });

  it("persists guest wallets and makes a transfer idempotent",async()=>{
    const database=new PGlite();
    databases.push(database);
    const store=await open(database);
    const alice=await store.createGuest(), bob=await store.createGuest();

    expect(await store.balance(alice.id)).toBe(10000);
    expect(await store.transfer(alice.id,bob.id,250,"transfer-1")).toBe(true);
    expect(await store.transfer(alice.id,bob.id,250,"transfer-1")).toBe(false);
    expect(await store.balance(alice.id)).toBe(9750);
    expect(await store.balance(bob.id)).toBe(10250);
  });

  it("keeps a hand escrowed, encrypts its snapshot, and settles it once",async()=>{
    const database=new PGlite();
    databases.push(database);
    const store=await open(database);
    const alice=await store.createGuest(), bob=await store.createGuest();
    const key=Buffer.alloc(32,9);

    await store.reserve(alice.id,"ROOM01",1000);
    await store.reserve(bob.id,"ROOM01",1000);
    await store.beginRecoverableHand("ROOM01","hand-1",[alice.id,bob.id],{turn:alice.id},key);
    expect(await store.loadHand("hand-1",key)).toEqual({version:0,state:{turn:alice.id}});
    expect(await store.saveHand("hand-1",0,{turn:bob.id},key)).toBe(1);
    expect(await store.settle("ROOM01","hand-1",[{id:alice.id,stack:1200},{id:bob.id,stack:800}],1)).toBe(true);
    expect(await store.settle("ROOM01","hand-1",[{id:alice.id,stack:1200},{id:bob.id,stack:800}],1)).toBe(false);
    expect(await store.loadHand("hand-1",key)).toBeNull();
  });

  it("keeps guest profile, friend invitations and the hourly grant in PostgreSQL",async()=>{
    const database=new PGlite();
    databases.push(database);
    const store=await open(database);
    const alice=await store.createGuest(), bob=await store.createGuest();

    await store.setDisplayName(alice.id,"Alice");
    const aliceCode=await store.friendCode(alice.id);
    const request=await store.requestFriend(bob.id,aliceCode);
    expect(await store.incomingRequests(alice.id)).toEqual([{id:request,senderId:bob.id,name:"Игрок"}]);
    await store.acceptFriend(alice.id,request);
    expect(await store.friends(alice.id)).toEqual([{id:bob.id,name:"Игрок"}]);
    expect(await store.grant(alice.id,100_000)).toBe(15000);
    await expect(store.grant(alice.id,100_001)).rejects.toThrow("Grant not available");
    expect(await store.profile(alice.id)).toMatchObject({id:alice.id,balance:15000,accountType:"guest"});
  });

  it("returns one stable friend code when two tabs request it at once",async()=>{
    const database=new PGlite();
    databases.push(database);
    const store=await open(database),guest=await store.createGuest();

    const [first,second]=await Promise.all([store.friendCode(guest.id),store.friendCode(guest.id)]);
    expect(first).toBe(second);
  });

  it("settles concurrent retries of one transfer as one idempotent operation",async()=>{
    const database=new PGlite();
    databases.push(database);
    const store=await open(database),alice=await store.createGuest(),bob=await store.createGuest();

    const results=await Promise.all([store.transfer(alice.id,bob.id,250,"same-transfer"),store.transfer(alice.id,bob.id,250,"same-transfer")]);
    expect(results.sort()).toEqual([false,true]);
    expect(await store.balance(alice.id)).toBe(9750);
    expect(await store.balance(bob.id)).toBe(10250);
  });

  it("settles concurrent retries of one hand exactly once",async()=>{
    const database=new PGlite();
    databases.push(database);
    const store=await open(database),alice=await store.createGuest(),bob=await store.createGuest(),key=Buffer.alloc(32,8);
    await store.reserve(alice.id,"ROOM01",1000);await store.reserve(bob.id,"ROOM01",1000);
    await store.beginRecoverableHand("ROOM01","parallel-hand",[alice.id,bob.id],{turn:alice.id},key);

    const settlement=[{id:alice.id,stack:1200},{id:bob.id,stack:800}];
    expect((await Promise.all([store.settle("ROOM01","parallel-hand",settlement,0),store.settle("ROOM01","parallel-hand",settlement,0)])).sort()).toEqual([false,true]);
    expect(await store.loadHand("parallel-hand",key)).toBeNull();
  });

  it("makes duplicate friend invitations idempotent across concurrent tabs",async()=>{
    const database=new PGlite();
    databases.push(database);
    const store=await open(database),alice=await store.createGuest(),bob=await store.createGuest();
    const code=await store.friendCode(bob.id);

    const [first,second]=await Promise.all([store.requestFriend(alice.id,code),store.requestFriend(alice.id,code)]);
    expect(first).toBe(second);
    expect(await store.incomingRequests(bob.id)).toHaveLength(1);
  });

  it("links a guest to Google and returns to an existing Google wallet",async()=>{
    const database=new PGlite();
    databases.push(database);
    const store=await open(database);
    const guest=await store.createGuest(), other=await store.createGuest();

    const first=await store.loginGoogle(guest.id,"google-subject","Alice Google");
    expect(first.id).toBe(guest.id);
    expect(await store.profile(guest.id)).toMatchObject({accountType:"google",googleName:"Alice Google"});
    const returnToFirst=await store.loginGoogle(other.id,"google-subject");
    expect(returnToFirst.id).toBe(guest.id);
  });

  it("does not fork an account when Google retries one identity concurrently",async()=>{
    const database=new PGlite();
    databases.push(database);
    const store=await open(database),guest=await store.createGuest();

    const [first,second]=await Promise.all([store.loginGoogle(guest.id,"same-google"),store.loginGoogle(guest.id,"same-google")]);
    expect(first.id).toBe(guest.id);
    expect(second.id).toBe(guest.id);
  });
});
