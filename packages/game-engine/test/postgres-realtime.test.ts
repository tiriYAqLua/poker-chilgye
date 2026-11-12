import {afterEach,describe,expect,it} from "vitest";
import {createServer,type Server as HttpServer} from "node:http";
import {io as connect,type Socket} from "socket.io-client";
import {PGlite} from "@electric-sql/pglite";
import {PostgresWalletStore} from "../../../apps/server/src/postgres-wallet.js";
import {createAsyncApi} from "../../../apps/server/src/api-async.js";
import {attachAsyncRealtime} from "../../../apps/server/src/realtime-async.js";

describe("PostgreSQL realtime",()=>{
  let database:PGlite|undefined,server:HttpServer|undefined,clients:Socket[]=[];
  afterEach(async()=>{for(const client of clients)client.disconnect();clients=[];if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await database?.close();});
  it("acknowledges a persisted room command only after its PostgreSQL transaction",async()=>{
    database=new PGlite();await PostgresWalletStore.migrate(database);const store=await PostgresWalletStore.open(database);
    const alice=await store.createGuest(),bob=await store.createGuest();
    server=createServer(createAsyncApi(store));const realtime=await attachAsyncRealtime(server,store,Buffer.alloc(32,4));
    await new Promise<void>(resolve=>server!.listen(0,"127.0.0.1",resolve));
    const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    const join=async(token:string)=>{const socket=connect(url,{forceNew:true,transports:["websocket"],extraHeaders:{origin:"http://127.0.0.1:5173",cookie:`poker_session=${token}`}});clients.push(socket);await new Promise<void>((resolve,reject)=>{socket.once("connect",resolve);socket.once("connect_error",reject);});return socket;};
    const first=await join(alice.token),second=await join(bob.token);
    const created=await first.timeout(2_000).emitWithAck("room:create","Alice");
    expect(created.ok).toBe(true);
    expect((await second.timeout(2_000).emitWithAck("room:join",created.room,"Bob")).ok).toBe(true);
    expect(await store.seat(alice.id)).toMatchObject({room:created.room,stack:10000});
    const started=await first.timeout(2_000).emitWithAck("room:advance",created.room);
    expect(started.ok).toBe(true);
    expect((await first.timeout(2_000).emitWithAck("room:action",created.room,started.handId,started.version,{type:"fold"})).ok).toBe(true);
    expect((await store.handHistory(alice.id))[0]).toMatchObject({handId:started.handId,change:-50});
    realtime.close();
  });
});
