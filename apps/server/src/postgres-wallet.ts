import {createHash, randomBytes, randomUUID, createCipheriv, createDecipheriv} from "node:crypto";
import {readFile} from "node:fs/promises";
import {Pool} from "pg";

type QueryResult<Row extends Record<string, unknown>={}>={rows:Row[];rowCount?:number|null;affectedRows?:number};

/** The small common surface shared by pg.Pool clients and the local PostgreSQL test database. */
export interface PostgresConnection {
  query<Row extends Record<string, unknown>={}>(sql:string,values?:readonly unknown[]):Promise<QueryResult<Row>>;
  release?():void;
}

export interface PostgresPool extends PostgresConnection {
  connect?():Promise<PostgresConnection>;
  /** PGlite exposes exec for schema batches; node-postgres uses query instead. */
  exec?(sql:string):Promise<unknown>;
  end?():Promise<void>;
}

const hash=(token:string)=>createHash("sha256").update(token).digest("hex");
const readMoney=(value:unknown):number=>{
  const result=typeof value==="number" ? value : Number(value);
  if(!Number.isSafeInteger(result)||result<0) throw Error("Invalid persisted balance");
  return result;
};

/**
 * PostgreSQL-backed wallet increment. It is deliberately not wired to the HTTP
 * server until the full persistent-room API has been migrated from SQLite.
 */
export class PostgresWalletStore {
  private constructor(private readonly pool:PostgresPool) {}

  static async migrate(pool:PostgresPool):Promise<void> {
    const schema=await readFile(new URL("../sql/postgres/001_initial.sql",import.meta.url),"utf8");
    if(pool.exec)await pool.exec(schema);
    else await pool.query(schema);
  }

  static async open(pool:PostgresPool):Promise<PostgresWalletStore> {
    return new PostgresWalletStore(pool);
  }

  async close():Promise<void> {await this.pool.end?.();}

  async ping():Promise<void> {await this.pool.query("SELECT 1");}

  private async transaction<T>(operation:(connection:PostgresConnection)=>Promise<T>):Promise<T> {
    const connection=this.pool.connect ? await this.pool.connect() : this.pool;
    await connection.query("BEGIN");
    try {
      const result=await operation(connection);
      await connection.query("COMMIT");
      return result;
    } catch(error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release?.();
    }
  }

  async createGuest():Promise<{id:string;token:string}> {
    const id=randomUUID();
    const token=randomBytes(32).toString("base64url");
    return this.transaction(async connection=>{
      await connection.query("INSERT INTO accounts (id,balance) VALUES ($1,$2)",[id,10000]);
      await connection.query("INSERT INTO sessions (token_hash,account_id) VALUES ($1,$2)",[hash(token),id]);
      return {id,token};
    });
  }

  async authenticate(token:string):Promise<string|null> {
    if(typeof token!=="string"||token.length>128)return null;
    const result=await this.pool.query<{account_id:string}>("SELECT account_id FROM sessions WHERE token_hash=$1",[hash(token)]);
    return result.rows[0]?.account_id ?? null;
  }

  /** Call only after the OAuth provider has verified the Google subject. */
  async loginGoogle(currentId:string,subject:string,name?:string):Promise<{id:string;token:string}> {
    if(typeof subject!=="string"||!subject||subject.length>255)throw Error("Invalid Google identity");
    const token=randomBytes(32).toString("base64url");
    return this.transaction(async connection=>{
      await this.account(connection,currentId,true);
      if(await this.seatOn(connection,currentId,true))throw Error("Leave your table before switching accounts");
      let id:string|undefined;
      for(let attempt=0;attempt<3&&!id;attempt++) {
        const existing=await connection.query<{account_id:string}>("SELECT account_id FROM google_identities WHERE subject=$1",[subject]);
        if(existing.rows[0]) {id=existing.rows[0].account_id;break;}
        const linked=await connection.query("SELECT 1 FROM google_identities WHERE account_id=$1",[currentId]);
        const candidate=linked.rows.length?randomUUID():currentId;
        if(candidate!==currentId)await connection.query("INSERT INTO accounts (id,balance) VALUES ($1,$2)",[candidate,10000]);
        const claimed=await connection.query<{account_id:string}>("INSERT INTO google_identities (subject,account_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING account_id",[subject,candidate]);
        if(claimed.rows[0]) {id=claimed.rows[0].account_id;break;}
        if(candidate!==currentId)await connection.query("DELETE FROM accounts WHERE id=$1",[candidate]);
      }
      if(!id)throw Error("Could not link Google identity");
      if(typeof name==="string"&&name.trim())await connection.query("INSERT INTO google_profiles (account_id,name) VALUES ($1,$2) ON CONFLICT (account_id) DO UPDATE SET name=EXCLUDED.name",[id,name.trim().slice(0,100)]);
      await connection.query("INSERT INTO sessions (token_hash,account_id) VALUES ($1,$2)",[hash(token),id]);
      return {id,token};
    });
  }

