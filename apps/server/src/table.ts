import {act, awardPots, compareHandValues, evaluateSeven, forfeit, startBetting, type BettingAction, type BettingHand} from "@poker/game-engine";
import {createHand, parseCard, type Hand} from "./deal.js";

type Result = {winners:string[]; players:{id:string;hole:string[];category:number}[]; payouts:Record<string,number>};
export type TableHand = {betting:BettingHand; cards:Hand; exposed:number; result?:Result};

export function newTableHand(entries:{id:string;stack:number}[],button:number):TableHand {
  const betting=startBetting(entries,button,50,100);
  const table:TableHand={betting,cards:createHand(entries.map(player=>player.id)),exposed:0};
  settleIfFinished(table);
  return table;
}

function settleIfFinished(table:TableHand):void {
  const betting=table.betting;
  if(table.result) return;
  if(betting.street==="complete") {
    const winner=betting.players.find(player=>!player.folded);
    if(winner) table.result={winners:[winner.id],players:[],payouts:{}};
    return;
  }
  if(betting.street!=="showdown") return;
  table.exposed=5;
  const ranked=betting.players.filter(player=>!player.folded).map(player=>({
    id:player.id, hole:table.cards.holes.get(player.id)!,
    value:evaluateSeven([...table.cards.holes.get(player.id)!,...table.cards.board].map(parseCard))
  })).sort((a,b)=>compareHandValues(b.value,a.value));
  const groups:string[][]=[];
  for(let i=0;i<ranked.length;i++) {
    if(i===0 || compareHandValues(ranked[i]!.value,ranked[i-1]!.value)!==0) groups.push([]);
    groups[groups.length-1]!.push(ranked[i]!.id);
  }
  const payouts=awardPots(betting.players,groups,betting.button);
  for(const player of betting.players) player.stack+=payouts[player.id] ?? 0;
  betting.pot=0; betting.street="complete"; betting.turn=null;
  table.result={winners:groups[0]!,players:ranked.map(p=>({id:p.id,hole:[...p.hole],category:p.value.category})),payouts};
}

export function tableAction(table:TableHand,id:string,action:BettingAction):void {
  act(table.betting,id,action);
  const count:Record<string,number>={flop:3,turn:4,river:5,showdown:5};
  table.exposed=Math.max(table.exposed,count[table.betting.street] ?? 0);
  settleIfFinished(table);
}
export function tableForfeit(table:TableHand,id:string):void {
  forfeit(table.betting,id);
  settleIfFinished(table);
}
export function tableView(table:TableHand,id:string) {
  const player=table.betting.players.find(p=>p.id===id);
  if(!player) throw Error("Not in hand");
  const street=table.betting.street;
  return {board:table.cards.board.slice(0,table.exposed),hole:[...(table.cards.holes.get(id) ?? [])],
    betting:{players:table.betting.players.map(({id,stack,streetBet,folded})=>({id,stack,streetBet,folded})),
      street,turn:table.betting.turn,pot:table.betting.pot,currentBet:table.betting.currentBet,minRaise:table.betting.minRaise,button:table.betting.button},
    ...(table.result ? {result:table.result} : {})};
}
