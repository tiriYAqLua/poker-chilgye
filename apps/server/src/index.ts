import {createServer} from "node:http";
import {mkdirSync} from "node:fs";
import {resolve} from "node:path";
import {WalletStore} from "./wallet.js";
import {openPostgresWallet,type PostgresWalletStore} from "./postgres-wallet.js";
import {createApi} from "./api.js";
import {createAsyncApi} from "./api-async.js";
import {loadOrCreateKey,parseConfiguredKey} from "./key.js";
import {attachRealtime} from "./realtime.js";
import {attachAsyncRealtime} from "./realtime-async.js";
import {GoogleAuthFlow,googleProvider} from "./google-auth.js";
import {AsyncGoogleAuthFlow} from "./google-auth-async.js";
import {createWebHost} from "./web-host.js";

const port=Number(process.env.PORT ?? 3001);
const host=process.env.POKER_HOST ?? "127.0.0.1";
const origin=process.env.POKER_ORIGIN ?? "http://127.0.0.1:5173";
if(process.env.POKER_REQUIRE_POSTGRES==="true"&&!process.env.DATABASE_URL?.trim())throw Error("DATABASE_URL is required for this deployment");
const parsedOrigin=new URL(origin);
if(!["http:","https:"].includes(parsedOrigin.protocol) || parsedOrigin.origin!==origin)throw Error("POKER_ORIGIN must be an exact http(s) origin without a trailing slash");
const dataDirectory=resolve(process.env.POKER_DATA_DIR ?? "./data");
const http=createServer();
let wallet:WalletStore|undefined;
let postgresWallet:PostgresWalletStore|undefined;
let realtime:{close:()=>void}|undefined;
http.listen(port,host,()=>{
  void (async()=>{try {
    mkdirSync(dataDirectory,{recursive:true});
    const clientId=process.env.GOOGLE_CLIENT_ID,clientSecret=process.env.GOOGLE_CLIENT_SECRET;
    if(Boolean(clientId)!==Boolean(clientSecret))throw Error("Both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required");
    if(process.env.DATABASE_URL) {
      if(!process.env.POKER_SNAPSHOT_KEY)throw Error("POKER_SNAPSHOT_KEY is required when DATABASE_URL is configured");
      postgresWallet=await openPostgresWallet(process.env.DATABASE_URL);
      const key=parseConfiguredKey(process.env.POKER_SNAPSHOT_KEY);
      const google=clientId && clientSecret ? new AsyncGoogleAuthFlow(postgresWallet,googleProvider(clientId,clientSecret,`${origin}/api/auth/google/callback`)) : undefined;
      const api=createAsyncApi(postgresWallet,origin,google);
      http.on("request",process.env.POKER_WEB_DIR ? createWebHost(process.env.POKER_WEB_DIR,api) : api);
      realtime=await attachAsyncRealtime(http,postgresWallet,key,origin);
    } else {
      wallet=new WalletStore(resolve(dataDirectory,"poker.sqlite"));
      const key=process.env.POKER_SNAPSHOT_KEY ? parseConfiguredKey(process.env.POKER_SNAPSHOT_KEY) : loadOrCreateKey(resolve(dataDirectory,"snapshot.key"),wallet.activeHandIds().length===0);
      const google=clientId && clientSecret ? new GoogleAuthFlow(wallet,googleProvider(clientId,clientSecret,`${origin}/api/auth/google/callback`)) : undefined;
      const api=createApi(wallet,origin,google);
      http.on("request",process.env.POKER_WEB_DIR ? createWebHost(process.env.POKER_WEB_DIR,api) : api);
      realtime=attachRealtime(http,wallet,key,origin);
    }
    console.log(`Poker server listening on ${host}:${port}; allowed origin: ${origin}`);
  } catch(error) {console.error("Не удалось восстановить сервер",error);wallet?.close();await postgresWallet?.close();http.close();process.exitCode=1;}})();
});
for(const signal of ["SIGINT","SIGTERM"] as const) process.on(signal,()=>{
  realtime?.close();wallet?.close();void postgresWallet?.close();http.close();process.exit(0);
});
