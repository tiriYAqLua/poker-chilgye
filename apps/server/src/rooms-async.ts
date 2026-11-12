import {randomInt,randomUUID} from "node:crypto";
import type {BettingAction} from "@poker/game-engine";
import {startAsyncPersistentHand,advanceAsyncPersistentHand,forfeitAsyncPersistentHand,restoreAsyncPersistentHand,type AsyncPersistentHand} from "./persistent-hand-async.js";
import type {PostgresWalletStore} from "./postgres-wallet.js";

export type AsyncRoomPlayer={id:string;name:string;leaving:boolean};
export type AsyncRoom={code:string;players:AsyncRoomPlayer[];button:number;hand?:AsyncPersistentHand};

/**
 * Room commands are queued per room. PostgreSQL protects data across processes;
 * this queue additionally gives one Socket.IO process deterministic broadcasts.
 */
export class AsyncRoomManager {
  private readonly rooms=new Map<string,AsyncRoom>();
  private readonly queues=new Map<string,Promise<void>>();
  private constructor(private readonly wallet:PostgresWalletStore,private readonly key:Buffer) {}

  static async restore(wallet:PostgresWalletStore,key:Buffer):Promise<AsyncRoomManager> {
    const manager=new AsyncRoomManager(wallet,key);
    for(const id of await wallet.activeHandIds()) {
      const hand=await restoreAsyncPersistentHand(wallet,key,id);
      if(manager.rooms.has(hand.room))throw Error("Multiple active hands for a room");
      const players=await Promise.all(hand.table.betting.players.map(async player=>({id:player.id,name:await wallet.displayName(player.id),leaving:hand.departures.includes(player.id)})));
      manager.rooms.set(hand.room,{code:hand.room,players,button:hand.table.betting.button,hand});
    }
    await wallet.refundIdleSeats();
    return manager;
  }

  private async exclusive<T>(code:string,operation:()=>Promise<T>):Promise<T> {
    const prior=this.queues.get(code)??Promise.resolve();
    let release!:()=>void;
    const current=new Promise<void>(resolve=>{release=resolve;});
    const tail=prior.then(()=>current);
    this.queues.set(code,tail);
    await prior;
    try{return await operation();}finally {release();if(this.queues.get(code)===tail)this.queues.delete(code);}
  }

  get(code:string):AsyncRoom|undefined{return this.rooms.get(code);}
  private newCode():string {
    const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";let value:string;
    do value=Array.from({length:6},()=>alphabet[randomInt(alphabet.length)]).join("");while(this.rooms.has(value));
    return value;
  }
  async create(id:string,name:string):Promise<AsyncRoom> {
    const code=this.newCode();
    return this.exclusive(code,async()=>{
      const balance=await this.wallet.balance(id),buyin=Math.min(balance,10000);
      if(buyin<=0)throw Error("Недостаточно фишек");
      await this.wallet.reserve(id,code,buyin);await this.wallet.setDisplayName(id,name);
      const room={code,players:[{id,name,leaving:false}],button:-1};this.rooms.set(code,room);return room;
    });
  }
  async join(code:string,id:string,name:string):Promise<AsyncRoom> {
    return this.exclusive(code,async()=>{
      const room=this.rooms.get(code);if(!room)throw Error("Комната не найдена");
      const existing=room.players.find(player=>player.id===id);
      if(existing){if(existing.leaving)throw Error("Вы выходите из комнаты после завершения раздачи");await this.wallet.setDisplayName(id,name);existing.name=name;return room;}
      if(!id.startsWith("bot:")&&room.players.some(player=>player.id.startsWith("bot:")))throw Error("Это стол для игры с ботами");
      if(room.players.length>=6)throw Error("Комната заполнена");
      const balance=await this.wallet.balance(id),buyin=Math.min(balance,10000);
      if(buyin<=0)throw Error("Недостаточно фишек");
      await this.wallet.reserve(id,code,buyin);await this.wallet.setDisplayName(id,name);room.players.push({id,name,leaving:false});return room;
    });
  }
  async addBots(room:AsyncRoom):Promise<void> {
    const bots=await this.wallet.createBotSeats(room.code);
    room.players.push(...bots.map(bot=>({...bot,leaving:false})));
  }
  async start(code:string,id:string):Promise<AsyncPersistentHand> {
    return this.exclusive(code,async()=>{
      const room=this.rooms.get(code);if(!room||!room.players.some(player=>player.id===id&&!player.leaving))throw Error("Нет доступа");
      if(room.hand&&!room.hand.table.result)throw Error("Раздача уже идёт");
      const ready=(await Promise.all(room.players.filter(player=>!player.leaving).map(async player=>({player,seat:await this.wallet.seat(player.id)})))).filter(item=>(item.seat?.stack??0)>0).map(item=>item.player);
      if(ready.length<2)throw Error("Нужно два игрока с фишками");
      let button=0;
      if(room.hand){const previous=room.hand.table.betting.players.map(player=>player.id),order=[...previous,...ready.map(player=>player.id).filter(playerId=>!previous.includes(playerId))],oldButton=room.hand.table.betting.button;for(let offset=1;offset<=order.length;offset++){const candidate=order[(oldButton+offset)%order.length],index=ready.findIndex(player=>player.id===candidate);if(index>=0){button=index;break;}}}
      const hand=await startAsyncPersistentHand(this.wallet,this.key,code,randomUUID(),ready.map(player=>player.id),button);room.hand=hand;room.button=button;return hand;
    });
  }
  async action(code:string,id:string,handId:string,version:number,action:BettingAction):Promise<AsyncPersistentHand> {
    return this.exclusive(code,async()=>{
      const room=this.rooms.get(code);if(!room||!room.players.some(player=>player.id===id&&(!player.leaving||player.id.startsWith("bot:")))||!room.hand||room.hand.id!==handId||room.hand.version!==version)throw Error("Состояние раздачи изменилось");
      room.hand=await advanceAsyncPersistentHand(this.wallet,this.key,room.hand,id,action);await this.flushDepartures(room);return room.hand;
    });
  }
  async leave(code:string,id:string):Promise<void> {
    await this.exclusive(code,async()=>{
      const room=this.rooms.get(code),player=room?.players.find(item=>item.id===id);if(!room||!player)return;
      if(!id.startsWith("bot:")&&room.players.some(item=>item.id.startsWith("bot:"))) {
        for(const bot of room.players.filter(item=>item.id.startsWith("bot:")))bot.leaving=true;
        if(!room.hand||room.hand.table.result){await this.wallet.cashOut(id);room.players=room.players.filter(item=>item.id!==id);await this.flushDepartures(room);return;}
      }
      if(room.hand&&!room.hand.table.result&&room.hand.table.betting.players.some(item=>item.id===id)){room.hand=await forfeitAsyncPersistentHand(this.wallet,this.key,room.hand,id);player.leaving=true;await this.flushDepartures(room);return;}
      await this.wallet.cashOut(id);room.players=room.players.filter(item=>item.id!==id);if(!room.players.length)this.rooms.delete(code);
    });
  }
  private async flushDepartures(room:AsyncRoom):Promise<void> {
    if(room.hand&&!room.hand.table.result)return;
    for(const player of room.players.filter(player=>player.leaving))await this.wallet.cashOut(player.id);
    room.players=room.players.filter(player=>!player.leaving);if(!room.players.length)this.rooms.delete(room.code);
  }
}