  async balance(id:string):Promise<number> {
    const result=await this.pool.query<{balance:unknown}>("SELECT balance FROM accounts WHERE id=$1",[id]);
    const row=result.rows[0];
    if(!row)throw Error("Unknown account");
    return readMoney(row.balance);
  }

  private async account(connection:PostgresConnection,id:string,lock=false):Promise<{balance:number;lastGrant:number|null}> {
    const result=await connection.query<{balance:unknown;last_grant:unknown}>(`SELECT balance,last_grant FROM accounts WHERE id=$1${lock ? " FOR UPDATE" : ""}`,[id]);
    const row=result.rows[0];
    if(!row)throw Error("Unknown account");
    return {balance:readMoney(row.balance),lastGrant:row.last_grant===null ? null : readMoney(row.last_grant)};
  }

  private async seatOn(connection:PostgresConnection,id:string,lock=false):Promise<{room:string;stack:number}|null> {
    const result=await connection.query<{room:string;stack:unknown}>(`SELECT room,stack FROM seats WHERE account_id=$1${lock ? " FOR UPDATE" : ""}`,[id]);
    const row=result.rows[0];
    return row ? {room:row.room,stack:readMoney(row.stack)} : null;
  }

  async seat(id:string):Promise<{room:string;stack:number}|null> {return this.seatOn(this.pool,id);}

  async reserve(id:string,room:string,amount:number):Promise<void> {
    if(!room||!Number.isSafeInteger(amount)||amount<=0)throw Error("Invalid buy-in");
    await this.transaction(async connection=>{
      const [account,seat]=await Promise.all([this.account(connection,id,true),this.seatOn(connection,id,true)]);
      if(seat||account.balance<amount)throw Error("Buy-in not available");
      await connection.query("UPDATE accounts SET balance=$1 WHERE id=$2",[account.balance-amount,id]);
      await connection.query("INSERT INTO seats (account_id,room,stack) VALUES ($1,$2,$3)",[id,room,amount]);
    });
  }

  async cashOut(id:string):Promise<number> {
    return this.transaction(async connection=>{
      const active=await connection.query("SELECT 1 FROM active_hands WHERE account_id=$1",[id]);
      if(active.rows.length)throw Error("Hand in progress");
      const [account,seat]=await Promise.all([this.account(connection,id,true),this.seatOn(connection,id,true)]);
      if(!seat)throw Error("No seat");
      const total=account.balance+seat.stack;
      if(!Number.isSafeInteger(total))throw Error("Invalid balance");
      await connection.query("UPDATE accounts SET balance=$1 WHERE id=$2",[total,id]);
      await connection.query("DELETE FROM seats WHERE account_id=$1",[id]);
      return total;
    });
  }

  async displayName(id:string):Promise<string> {
    const result=await this.pool.query<{name:string}>("SELECT name FROM display_names WHERE account_id=$1",[id]);
    return result.rows[0]?.name ?? "Игрок";
  }

  async setDisplayName(id:string,name:string):Promise<void> {
    await this.account(this.pool,id);
    const clean=name.trim().slice(0,20)||"Игрок";
    await this.pool.query("INSERT INTO display_names (account_id,name) VALUES ($1,$2) ON CONFLICT (account_id) DO UPDATE SET name=EXCLUDED.name",[id,clean]);
  }

