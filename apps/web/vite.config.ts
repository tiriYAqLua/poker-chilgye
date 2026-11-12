import {defineConfig} from "vite";

// Browser requests stay on one origin; Vite forwards API and WebSocket traffic.
const backend=process.env.POKER_SERVER_TARGET ?? "http://127.0.0.1:3001";
export default defineConfig({
  server:{
    ...(process.env.POKER_WEB_PORT ? {port:Number(process.env.POKER_WEB_PORT)} : {}),
    proxy:{
      "/api":{target:backend},
      "/socket.io":{target:backend,ws:true},
    },
  },
});
