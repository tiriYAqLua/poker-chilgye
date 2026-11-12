import {DatabaseSync} from "node:sqlite";
import {createHash, randomBytes, randomUUID, createCipheriv, createDecipheriv} from "node:crypto";

type AccountRow = {balance:number; last_grant:number | null};
const hash = (token:string) => createHash("sha256").update(token).digest("hex");

/** Local SQLite ledger. Each operation is committed atomically. */
export class WalletStore {
  private readonly db:DatabaseSync;
  constructor(path:string) {
    this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, balance INTEGER NOT NULL CHECK(balance>=0), last_grant INTEGER);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id));
      CREATE TABLE IF NOT EXISTS google_identities (subject TEXT PRIMARY KEY, account_id TEXT UNIQUE NOT NULL REFERENCES accounts(id));
      CREATE TABLE IF NOT EXISTS google_profiles (account_id TEXT PRIMARY KEY REFERENCES accounts(id), name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS display_names (account_id TEXT PRIMARY KEY REFERENCES accounts(id), name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS friend_codes (account_id TEXT PRIMARY KEY REFERENCES accounts(id), code TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS friend_requests (id TEXT PRIMARY KEY, sender TEXT NOT NULL REFERENCES accounts(id), recipient TEXT NOT NULL REFERENCES accounts(id), UNIQUE(sender,recipient), CHECK(sender<>recipient));
      CREATE TABLE IF NOT EXISTS friendships (left_id TEXT NOT NULL REFERENCES accounts(id), right_id TEXT NOT NULL REFERENCES accounts(id), PRIMARY KEY(left_id,right_id), CHECK(left_id<right_id));
      CREATE TABLE IF NOT EXISTS transfers (id TEXT PRIMARY KEY, sender TEXT NOT NULL REFERENCES accounts(id), receiver TEXT NOT NULL REFERENCES accounts(id), amount INTEGER NOT NULL CHECK(amount>0));
      CREATE TABLE IF NOT EXISTS grants (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), amount INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS seats (account_id TEXT PRIMARY KEY REFERENCES accounts(id), room TEXT NOT NULL, stack INTEGER NOT NULL CHECK(stack>=0));
      CREATE TABLE IF NOT EXISTS settlements (id TEXT PRIMARY KEY, room TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS hand_history (hand_id TEXT NOT NULL REFERENCES settlements(id), account_id TEXT NOT NULL REFERENCES accounts(id), room TEXT NOT NULL, change INTEGER NOT NULL, finished_at INTEGER NOT NULL, PRIMARY KEY(hand_id,account_id));
      CREATE INDEX IF NOT EXISTS hand_history_account ON hand_history(account_id,finished_at DESC);
      CREATE TABLE IF NOT EXISTS active_hands (account_id TEXT PRIMARY KEY REFERENCES seats(account_id), hand_id TEXT NOT NULL, room TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS hand_snapshots (hand_id TEXT PRIMARY KEY, room TEXT NOT NULL, version INTEGER NOT NULL, nonce BLOB NOT NULL, tag BLOB NOT NULL, ciphertext BLOB NOT NULL);`);
  }
  close():void {this.db.close();}
  private transaction<T>(fn:()=>T):T {
    this.db.exec("BEGIN IMMEDIATE");
    try {const result=fn();this.db.exec("COMMIT");return result;}
    catch(error){this.db.exec("ROLLBACK");throw error;}
  }
  createGuest():{id:string;token:string} {
    const id=randomUUID(), token=randomBytes(32).toString("base64url");
    return this.transaction(()=>{
      this.db.prepare("INSERT INTO accounts (id,balance) VALUES (?,10000)").run(id);
      this.db.prepare("INSERT INTO sessions (token_hash,account_id) VALUES (?,?)").run(hash(token),id);
      return {id,token};
    });
  }
  authenticate(token:string):string|null {
    if(typeof token!=="string" || token.length>128) return null;
    return (this.db.prepare("SELECT account_id FROM sessions WHERE token_hash=?").get(hash(token)) as {account_id:string}|undefined)?.account_id ?? null;
  }
  /** Call only after a Google ID token has been verified by the authentication provider. */
  loginGoogle(currentId:string,subject:string,name?:string):{id:string;token:string} {
    if(typeof subject!=="string" || !subject || subject.length>255) throw Error("Invalid Google identity");
    const token=randomBytes(32).toString("base64url");
    return this.transaction(()=>{
      this.account(currentId);
      if(this.seat(currentId))throw Error("Leave your table before switching accounts");
      const existing=this.db.prepare("SELECT account_id FROM google_identities WHERE subject=?").get(subject) as {account_id:string}|undefined;
      let id=existing?.account_id;
      if(!id) {
        const linked=this.db.prepare("SELECT 1 FROM google_identities WHERE account_id=?").get(currentId);
        id=linked ? randomUUID() : currentId;
        if(linked)this.db.prepare("INSERT INTO accounts (id,balance) VALUES (?,10000)").run(id);
        this.db.prepare("INSERT INTO google_identities (subject,account_id) VALUES (?,?)").run(subject,id);
      }
      if(typeof name==="string" && name.trim())this.db.prepare("INSERT INTO google_profiles (account_id,name) VALUES (?,?) ON CONFLICT(account_id) DO UPDATE SET name=excluded.name").run(id,name.trim().slice(0,100));
      this.db.prepare("INSERT INTO sessions (token_hash,account_id) VALUES (?,?)").run(hash(token),id);
      return {id,token};
    });
  }
  private account(id:string):AccountRow {
    const row=this.db.prepare("SELECT balance,last_grant FROM accounts WHERE id=?").get(id) as AccountRow|undefined;
    if(!row) throw Error("Unknown account");
    return row;
  }
  balance(id:string):number {return this.account(id).balance;}
  friendCode(id:string):string {
    this.account(id);
    return this.transaction(()=>{
      const existing=this.db.prepare("SELECT code FROM friend_codes WHERE account_id=?").get(id) as {code:string}|undefined;
      if(existing)return existing.code;
      const code=randomBytes(16).toString("base64url");
      this.db.prepare("INSERT INTO friend_codes VALUES (?,?)").run(id,code);
      return code;
    });
  }
  requestFriend(sender:string,code:string):string {
    if(typeof code!=="string" || !/^[A-Za-z0-9_-]{22}$/.test(code)) throw Error("Invalid friend code");
    return this.transaction(()=>{
      this.account(sender);
      const target=this.db.prepare("SELECT account_id FROM friend_codes WHERE code=?").get(code) as {account_id:string}|undefined;
      if(!target || target.account_id===sender) throw Error("Invalid friend code");
      const recipient=target.account_id, [left,right]=[sender,recipient].sort();
      if(this.db.prepare("SELECT 1 FROM friendships WHERE left_id=? AND right_id=?").get(left!,right!)) throw Error("Already friends");
      if(this.db.prepare("SELECT 1 FROM friend_requests WHERE sender=? AND recipient=?").get(recipient,sender)) throw Error("Respond to the pending invitation");
      const existing=this.db.prepare("SELECT id FROM friend_requests WHERE sender=? AND recipient=?").get(sender,recipient) as {id:string}|undefined;
      if(existing)return existing.id;
      const id=randomUUID();
      this.db.prepare("INSERT INTO friend_requests VALUES (?,?,?)").run(id,sender,recipient);
      return id;
    });
  }
  incomingRequests(id:string):{id:string;senderId:string;name:string}[] {
    this.account(id);
    const rows=this.db.prepare("SELECT id,sender FROM friend_requests WHERE recipient=? ORDER BY rowid").all(id) as {id:string;sender:string}[];
    return rows.map(row=>({id:row.id,senderId:row.sender,name:this.displayName(row.sender)}));
  }
  requestRecipient(sender:string,requestId:string):string|null {
    return (this.db.prepare("SELECT recipient FROM friend_requests WHERE id=? AND sender=?").get(requestId,sender) as {recipient:string}|undefined)?.recipient ?? null;
  }
  acceptFriend(id:string,requestId:string):void {
    this.transaction(()=>{
      const request=this.db.prepare("SELECT sender,recipient FROM friend_requests WHERE id=?").get(requestId) as {sender:string;recipient:string}|undefined;
      if(!request || request.recipient!==id) throw Error("Invitation not found");
      const [left,right]=[request.sender,id].sort();
      this.db.prepare("INSERT INTO friendships VALUES (?,?)").run(left!,right!);
      this.db.prepare("DELETE FROM friend_requests WHERE id=?").run(requestId);
    });
  }
  friends(id:string):{id:string;name:string}[] {
    this.account(id);
    const rows=this.db.prepare("SELECT left_id,right_id FROM friendships WHERE left_id=? OR right_id=?").all(id,id) as {left_id:string;right_id:string}[];
    return rows.map(row=>{const friendId=row.left_id===id ? row.right_id : row.left_id;return {id:friendId,name:this.displayName(friendId)};});
  }
  removeFriend(id:string,friendId:string):void {
    this.account(id);
    const [left,right]=[id,friendId].sort();
    this.db.prepare("DELETE FROM friendships WHERE left_id=? AND right_id=?").run(left!,right!);
  }
  displayName(id:string):string {
    return (this.db.prepare("SELECT name FROM display_names WHERE account_id=?").get(id) as {name:string}|undefined)?.name ?? "Игрок";
  }
  setDisplayName(id:string,name:string):void {
    this.account(id);
    const clean=name.trim().slice(0,20) || "Игрок";
    this.db.prepare("INSERT INTO display_names(account_id,name) VALUES (?,?) ON CONFLICT(account_id) DO UPDATE SET name=excluded.name").run(id,clean);
  }
  profile(id:string):{id:string;balance:number;seat:{room:string;stack:number}|null;nextGrantAt:number|null;accountType:"guest"|"google";googleName:string|null} {
    const account=this.account(id);
    const google=!!this.db.prepare("SELECT 1 FROM google_identities WHERE account_id=?").get(id);
    const profile=this.db.prepare("SELECT name FROM google_profiles WHERE account_id=?").get(id) as {name:string}|undefined;
    return {id,balance:account.balance,seat:this.seat(id),nextGrantAt:account.last_grant===null ? null : account.last_grant+3600000,accountType:google ? "google" : "guest",googleName:profile?.name ?? null};
  }
  seat(id:string):{room:string;stack:number}|null {
    return (this.db.prepare("SELECT room,stack FROM seats WHERE account_id=?").get(id) as {room:string;stack:number}|undefined) ?? null;
  }
  reserve(id:string,room:string,amount:number):void {
    if(!room || !Number.isSafeInteger(amount) || amount<=0) throw Error("Invalid buy-in");
    this.transaction(()=>{
      if(this.seat(id) || this.balance(id)<amount) throw Error("Buy-in not available");
      this.db.prepare("UPDATE accounts SET balance=balance-? WHERE id=?").run(amount,id);
      this.db.prepare("INSERT INTO seats VALUES (?,?,?)").run(id,room,amount);
    });
  }
  cashOut(id:string):number {
    return this.transaction(()=>{
      if(this.db.prepare("SELECT 1 FROM active_hands WHERE account_id=?").get(id)) throw Error("Hand in progress");
      const seat=this.seat(id);
      if(!seat) throw Error("No seat");
      const total=this.balance(id)+seat.stack;
      if(!Number.isSafeInteger(total)) throw Error("Invalid balance");
      this.db.prepare("UPDATE accounts SET balance=? WHERE id=?").run(total,id);
      this.db.prepare("DELETE FROM seats WHERE account_id=?").run(id);
      return total;
    });
  }
  beginHand(room:string,handId:string,ids:string[]):void {
    if(!room || !handId || ids.length<2 || ids.length>6 || new Set(ids).size!==ids.length) throw Error("Invalid hand");
    this.transaction(()=>{
      this.lockHand(room,handId,ids);
    });
  }
  private lockHand(room:string,handId:string,ids:string[]):void {
      if(!room || !handId || ids.length<2 || ids.length>6 || new Set(ids).size!==ids.length) throw Error("Invalid hand");
      if(this.db.prepare("SELECT 1 FROM settlements WHERE id=?").get(handId) ||
         this.db.prepare("SELECT 1 FROM active_hands WHERE room=? OR hand_id=?").get(room,handId)) throw Error("Hand already exists");
      for(const id of ids) {
        const seat=this.seat(id);
        if(!seat || seat.room!==room || seat.stack<=0 || this.db.prepare("SELECT 1 FROM active_hands WHERE account_id=?").get(id)) throw Error("Invalid seat");
      }
      for(const id of ids) this.db.prepare("INSERT INTO active_hands VALUES (?,?,?)").run(id,handId,room);
  }
  private seal(handId:string,version:number,state:unknown,key:Buffer):{nonce:Buffer;tag:Buffer;ciphertext:Buffer} {
    if(key.length!==32) throw Error("Invalid encryption key");
    const serialized=JSON.stringify(state);
    if(serialized===undefined) throw Error("Invalid snapshot");
    const nonce=randomBytes(12);
    const cipher=createCipheriv("aes-256-gcm",key,nonce);
    cipher.setAAD(Buffer.from(`${handId}:${version}`));
    const ciphertext=Buffer.concat([cipher.update(serialized,"utf8"),cipher.final()]);
    return {nonce,tag:cipher.getAuthTag(),ciphertext};
  }
  beginRecoverableHand(room:string,handId:string,ids:string[],state:unknown,key:Buffer):void {
    const sealed=this.seal(handId,0,state,key);
    this.transaction(()=>{
      this.lockHand(room,handId,ids);
      this.db.prepare("INSERT INTO hand_snapshots VALUES (?,?,0,?,?,?)").run(handId,room,sealed.nonce,sealed.tag,sealed.ciphertext);
    });
  }
  saveHand(handId:string,expectedVersion:number,state:unknown,key:Buffer):number {
    if(!Number.isSafeInteger(expectedVersion) || expectedVersion<0) throw Error("Invalid version");
    const next=expectedVersion+1, sealed=this.seal(handId,next,state,key);
    return this.transaction(()=>{
      const result=this.db.prepare("UPDATE hand_snapshots SET version=?,nonce=?,tag=?,ciphertext=? WHERE hand_id=? AND version=?").run(next,sealed.nonce,sealed.tag,sealed.ciphertext,handId,expectedVersion);
      if(result.changes!==1) throw Error("Stale hand version");
      return next;
    });
  }
  loadHand(handId:string,key:Buffer):{version:number;state:unknown}|null {
    if(key.length!==32) throw Error("Invalid encryption key");
    const row=this.db.prepare("SELECT version,nonce,tag,ciphertext FROM hand_snapshots WHERE hand_id=?").get(handId) as {version:number;nonce:Uint8Array;tag:Uint8Array;ciphertext:Uint8Array}|undefined;
    if(!row) return null;
    const decipher=createDecipheriv("aes-256-gcm",key,row.nonce);
    decipher.setAAD(Buffer.from(`${handId}:${row.version}`));
    decipher.setAuthTag(row.tag);
    const decoded=Buffer.concat([decipher.update(row.ciphertext),decipher.final()]).toString("utf8");
    return {version:row.version,state:JSON.parse(decoded) as unknown};
  }
  activeHandIds():string[] {
    return (this.db.prepare("SELECT hand_id FROM hand_snapshots ORDER BY hand_id").all() as {hand_id:string}[]).map(row=>row.hand_id);
  }
  handHistory(id:string):{handId:string;room:string;change:number;finishedAt:number}[] {
    this.account(id);
    return this.db.prepare("SELECT hand_id AS handId,room,change,finished_at AS finishedAt FROM hand_history WHERE account_id=? ORDER BY finished_at DESC,rowid DESC LIMIT 50").all(id) as {handId:string;room:string;change:number;finishedAt:number}[];
  }
  /** Return seats that do not belong to an unresolved hand after a restart. */
  refundIdleSeats():void {
    this.transaction(()=>{
      const idle=this.db.prepare("SELECT seats.account_id,seats.stack FROM seats LEFT JOIN active_hands ON seats.account_id=active_hands.account_id WHERE active_hands.account_id IS NULL").all() as {account_id:string;stack:number}[];
      for(const seat of idle) {
        const total=this.balance(seat.account_id)+seat.stack;
        if(!Number.isSafeInteger(total)) throw Error("Invalid balance");
        this.db.prepare("UPDATE accounts SET balance=? WHERE id=?").run(total,seat.account_id);
        this.db.prepare("DELETE FROM seats WHERE account_id=?").run(seat.account_id);
      }
    });
  }
  settle(room:string,handId:string,stacks:{id:string;stack:number}[],expectedVersion?:number):boolean {
    if(!room || !handId || stacks.length<2 || new Set(stacks.map(p=>p.id)).size!==stacks.length ||
      stacks.some(p=>!Number.isSafeInteger(p.stack)||p.stack<0)) throw Error("Invalid settlement");
    const sorted=[...stacks].sort((a,b)=>a.id.localeCompare(b.id));
    const payload=JSON.stringify(sorted);
    return this.transaction(()=>{
      const existing=this.db.prepare("SELECT room,payload FROM settlements WHERE id=?").get(handId) as {room:string;payload:string}|undefined;
      if(existing) {
        if(existing.room!==room || existing.payload!==payload) throw Error("Settlement ID conflict");
        return false;
      }
      if(expectedVersion!==undefined) {
        const snapshot=this.db.prepare("SELECT version FROM hand_snapshots WHERE hand_id=? AND room=?").get(handId,room) as {version:number}|undefined;
        if(!snapshot || snapshot.version!==expectedVersion) throw Error("Stale hand version");
      }
      const locked=this.db.prepare("SELECT account_id FROM active_hands WHERE hand_id=? AND room=?").all(handId,room) as {account_id:string}[];
      if(locked.length!==sorted.length || locked.some(row=>!sorted.some(p=>p.id===row.account_id))) throw Error("Hand participants mismatch");
      let before=0,after=0;
      for(const player of sorted) {
        const seat=this.seat(player.id);
        if(!seat || seat.room!==room) throw Error("Seat mismatch");
        before+=seat.stack;after+=player.stack;
      }
      if(!Number.isSafeInteger(before) || before!==after) throw Error("Chips do not balance");
      this.db.prepare("INSERT INTO settlements VALUES (?,?,?)").run(handId,room,payload);
      const finishedAt=Date.now();
      for(const player of sorted) {
        const previous=this.seat(player.id)!;
        this.db.prepare("INSERT INTO hand_history VALUES (?,?,?,?,?)").run(handId,player.id,room,player.stack-previous.stack,finishedAt);
        this.db.prepare("UPDATE seats SET stack=? WHERE account_id=?").run(player.stack,player.id);
      }
      this.db.prepare("DELETE FROM active_hands WHERE hand_id=? AND room=?").run(handId,room);
      this.db.prepare("DELETE FROM hand_snapshots WHERE hand_id=? AND room=?").run(handId,room);
      return true;
    });
  }
  transfer(sender:string,receiver:string,amount:number,id:string):boolean {
    if(!Number.isSafeInteger(amount) || amount<=0 || sender===receiver || !id) throw Error("Invalid transfer");
    return this.transaction(()=>{
      const existing=this.db.prepare("SELECT sender,receiver,amount FROM transfers WHERE id=?").get(id) as {sender:string;receiver:string;amount:number}|undefined;
      if(existing) {
        if(existing.sender!==sender || existing.receiver!==receiver || existing.amount!==amount) throw Error("Transaction ID conflict");
        return false;
      }
      const from=this.account(sender),to=this.account(receiver);
      if(from.balance<amount || !Number.isSafeInteger(to.balance+amount)) throw Error("Insufficient balance");
      this.db.prepare("UPDATE accounts SET balance=balance-? WHERE id=?").run(amount,sender);
      this.db.prepare("UPDATE accounts SET balance=balance+? WHERE id=?").run(amount,receiver);
      this.db.prepare("INSERT INTO transfers VALUES (?,?,?,?)").run(id,sender,receiver,amount);
      return true;
    });
  }
  grant(id:string,now=Date.now()):number {
    if(!Number.isSafeInteger(now) || now<0) throw Error("Invalid time");
    return this.transaction(()=>{
      const account=this.account(id);
      if(this.db.prepare("SELECT 1 FROM active_hands WHERE account_id=?").get(id)) throw Error("Hand in progress");
      if(!Number.isSafeInteger(account.balance+(this.seat(id)?.stack ?? 0)+5000) || (account.last_grant!==null && now-account.last_grant<3600000)) throw Error("Grant not available");
      this.db.prepare("UPDATE accounts SET balance=balance+5000,last_grant=? WHERE id=?").run(now,id);
      this.db.prepare("INSERT INTO grants VALUES (?,?,5000,?)").run(randomUUID(),id,now);
      return account.balance+5000;
    });
  }
}