  async friendCode(id:string):Promise<string> {
    return this.transaction(async connection=>{
      await this.account(connection,id);
      for(let attempt=0;attempt<3;attempt++) {
        const code=randomBytes(16).toString("base64url");
        const inserted=await connection.query<{code:string}>("INSERT INTO friend_codes (account_id,code) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING code",[id,code]);
        if(inserted.rows[0])return inserted.rows[0].code;
        // At READ COMMITTED a concurrent insert is visible after its conflict resolves.
        const existing=await connection.query<{code:string}>("SELECT code FROM friend_codes WHERE account_id=$1",[id]);
        if(existing.rows[0])return existing.rows[0].code;
      }
      throw Error("Could not allocate friend code");
    });
  }

  async requestFriend(sender:string,code:string):Promise<string> {
    if(typeof code!=="string"||!/^[A-Za-z0-9_-]{22}$/.test(code))throw Error("Invalid friend code");
    return this.transaction(async connection=>{
      await this.account(connection,sender,true);
      const target=await connection.query<{account_id:string}>("SELECT account_id FROM friend_codes WHERE code=$1 FOR UPDATE",[code]);
      const recipient=target.rows[0]?.account_id;
      if(!recipient||recipient===sender)throw Error("Invalid friend code");
      const [left,right]=[sender,recipient].sort();
      const friendship=await connection.query("SELECT 1 FROM friendships WHERE left_id=$1 AND right_id=$2",[left!,right!]);
      if(friendship.rows.length)throw Error("Already friends");
      const reverse=await connection.query("SELECT 1 FROM friend_requests WHERE sender=$1 AND recipient=$2",[recipient,sender]);
      if(reverse.rows.length)throw Error("Respond to the pending invitation");
      const id=randomUUID();
      const inserted=await connection.query<{id:string}>("INSERT INTO friend_requests (id,sender,recipient) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id",[id,sender,recipient]);
      if(inserted.rows[0])return inserted.rows[0].id;
      const existing=await connection.query<{id:string;sender:string}>("SELECT id,sender FROM friend_requests WHERE (sender=$1 AND recipient=$2) OR (sender=$2 AND recipient=$1)",[sender,recipient]);
      if(existing.rows[0]?.sender===sender)return existing.rows[0].id;
      throw Error("Respond to the pending invitation");
    });
  }

  async incomingRequests(id:string):Promise<{id:string;senderId:string;name:string}[]> {
    await this.account(this.pool,id);
    const result=await this.pool.query<{id:string;sender:string;name:string|null}>("SELECT request.id,request.sender,COALESCE(display_names.name,'Игрок') AS name FROM friend_requests AS request LEFT JOIN display_names ON display_names.account_id=request.sender WHERE request.recipient=$1 ORDER BY request.created_order",[id]);
    return result.rows.map(row=>({id:row.id,senderId:row.sender,name:row.name??"Игрок"}));
  }

  async requestRecipient(sender:string,requestId:string):Promise<string|null> {
    const result=await this.pool.query<{recipient:string}>("SELECT recipient FROM friend_requests WHERE id=$1 AND sender=$2",[requestId,sender]);
    return result.rows[0]?.recipient??null;
  }

  async acceptFriend(id:string,requestId:string):Promise<void> {
    await this.transaction(async connection=>{
      const result=await connection.query<{sender:string;recipient:string}>("SELECT sender,recipient FROM friend_requests WHERE id=$1 FOR UPDATE",[requestId]);
      const request=result.rows[0];
      if(!request||request.recipient!==id)throw Error("Invitation not found");
      const [left,right]=[request.sender,id].sort();
      await connection.query("INSERT INTO friendships (left_id,right_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",[left!,right!]);
      await connection.query("DELETE FROM friend_requests WHERE id=$1",[requestId]);
    });
  }

  async friends(id:string):Promise<{id:string;name:string}[]> {
    await this.account(this.pool,id);
    const result=await this.pool.query<{id:string;name:string|null}>("SELECT CASE WHEN friendships.left_id=$1 THEN friendships.right_id ELSE friendships.left_id END AS id,COALESCE(display_names.name,'Игрок') AS name FROM friendships LEFT JOIN display_names ON display_names.account_id=CASE WHEN friendships.left_id=$1 THEN friendships.right_id ELSE friendships.left_id END WHERE friendships.left_id=$1 OR friendships.right_id=$1 ORDER BY id",[id]);
    return result.rows.map(row=>({id:row.id,name:row.name??"Игрок"}));
  }

