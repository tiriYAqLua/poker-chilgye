import type {BettingAction} from "@poker/game-engine";
import {newTableHand,tableAction,tableForfeit,type TableHand} from "./table.js";
import type {WalletStore} from "./wallet.js";

type SerializedTable = Omit<TableHand,"cards"> & {cards: Omit<TableHand["cards"],"holes"> & {holes:[string,string[]][]}};
export type PersistentHand = {room:string;id:string;version:number;table:TableHand;departures:string[]};
function encode(room:string,table:TableHand,departures:string[]):object {
  return {room,departures,table:{...table,cards:{...table.cards,holes:[...table.cards.holes.entries()]}}};
}
function decode(input:unknown):{room:string;table:TableHand;departures:string[]} {
  const value=input as {room:string;table:SerializedTable;departures?:unknown};
  if(!value || typeof value.room!=="string" || !Array.isArray(value.table?.cards?.holes)) throw Error("Invalid snapshot");
  const departures=value.departures===undefined ? [] : value.departures;
  if(!Array.isArray(departures) || departures.some(id=>typeof id!=="string"))throw Error("Invalid departures");
  return {room:value.room,departures,table:{...value.table,cards:{...value.table.cards,holes:new Map(value.table.cards.holes)}}};
}
export function startPersistentHand(store:WalletStore,key:Buffer,room:string,id:string,ids:string[],button:number):PersistentHand {
  const entries=ids.map(playerId=>{
    const seat=store.seat(playerId);
    if(!seat || seat.room!==room) throw Error("Missing seat");
    return {id:playerId,stack:seat.stack};
  });
  const table=newTableHand(entries,button);
  store.beginRecoverableHand(room,id,ids,encode(room,table,[]),key);
  const hand:PersistentHand={room,id,version:0,table,departures:[]};
  if(table.result) store.settle(room,id,table.betting.players.map(({id,stack})=>({id,stack})),0);
  return hand;
}
export function restorePersistentHand(store:WalletStore,key:Buffer,id:string):PersistentHand {
  const snapshot=store.loadHand(id,key);
  if(!snapshot) throw Error("Hand not found");
  return {id,version:snapshot.version,...decode(snapshot.state)};
}
function commit(store:WalletStore,key:Buffer,hand:PersistentHand,table:TableHand):PersistentHand {
  if(table.betting.street==="complete") {
    store.settle(hand.room,hand.id,table.betting.players.map(({id,stack})=>({id,stack})),hand.version);
    return {...hand,version:hand.version+1,table};
  }
  const version=store.saveHand(hand.id,hand.version,encode(hand.room,table,hand.departures),key);
  return {...hand,version,table};
}
export function advancePersistentHand(store:WalletStore,key:Buffer,hand:PersistentHand,id:string,action:BettingAction):PersistentHand {
  const table=structuredClone(hand.table);
  tableAction(table,id,action);
  return commit(store,key,hand,table);
}
export function forfeitPersistentHand(store:WalletStore,key:Buffer,hand:PersistentHand,id:string):PersistentHand {
  const table=structuredClone(hand.table);
  tableForfeit(table,id);
  return commit(store,key,{...hand,departures:[...new Set([...hand.departures,id])]},table);
}
