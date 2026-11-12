import {createHash,randomBytes} from "node:crypto";
import {OAuth2Client,CodeChallengeMethod} from "google-auth-library";
import type {WalletStore} from "./wallet.js";

export type GoogleProvider={
  authorizationUrl:(parameters:{state:string;nonce:string;challenge:string})=>string;
  verifyCode:(code:string,verifier:string)=>Promise<{sub?:string;nonce?:string;name?:string}>;
};
const random=()=>randomBytes(32).toString("base64url");
const digest=(value:string)=>createHash("sha256").update(value).digest("base64url");

export function googleProvider(clientId:string,clientSecret:string,redirectUri:string):GoogleProvider {
  const client=new OAuth2Client(clientId,clientSecret,redirectUri);
  return {
    authorizationUrl:({state,nonce,challenge})=>client.generateAuthUrl({response_type:"code",scope:["openid","profile"],state,nonce,code_challenge:challenge,code_challenge_method:CodeChallengeMethod.S256,prompt:"select_account"}),
    verifyCode:async(code,verifier)=>{
      const {tokens}=await client.getToken({code,codeVerifier:verifier,redirect_uri:redirectUri});
      if(!tokens.id_token)throw Error("Missing ID token");
      const ticket=await client.verifyIdToken({idToken:tokens.id_token,audience:clientId});
      return ticket.getPayload() ?? {};
    },
  };
}
type Pending={sessionHash:string;nonce:string;verifier:string;expires:number};
export class GoogleAuthFlow {
  private pending=new Map<string,Pending>();
  constructor(private readonly store:WalletStore,private readonly provider:GoogleProvider) {}
  start(session:string,now=Date.now()):string {
    const id=this.store.authenticate(session);
    if(!id || this.store.seat(id))throw Error("Leave your table before signing in");
    for(const [key,value] of this.pending)if(value.expires<=now)this.pending.delete(key);
    if(this.pending.size>=1000)throw Error("Too many pending sign-ins");
    const state=random(),nonce=random(),verifier=random();
    this.pending.set(state,{sessionHash:digest(session),nonce,verifier,expires:now+600000});
    return this.provider.authorizationUrl({state,nonce,challenge:digest(verifier)});
  }
  async complete(state:string,code:string,session:string,now=Date.now()):Promise<{id:string;token:string}> {
    const pending=this.pending.get(state);this.pending.delete(state);
    const id=this.store.authenticate(session);
    if(!pending || pending.expires<=now || !id || pending.sessionHash!==digest(session) || !code || code.length>4096)throw Error("Invalid or expired authorization");
    const identity=await this.provider.verifyCode(code,pending.verifier);
    if(!identity.sub || identity.nonce!==pending.nonce)throw Error("Invalid Google identity");
    return this.store.loginGoogle(id,identity.sub,identity.name);
  }
}
