import {describe,expect,it} from "vitest";
import {GoogleAuthFlow,type GoogleProvider} from "../../../apps/server/src/google-auth.js";
import {WalletStore} from "../../../apps/server/src/wallet.js";

describe("Google authorization flow",()=>{
  it("binds a one-time authorization to the session, verifies nonce and retains the guest wallet",async()=>{
    const store=new WalletStore(":memory:");
    try {
      const guest=store.createGuest(),other=store.createGuest();
      let nonce="";
      const provider:GoogleProvider={
        authorizationUrl:({state,nonce:value})=>{nonce=value;return `https://example.test/?state=${state}`;},
        verifyCode:async()=>({sub:"google-subject",nonce}),
      };
      const auth=new GoogleAuthFlow(store,provider);
      const url=new URL(auth.start(guest.token,1000));
      const state=url.searchParams.get("state")!;
      await expect(auth.complete(state,"code",other.token,1001)).rejects.toThrow();
      const next=new URL(auth.start(guest.token,1000));
      const result=await auth.complete(next.searchParams.get("state")!,"code",guest.token,1001);
      expect(result.id).toBe(guest.id);
      expect(store.authenticate(result.token)).toBe(guest.id);
      await expect(auth.complete(next.searchParams.get("state")!,"code",guest.token,1002)).rejects.toThrow();
      const expired=new URL(auth.start(guest.token,1000));
      await expect(auth.complete(expired.searchParams.get("state")!,"code",guest.token,601001)).rejects.toThrow();
    } finally {store.close();}
  });
  it("rejects a verified token with the wrong nonce",async()=>{
    const store=new WalletStore(":memory:");
    try {
      const guest=store.createGuest();
      const auth=new GoogleAuthFlow(store,{authorizationUrl:({state})=>`https://example.test/?state=${state}`,verifyCode:async()=>({sub:"subject",nonce:"wrong"})});
      const url=new URL(auth.start(guest.token,1000));
      await expect(auth.complete(url.searchParams.get("state")!,"code",guest.token,1001)).rejects.toThrow();
    } finally {store.close();}
  });
});
