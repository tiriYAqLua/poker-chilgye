import type {IncomingMessage, ServerResponse} from "node:http";
import type {WalletStore} from "./wallet.js";
import type {GoogleAuthFlow} from "./google-auth.js";
const localOrigin="http://127.0.0.1:5173";
function readToken(cookie:string|undefined,name:string):string|null {
  const prefix=`${name}=`;
  const pair=cookie?.split(";").map(part=>part.trim()).find(part=>part.startsWith(prefix));
  const value=pair?.slice(prefix.length);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
export function sessionToken(cookie:string|undefined):string|null {return readToken(cookie,"poker_session");}
export function createApi(store:WalletStore,allowedOrigin=localOrigin,google?:GoogleAuthFlow) {
  return (req:IncomingMessage,res:ServerResponse):void => {
    const send=(status:number,body:object) => {res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(body));};
    const origin=req.headers.origin;
    const path=new URL(req.url ?? "/","http://local");
    const makeCookie=(name:string,value:string)=>`${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${allowedOrigin.startsWith("https://") ? "; Secure" : ""}`;
    if(origin===allowedOrigin) {res.setHeader("Access-Control-Allow-Origin",origin);res.setHeader("Access-Control-Allow-Credentials","true");res.setHeader("Vary","Origin");}
    if(req.url==="/health" && req.method==="GET") {send(200,{ok:true,service:"poker-server"});return;}
    if(path.pathname==="/api/auth/google/start" && req.method==="POST") {
      if(origin!==allowedOrigin){send(403,{error:"INVALID_ORIGIN"});return;}
      const token=sessionToken(req.headers.cookie);
      if(!google || !token){send(503,{error:"GOOGLE_UNAVAILABLE"});return;}
      try {res.writeHead(302,{location:google.start(token),"cache-control":"no-store"});res.end();}
      catch {res.writeHead(302,{location:"/?auth=error","cache-control":"no-store"});res.end();}
      return;
    }
    if(path.pathname==="/api/auth/google/callback" && req.method==="GET") {
      const token=sessionToken(req.headers.cookie),state=path.searchParams.get("state"),code=path.searchParams.get("code");
      const redirect=(location:string)=>{res.writeHead(302,{location,"cache-control":"no-store","referrer-policy":"no-referrer"});res.end();};
      if(!google || !token || !state || !code){redirect("/?auth=error");return;}
      const originalId=store.authenticate(token),wasGuest=originalId ? store.profile(originalId).accountType==="guest" : false;
      void google.complete(state,code,token).then(result=>{
        const cookies=[makeCookie("poker_session",result.token)];
        if(wasGuest && result.id!==originalId)cookies.push(makeCookie("poker_guest_backup",token));
        res.setHeader("Set-Cookie",cookies);
        redirect("/?auth=success");
      }).catch(()=>redirect("/?auth=error"));
      return;
    }
    if(path.pathname==="/api/auth/guest" && req.method==="POST") {
      if(origin!==allowedOrigin){send(403,{error:"INVALID_ORIGIN"});return;}
      const token=sessionToken(req.headers.cookie),id=token ? store.authenticate(token) : null;
      if(!id){send(401,{error:"UNAUTHENTICATED"});return;}
      if(store.seat(id)){res.writeHead(302,{location:"/?auth=error"});res.end();return;}
      if(store.profile(id).accountType==="guest"){res.writeHead(302,{location:"/?auth=guest"});res.end();return;}
      const backup=readToken(req.headers.cookie,"poker_guest_backup"),backupId=backup ? store.authenticate(backup) : null;
      const guest=backup && backupId && store.profile(backupId).accountType==="guest" ? {token:backup} : store.createGuest();
      res.setHeader("Set-Cookie",makeCookie("poker_session",guest.token));
      res.writeHead(302,{location:"/?auth=guest","cache-control":"no-store"});res.end();return;
    }
    if(path.pathname==="/api/auth/google/status" && req.method==="GET") {send(200,{enabled:!!google});return;}
    if(req.url!=="/api/session" && req.url!=="/api/grant") {send(404,{error:"NOT_FOUND"});return;}
    if(req.method==="POST" && origin!==allowedOrigin) {send(403,{error:"INVALID_ORIGIN"});return;}
    const token=sessionToken(req.headers.cookie);
    let id=token ? store.authenticate(token) : null;
    if(req.url==="/api/session" && req.method==="POST" && !id) {
      const guest=store.createGuest();id=guest.id;
      res.setHeader("Set-Cookie",makeCookie("poker_session",guest.token));
    }
    if(!id) {send(401,{error:"UNAUTHENTICATED"});return;}
    if(req.url==="/api/session" && (req.method==="GET" || req.method==="POST")) {
      send(200,store.profile(id));return;
    }
    if(req.url==="/api/grant" && req.method==="POST") {
      try {store.grant(id);send(200,store.profile(id));} catch {send(409,{error:"GRANT_UNAVAILABLE"});}return;
    }
    send(405,{error:"METHOD_NOT_ALLOWED"});
  };
}
