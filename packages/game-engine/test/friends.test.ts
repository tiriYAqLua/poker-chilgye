import {afterEach,describe,expect,it} from "vitest";
import {WalletStore} from "../../../apps/server/src/wallet.js";

describe("friend requests",()=>{
  let store:WalletStore;
  afterEach(()=>store?.close());
  it("requires the recipient to accept and supports removing a friend",()=>{
    store=new WalletStore(":memory:");
    const a=store.createGuest(),b=store.createGuest(),c=store.createGuest();
    const code=store.friendCode(b.id);
    expect(store.friendCode(b.id)).toBe(code);
    const request=store.requestFriend(a.id,code);
    expect(store.friends(a.id)).toEqual([]);
    expect(store.incomingRequests(b.id).map(x=>x.id)).toContain(request);
    expect(()=>store.acceptFriend(c.id,request)).toThrow();
    store.acceptFriend(b.id,request);
    expect(store.friends(a.id).map(x=>x.id)).toContain(b.id);
    expect(store.friends(b.id).map(x=>x.id)).toContain(a.id);
    expect(()=>store.requestFriend(a.id,code)).toThrow();
    store.removeFriend(a.id,b.id);
    expect(store.friends(a.id)).toEqual([]);
    expect(store.friends(b.id)).toEqual([]);
  });
  it("rejects invalid, duplicate and self-directed invitations",()=>{
    store=new WalletStore(":memory:");
    const a=store.createGuest(),b=store.createGuest();
    expect(()=>store.requestFriend(a.id,store.friendCode(a.id))).toThrow();
    expect(()=>store.requestFriend(a.id,"BAD")).toThrow();
    const request=store.requestFriend(a.id,store.friendCode(b.id));
    expect(store.requestFriend(a.id,store.friendCode(b.id))).toBe(request);
    expect(()=>store.requestFriend(b.id,store.friendCode(a.id))).toThrow();
  });
});
