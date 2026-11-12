import {createHash,randomBytes} from "node:crypto";
import type {PostgresWalletStore} from "./postgres-wallet.js";
import type {GoogleProvider} from "./google-auth.js";

type Pending={sessionHash:string;nonce:string;verifier:string;expires:number};
const random=()=>randomBytes(32).toString("base64url");
const digest=(value:string)=>createHash("sha256").update(value).digest("base64url");

/** OAuth state is intentionally process-local; it is short lived and bound to a cookie session. */
export class AsyncGoogleAuthFlow {
  private pending=new Map<string,Pending>();
  constructor(private readonly store:PostgresWalletStore,private readonly provider:GoogleProvider) {}
  async start(session:string,now=Date.now()):Promise<string> {
    const id=await this.store.authenticate(session);
    if(!id||await this.store.seat(id))throw Error("Leave your table before signing in");
    for(const [state,value] of this.pending)if(value.expires<=now)this.pending.delete(state);
    if(this.pending.size>=1000)throw Error("Too many pending sign-ins");
    const state=random(),nonce=random(),verifier=random();
    this.pending.set(state,{sessionHash:digest(session),nonce,verifier,expires:now+600_000});
    return this.provider.authorizationUrl({state,nonce,challenge:digest(verifier)});
  }
  async complete(state:string,code:string,session:string,now=Date.now()):Promise<{id:string;token:string}> {
    const pending=this.pending.get(state);this.pending.delete(state);
    const id=await this.store.authenticate(session);
    if(!pending||pending.expires<=now||!id||pending.sessionHash!==digest(session)||!code||code.length>4096)throw Error("Invalid or expired authorization");
    const identity=await this.provider.verifyCode(code,pending.verifier);
    if(!identity.sub||identity.nonce!==pending.nonce)throw Error("Invalid Google identity");
    return this.store.loginGoogle(id,identity.sub,identity.name);
  }
}
