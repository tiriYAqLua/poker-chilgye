import {randomInt,randomUUID} from "node:crypto";
import type {BettingAction} from "@poker/game-engine";
import {startPersistentHand,advancePersistentHand,forfeitPersistentHand,restorePersistentHand,type PersistentHand} from "./persistent-hand.js";
import type {WalletStore} from "./wallet.js";

export type RoomPlayer={id:string;name:string;leaving:boolean};
export type Room={code:string;players:RoomPlayer[];button:number;hand?:PersistentHand};

export class RoomManager {
  private readonly rooms=new Map<string,Room>();
  constructor(private readonly wallet:WalletStore,private readonly key:Buffer) {
    for(const id of wallet.activeHandIds()) {
      const hand=restorePersistentHand(wallet,key,id);
      if(this.rooms.has(hand.room)) throw Error("Multiple active hands for a room");
      const players=hand.table.betting.players.map(p=>({id:p.id,name:wallet.displayName(p.id),leaving:hand.departures.includes(p.id)}));
      this.rooms.set(hand.room,{code:hand.room,players,button:hand.table.betting.button,hand});
    }
    // A seat without an active snapshot is not locked by a hand.
    wallet.refundIdleSeats();
  }
  get(code:string):Room|undefined {return this.rooms.get(code);}
  private newCode():string {
    const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let value:string;
    do {value=Array.from({length:6},()=>alphabet[randomInt(alphabet.length)]).join("");} while(this.rooms.has(value));
    return value;
  }
  create(id:string,name:string):string {
    const code=this.newCode();
    this.addSeat(code,id);
    this.wallet.setDisplayName(id,name);
    this.rooms.set(code,{code,players:[{id,name,leaving:false}],button:-1});
    return code;
  }
  private addSeat(code:string,id:string):void {
    const balance=this.wallet.balance(id), buyin=Math.min(balance,10000);
    if(buyin<=0) throw Error("Недостаточно фишек");
    this.wallet.reserve(id,code,buyin);
  }
  join(code:string,id:string,name:string):Room {
    const room=this.rooms.get(code);
    if(!room) throw Error("Комната не найдена");
    const existing=room.players.find(p=>p.id===id);
    if(existing) {if(existing.leaving)throw Error("Вы выходите из комнаты после завершения раздачи");this.wallet.setDisplayName(id,name);existing.name=name;return room;}
    if(room.players.length>=6) throw Error("Комната заполнена");
    this.addSeat(code,id);
    this.wallet.setDisplayName(id,name);
    room.players.push({id,name,leaving:false});
    return room;
  }
  start(code:string,id:string):PersistentHand {
    const room=this.rooms.get(code);
    if(!room || !room.players.some(p=>p.id===id && !p.leaving)) throw Error("Нет доступа");
    if(room.hand && !room.hand.table.result) throw Error("Раздача уже идёт");
    const ready=room.players.filter(p=>!p.leaving && (this.wallet.seat(p.id)?.stack ?? 0)>0);
    if(ready.length<2) throw Error("Нужно два игрока с фишками");
    let button=0;
    if(room.hand) {
      const previous=room.hand.table.betting.players.map(player=>player.id);
      const order=[...previous,...ready.map(player=>player.id).filter(playerId=>!previous.includes(playerId))];
      const oldButton=room.hand.table.betting.button;
      for(let offset=1;offset<=order.length;offset++) {
        const candidate=order[(oldButton+offset)%order.length];
        const index=ready.findIndex(player=>player.id===candidate);
        if(index>=0){button=index;break;}
      }
    }
    const hand=startPersistentHand(this.wallet,this.key,code,randomUUID(),ready.map(p=>p.id),button);
    room.hand=hand;room.button=button;
    return hand;
  }
  action(code:string,id:string,handId:string,version:number,action:BettingAction):PersistentHand {
    const room=this.rooms.get(code);
    if(!room || !room.players.some(p=>p.id===id && !p.leaving) || !room.hand || room.hand.id!==handId || room.hand.version!==version) throw Error("Состояние раздачи изменилось");
    room.hand=advancePersistentHand(this.wallet,this.key,room.hand,id,action);
    this.flushDepartures(room);
    return room.hand;
  }
  leave(code:string,id:string):void {
    const room=this.rooms.get(code), player=room?.players.find(p=>p.id===id);
    if(!room || !player) return;
    if(room.hand && !room.hand.table.result && room.hand.table.betting.players.some(p=>p.id===id)) {
      room.hand=forfeitPersistentHand(this.wallet,this.key,room.hand,id);
      player.leaving=true;
      this.flushDepartures(room);
      return;
    }
    this.wallet.cashOut(id);
    room.players=room.players.filter(p=>p.id!==id);
    if(room.players.length===0) this.rooms.delete(code);
  }
  private flushDepartures(room:Room):void {
    if(room.hand && !room.hand.table.result) return;
    for(const player of room.players.filter(p=>p.leaving)) this.wallet.cashOut(player.id);
    room.players=room.players.filter(p=>!p.leaving);
    if(room.players.length===0) this.rooms.delete(room.code);
  }
}