  async removeFriend(id:string,friendId:string):Promise<void> {
    await this.account(this.pool,id);
    const [left,right]=[id,friendId].sort();
    await this.pool.query("DELETE FROM friendships WHERE left_id=$1 AND right_id=$2",[left!,right!]);
  }

  async profile(id:string):Promise<{id:string;balance:number;seat:{room:string;stack:number}|null;nextGrantAt:number|null;accountType:"guest"|"google";googleName:string|null}> {
    const account=await this.account(this.pool,id);
    const [seat,identity,google]=await Promise.all([
      this.seat(id),
      this.pool.query("SELECT 1 FROM google_identities WHERE account_id=$1",[id]),
      this.pool.query<{name:string}>("SELECT name FROM google_profiles WHERE account_id=$1",[id]),
    ]);
    return {id,balance:account.balance,seat,nextGrantAt:account.lastGrant===null?null:account.lastGrant+3_600_000,accountType:identity.rows.length?"google":"guest",googleName:google.rows[0]?.name??null};
  }

  async grant(id:string,now=Date.now()):Promise<number> {
    if(!Number.isSafeInteger(now)||now<0)throw Error("Invalid time");
    return this.transaction(async connection=>{
      const [account,seat,active]=await Promise.all([
        this.account(connection,id,true),
        this.seatOn(connection,id,true),
        connection.query("SELECT 1 FROM active_hands WHERE account_id=$1",[id]),
      ]);
      if(active.rows.length||!Number.isSafeInteger(account.balance+(seat?.stack??0)+5000)||(account.lastGrant!==null&&now-account.lastGrant<3_600_000))throw Error("Grant not available");
      const balance=account.balance+5000;
      await connection.query("UPDATE accounts SET balance=$1,last_grant=$2 WHERE id=$3",[balance,now,id]);
      await connection.query("INSERT INTO grants (id,account_id,amount,created_at) VALUES ($1,$2,$3,$4)",[randomUUID(),id,5000,now]);
      return balance;
    });
  }

  async activeHandIds():Promise<string[]> {
    const result=await this.pool.query<{hand_id:string}>("SELECT hand_id FROM hand_snapshots ORDER BY hand_id");
    return result.rows.map(row=>row.hand_id);
  }

  async handHistory(id:string):Promise<{handId:string;room:string;change:number;finishedAt:number}[]> {
    await this.account(this.pool,id);
    const result=await this.pool.query<{handid:string;room:string;change:unknown;finishedat:unknown}>("SELECT hand_id AS handId,room,change,finished_at AS finishedAt FROM hand_history WHERE account_id=$1 ORDER BY finished_at DESC,created_order DESC LIMIT 50",[id]);
    return result.rows.map(row=>({handId:row.handid,room:row.room,change:typeof row.change==="number"?row.change:Number(row.change),finishedAt:readMoney(row.finishedat)}));
  }

  async refundIdleSeats():Promise<void> {
    await this.transaction(async connection=>{
      const idle=await connection.query<{account_id:string;stack:unknown}>("SELECT seats.account_id,seats.stack FROM seats WHERE NOT EXISTS (SELECT 1 FROM active_hands WHERE active_hands.account_id=seats.account_id) FOR UPDATE");
      for(const row of idle.rows) {
        const account=await this.account(connection,row.account_id,true),stack=readMoney(row.stack),total=account.balance+stack;
        if(!Number.isSafeInteger(total))throw Error("Invalid balance");
        await connection.query("UPDATE accounts SET balance=$1 WHERE id=$2",[total,row.account_id]);
        await connection.query("DELETE FROM seats WHERE account_id=$1",[row.account_id]);
      }
    });
  }

