import {afterEach,describe,expect,it} from "vitest";
import {createServer,type Server as HttpServer} from "node:http";
import {PGlite} from "@electric-sql/pglite";
import {PostgresWalletStore} from "../../../apps/server/src/postgres-wallet.js";
import {createAsyncApi} from "../../../apps/server/src/api-async.js";

describe("PostgreSQL health endpoint",()=>{
  let database:PGlite|undefined,server:HttpServer|undefined;
  afterEach(async()=>{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await database?.close().catch(()=>{});});

  it("reports unavailable when its database connection is gone",async()=>{
    database=new PGlite();await PostgresWalletStore.migrate(database);
    const store=await PostgresWalletStore.open(database);
    server=createServer(createAsyncApi(store));
    await new Promise<void>(resolve=>server!.listen(0,"127.0.0.1",resolve));
    const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    await database.close();

    expect((await fetch(`${url}/health`)).status).toBe(503);
  });
});
