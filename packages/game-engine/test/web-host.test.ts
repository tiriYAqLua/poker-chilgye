import {afterEach,describe,expect,it} from "vitest";
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createServer,type Server} from "node:http";
import {createWebHost} from "../../../apps/server/src/web-host.js";

describe("built web hosting",()=>{
  let server:Server|undefined,dir:string|undefined;
  afterEach(async()=>{if(server)await new Promise<void>(r=>server!.close(()=>r()));if(dir)rmSync(dir,{recursive:true,force:true});});
  it("serves built files and leaves API requests to the server",async()=>{
    dir=mkdtempSync(join(tmpdir(),"poker-web-"));
    mkdirSync(join(dir,"assets"));writeFileSync(join(dir,"index.html"),"<h1>poker</h1>");writeFileSync(join(dir,"assets","app.js"),"test");
    server=createServer(createWebHost(dir,(req,res)=>{res.writeHead(418);res.end("api");}));
    await new Promise<void>(r=>server!.listen(0,"127.0.0.1",r));
    const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    expect(await (await fetch(url)).text()).toContain("poker");
    expect((await fetch(url+"/assets/app.js")).headers.get("content-type")).toContain("javascript");
    expect((await fetch(url+"/api/session")).status).toBe(418);
    expect((await fetch(url+"/missing.js")).status).toBe(404);
    expect((await fetch(url+"/assets/%2e%2e%2fsecret")).status).toBe(404);
  });
});