  private seal(handId:string,version:number,state:unknown,key:Buffer):{nonce:Buffer;tag:Buffer;ciphertext:Buffer} {
    if(key.length!==32)throw Error("Invalid encryption key");
    const serialized=JSON.stringify(state);
    if(serialized===undefined)throw Error("Invalid snapshot");
    const nonce=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,nonce);
    cipher.setAAD(Buffer.from(`${handId}:${version}`));
    const ciphertext=Buffer.concat([cipher.update(serialized,"utf8"),cipher.final()]);
    return {nonce,tag:cipher.getAuthTag(),ciphertext};
  }

  async beginRecoverableHand(room:string,handId:string,ids:string[],state:unknown,key:Buffer):Promise<void> {
    if(!room||!handId||ids.length<2||ids.length>6||new Set(ids).size!==ids.length)throw Error("Invalid hand");
    const sealed=this.seal(handId,0,state,key);
    await this.transaction(async connection=>{
      const duplicate=await connection.query("SELECT 1 FROM settlements WHERE id=$1 UNION ALL SELECT 1 FROM active_hands WHERE room=$2 OR hand_id=$1 LIMIT 1",[handId,room]);
      if(duplicate.rows.length)throw Error("Hand already exists");
      for(const id of ids) {
        const seat=await this.seatOn(connection,id,true);
        const active=await connection.query("SELECT 1 FROM active_hands WHERE account_id=$1",[id]);
        if(!seat||seat.room!==room||seat.stack<=0||active.rows.length)throw Error("Invalid seat");
      }
      for(const id of ids)await connection.query("INSERT INTO active_hands (account_id,hand_id,room) VALUES ($1,$2,$3)",[id,handId,room]);
      await connection.query("INSERT INTO hand_snapshots (hand_id,room,version,nonce,tag,ciphertext) VALUES ($1,$2,$3,$4,$5,$6)",[handId,room,0,sealed.nonce,sealed.tag,sealed.ciphertext]);
    });
  }

  async saveHand(handId:string,expectedVersion:number,state:unknown,key:Buffer):Promise<number> {
    if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)throw Error("Invalid version");
    const version=expectedVersion+1,sealed=this.seal(handId,version,state,key);
    return this.transaction(async connection=>{
      const result=await connection.query("UPDATE hand_snapshots SET version=$1,nonce=$2,tag=$3,ciphertext=$4 WHERE hand_id=$5 AND version=$6 RETURNING version",[version,sealed.nonce,sealed.tag,sealed.ciphertext,handId,expectedVersion]);
      if(!result.rows.length)throw Error("Stale hand version");
      return version;
    });
  }

  async loadHand(handId:string,key:Buffer):Promise<{version:number;state:unknown}|null> {
    if(key.length!==32)throw Error("Invalid encryption key");
    const result=await this.pool.query<{version:unknown;nonce:Uint8Array;tag:Uint8Array;ciphertext:Uint8Array}>("SELECT version,nonce,tag,ciphertext FROM hand_snapshots WHERE hand_id=$1",[handId]);
    const row=result.rows[0];
    if(!row)return null;
    const version=readMoney(row.version),decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(row.nonce));
    decipher.setAAD(Buffer.from(`${handId}:${version}`));
    decipher.setAuthTag(Buffer.from(row.tag));
    const json=Buffer.concat([decipher.update(Buffer.from(row.ciphertext)),decipher.final()]).toString("utf8");
    return {version,state:JSON.parse(json) as unknown};
  }

  async settle(room:string,handId:string,stacks:{id:string;stack:number}[],expectedVersion?:number):Promise<boolean> {
    if(!room||!handId||stacks.length<2||new Set(stacks.map(player=>player.id)).size!==stacks.length||stacks.some(player=>!Number.isSafeInteger(player.stack)||player.stack<0))throw Error("Invalid settlement");
    const sorted=[...stacks].sort((a,b)=>a.id.localeCompare(b.id)),payload=JSON.stringify(sorted);
    return this.transaction(async connection=>{
      const claimed=await connection.query("INSERT INTO settlements (id,room,payload) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id",[handId,room,payload]);
      if(!claimed.rows.length) {
        const existing=await connection.query<{room:string;payload:string}>("SELECT room,payload FROM settlements WHERE id=$1",[handId]);
        if(existing.rows[0]?.room!==room||existing.rows[0]?.payload!==payload)throw Error("Settlement ID conflict");
        return false;
      }
      if(expectedVersion!==undefined) {
        const snapshot=await connection.query<{version:unknown}>("SELECT version FROM hand_snapshots WHERE hand_id=$1 AND room=$2 FOR UPDATE",[handId,room]);
        if(!snapshot.rows[0]||readMoney(snapshot.rows[0].version)!==expectedVersion)throw Error("Stale hand version");
      }
      const locked=await connection.query<{account_id:string}>("SELECT account_id FROM active_hands WHERE hand_id=$1 AND room=$2 FOR UPDATE",[handId,room]);
      if(locked.rows.length!==sorted.length||locked.rows.some(row=>!sorted.some(player=>player.id===row.account_id)))throw Error("Hand participants mismatch");
      let before=0,after=0;
      for(const player of sorted) {
        const seat=await this.seatOn(connection,player.id,true);
        if(!seat||seat.room!==room)throw Error("Seat mismatch");
        before+=seat.stack;after+=player.stack;
      }
      if(!Number.isSafeInteger(before)||before!==after)throw Error("Chips do not balance");
      const finishedAt=Date.now();
      for(const player of sorted) {
        const previous=await this.seatOn(connection,player.id,true);
        if(!previous)throw Error("Seat mismatch");
        await connection.query("INSERT INTO hand_history (hand_id,account_id,room,change,finished_at) VALUES ($1,$2,$3,$4,$5)",[handId,player.id,room,player.stack-previous.stack,finishedAt]);
        await connection.query("UPDATE seats SET stack=$1 WHERE account_id=$2",[player.stack,player.id]);
      }
      await connection.query("DELETE FROM active_hands WHERE hand_id=$1 AND room=$2",[handId,room]);
      await connection.query("DELETE FROM hand_snapshots WHERE hand_id=$1 AND room=$2",[handId,room]);
      return true;
    });
  }

  async transfer(sender:string,receiver:string,amount:number,id:string):Promise<boolean> {
    if(!Number.isSafeInteger(amount)||amount<=0||sender===receiver||!id)throw Error("Invalid transfer");
    return this.transaction(async connection=>{
      const verifyExisting=(transfer:{sender:string;receiver:string;amount:unknown}|undefined):boolean=>{
        if(!transfer)return false;
        if(transfer.sender!==sender||transfer.receiver!==receiver||readMoney(transfer.amount)!==amount)throw Error("Transaction ID conflict");
        return true;
      };
      const claimed=await connection.query("INSERT INTO transfers (id,sender,receiver,amount) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id",[id,sender,receiver,amount]);
      if(!claimed.rows.length) {
        const existing=await connection.query<{sender:string;receiver:string;amount:unknown}>("SELECT sender,receiver,amount FROM transfers WHERE id=$1",[id]);
        if(verifyExisting(existing.rows[0]))return false;
        throw Error("Transaction ID conflict");
      }
      // Stable order prevents two opposite transfers from deadlocking on pg.
      const accounts=await connection.query<{id:string;balance:unknown}>("SELECT id,balance FROM accounts WHERE id IN ($1,$2) ORDER BY id FOR UPDATE",[sender,receiver]);
      if(accounts.rows.length!==2)throw Error("Unknown account");
      const from=accounts.rows.find(account=>account.id===sender);
      const to=accounts.rows.find(account=>account.id===receiver);
      if(!from||!to)throw Error("Unknown account");
      const fromBalance=readMoney(from.balance), toBalance=readMoney(to.balance);
      if(fromBalance<amount||!Number.isSafeInteger(toBalance+amount))throw Error("Insufficient balance");
      await connection.query("UPDATE accounts SET balance=$1 WHERE id=$2",[fromBalance-amount,sender]);
      await connection.query("UPDATE accounts SET balance=$1 WHERE id=$2",[toBalance+amount,receiver]);
      return true;
    });
  }
}

/** Opens a bounded pg pool suitable for the normal, pooled Neon DATABASE_URL. */
export async function openPostgresWallet(connectionString:string):Promise<PostgresWalletStore> {
  if(!connectionString)throw Error("DATABASE_URL is required");
  const pool=new Pool({connectionString,max:10,idleTimeoutMillis:30_000,connectionTimeoutMillis:10_000});
  try {return await PostgresWalletStore.open(pool);} catch(error) {await pool.end();throw error;}
}

/** Applies the tracked initial schema using a direct (non-pooler) Postgres URL. */
export async function migratePostgres(connectionString:string):Promise<void> {
  if(!connectionString)throw Error("DATABASE_URL_UNPOOLED is required");
  const pool=new Pool({connectionString,max:1,connectionTimeoutMillis:10_000});
  try {await PostgresWalletStore.migrate(pool);} finally {await pool.end();}
}
