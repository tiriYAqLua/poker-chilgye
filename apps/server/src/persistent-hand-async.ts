import type {BettingAction} from "@poker/game-engine";
import {newTableHand,tableAction,tableForfeit,type TableHand} from "./table.js";
import type {PostgresWalletStore} from "./postgres-wallet.js";

type SerializedTable=Omit<TableHand,"cards">&{cards:Omit<TableHand["cards"],"holes">&{holes:[string,string[]][]}};
export type AsyncPersistentHand={room:string;id:string;version:number;table:TableHand;departures:string[]};

function encode(room:string,table:TableHand,departures:string[]):object {
  return {room,departures,table:{...table,cards:{...table.cards,holes:[...table.cards.holes.entries()]}}};
}

function decode(input:unknown):{room:string;table:TableHand;departures:string[]} {
  const value=input as {room:string;table:SerializedTable;departures?:unknown};
  if(!value||typeof value.room!=="string"||!Array.isArray(value.table?.cards?.holes))throw Error("Invalid snapshot");
  const departures=value.departures===undefined?[]:value.departures;
  if(!Array.isArray(departures)||departures.some(id=>typeof id!=="string"))throw Error("Invalid departures");
  return {room:value.room,departures,table:{...value.table,cards:{...value.table.cards,holes:new Map(value.table.cards.holes)}}};
}

export async function startAsyncPersistentHand(store:PostgresWalletStore,key:Buffer,room:string,id:string,ids:string[],button:number):Promise<AsyncPersistentHand> {
  const entries=await Promise.all(ids.map(async playerId=>{
    const seat=await store.seat(playerId);
    if(!seat||seat.room!==room)throw Error("Missing seat");
    return {id:playerId,stack:seat.stack};
  }));
  const table=newTableHand(entries,button);
  await store.beginRecoverableHand(room,id,ids,encode(room,table,[]),key);
  const hand:AsyncPersistentHand={room,id,version:0,table,departures:[]};
  if(table.result)await store.settle(room,id,table.betting.players.map(({id,stack})=>({id,stack})),0);
  return hand;
}

export async function restoreAsyncPersistentHand(store:PostgresWalletStore,key:Buffer,id:string):Promise<AsyncPersistentHand> {
  const snapshot=await store.loadHand(id,key);
  if(!snapshot)throw Error("Hand not found");
  return {id,version:snapshot.version,...decode(snapshot.state)};
}

async function commit(store:PostgresWalletStore,key:Buffer,hand:AsyncPersistentHand,table:TableHand):Promise<AsyncPersistentHand> {
  if(table.betting.street==="complete") {
    await store.settle(hand.room,hand.id,table.betting.players.map(({id,stack})=>({id,stack})),hand.version);
    return {...hand,version:hand.version+1,table};
  }
  const version=await store.saveHand(hand.id,hand.version,encode(hand.room,table,hand.departures),key);
  return {...hand,version,table};
}

export async function advanceAsyncPersistentHand(store:PostgresWalletStore,key:Buffer,hand:AsyncPersistentHand,id:string,action:BettingAction):Promise<AsyncPersistentHand> {
  const table=structuredClone(hand.table);tableAction(table,id,action);return commit(store,key,hand,table);
}

export async function forfeitAsyncPersistentHand(store:PostgresWalletStore,key:Buffer,hand:AsyncPersistentHand,id:string):Promise<AsyncPersistentHand> {
  const table=structuredClone(hand.table);tableForfeit(table,id);return commit(store,key,{...hand,departures:[...new Set([...hand.departures,id])]},table);
}
