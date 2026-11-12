import {migratePostgres} from "./postgres-wallet.js";

const url=process.env.DATABASE_URL_UNPOOLED;
if(!url)throw Error("DATABASE_URL_UNPOOLED is required; use Neon's direct (non-pooler) URL");
await migratePostgres(url);
console.log("Poker PostgreSQL schema migration completed.");
