import {randomBytes} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";

export function parseConfiguredKey(value:string):Buffer {
  if(!/^[A-Za-z0-9+/]{43}=$/.test(value))throw Error("POKER_SNAPSHOT_KEY must be a base64-encoded 32-byte secret");
  const key=Buffer.from(value,"base64");
  if(key.length!==32 || key.toString("base64")!==value)throw Error("Invalid POKER_SNAPSHOT_KEY");
  return key;
}

/** Local development only: keep this file private and include it in backups. */
export function loadOrCreateKey(path:string,allowCreate=true):Buffer {
  if(allowCreate) {
    try {writeFileSync(path,randomBytes(32),{flag:"wx",mode:0o600});}
    catch(error) {if((error as NodeJS.ErrnoException).code!=="EEXIST") throw error;}
  }
  let key:Buffer;
  try {key=readFileSync(path);}
  catch(error) {if(!allowCreate && (error as NodeJS.ErrnoException).code==="ENOENT")throw Error("Не найден ключ snapshot.key для незавершённой раздачи. Восстановите его из резервной копии.");throw error;}
  if(key.length!==32) throw Error("Invalid snapshot key");
  return key;
}
