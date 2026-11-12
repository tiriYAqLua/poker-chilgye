import {readFile} from "node:fs";
import {extname,resolve,sep} from "node:path";
import type {IncomingMessage,ServerResponse} from "node:http";

type Handler=(req:IncomingMessage,res:ServerResponse)=>void;
const mime:Record<string,string>={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".ico":"image/x-icon",".woff2":"font/woff2"};
export function createWebHost(directory:string,api:Handler):Handler {
  const root=resolve(directory);
  return (req,res)=>{
    let pathname:string;
    try {pathname=decodeURIComponent(new URL(req.url ?? "/","http://local").pathname);} catch {res.writeHead(400);res.end();return;}
    if(pathname==="/health" || pathname.startsWith("/api/") || pathname.startsWith("/socket.io/")){api(req,res);return;}
    if(req.method!=="GET" && req.method!=="HEAD"){res.writeHead(405);res.end();return;}
    const filename=resolve(root,`.`+(pathname==="/" ? "/index.html" : pathname));
    if(!filename.startsWith(root+sep)){res.writeHead(404);res.end();return;}
    readFile(filename,(error,data)=>{
      if(error){res.writeHead(404);res.end();return;}
      res.writeHead(200,{"content-type":mime[extname(filename)] ?? "application/octet-stream","x-content-type-options":"nosniff","cache-control":pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache"});
      res.end(req.method==="HEAD" ? undefined : data);
    });
  };
}
