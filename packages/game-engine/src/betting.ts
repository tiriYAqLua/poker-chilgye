export type Street = "preflop" | "flop" | "turn" | "river" | "showdown" | "complete";
export type BettingAction = {type:"fold" | "check" | "call"} | {type:"raise"; to:number};
export type Bettor = {id:string; stack:number; streetBet:number; contribution:number; folded:boolean; pending:boolean; actedAt:number | null};
export type BettingHand = {players:Bettor[]; button:number; bigBlind:number; street:Street; currentBet:number; minRaise:number; turn:string | null; pot:number};
export type PotParticipant = {id:string; contribution:number; folded:boolean};

function nextIndex(hand: BettingHand, from: number, predicate: (p: Bettor) => boolean): number {
  for (let n=1;n<=hand.players.length;n++) {
    const index=(from+n)%hand.players.length;
    if (predicate(hand.players[index]!)) return index;
  }
  return -1;
}
const canAct = (p:Bettor) => !p.folded && p.stack > 0;
function post(hand: BettingHand, index:number, amount:number): void {
  const p=hand.players[index]!;
  const paid=Math.min(p.stack,amount);
  p.stack-=paid; p.streetBet+=paid; p.contribution+=paid; hand.pot+=paid;
}

/** Initializes one no-limit hand; amounts are whole chips. */
export function startBetting(entries: {id:string;stack:number}[], button:number, smallBlind:number, bigBlind:number): BettingHand {
  if (entries.length<2 || entries.length>6 || new Set(entries.map(p=>p.id)).size!==entries.length ||
      !Number.isInteger(button) || button<0 || button>=entries.length ||
      !Number.isSafeInteger(smallBlind) || !Number.isSafeInteger(bigBlind) || smallBlind<=0 || bigBlind<smallBlind ||
      entries.some(p=>!p.id || !Number.isSafeInteger(p.stack) || p.stack<=0)) throw Error("Invalid table");
  const players=entries.map(p=>({...p, streetBet:0, contribution:0, folded:false, pending:true, actedAt:null}));
  const hand: BettingHand={players,button,bigBlind,street:"preflop",currentBet:bigBlind,minRaise:bigBlind,turn:null,pot:0};
  const small=entries.length===2 ? button : (button+1)%entries.length;
  const big=(small+1)%entries.length;
  post(hand,small,smallBlind); post(hand,big,bigBlind);
  for (const p of players) if (!canAct(p)) p.pending=false;
  const first=nextIndex(hand,big,p=>p.pending);
  if(first>=0) hand.turn=players[first]!.id;
  closeIfReady(hand,big);
  return hand;
}

function closeIfReady(hand:BettingHand, previous:number):void {
  const live=hand.players.filter(p=>!p.folded);
  if(live.length===1) {
    live[0]!.stack+=hand.pot; hand.pot=0; hand.street="complete"; hand.turn=null; return;
  }
  const pending=nextIndex(hand,previous,p=>canAct(p)&&p.pending);
  if(pending>=0) {hand.turn=hand.players[pending]!.id; return;}
  const next: Record<Exclude<Street,"showdown"|"complete">, Street>={preflop:"flop",flop:"turn",turn:"river",river:"showdown"};
  if(hand.street==="showdown" || hand.street==="complete") return;
  hand.street=next[hand.street];
  for(const p of hand.players) {p.streetBet=0;p.actedAt=null;p.pending=canAct(p);}
  hand.currentBet=0; hand.minRaise=hand.bigBlind;
  const able=hand.players.filter(canAct);
  if(hand.street==="showdown" || able.length<2) {hand.street="showdown";hand.turn=null;return;}
  hand.turn=hand.players[nextIndex(hand,hand.button,p=>p.pending)]!.id;
}

/** Mutates state only after validating the complete action. Raise amount is total street bet. */
export function act(hand:BettingHand,id:string,action:BettingAction):void {
  const index=hand.players.findIndex(p=>p.id===id), p=hand.players[index];
  if(!p || hand.turn!==id || !canAct(p) || !p.pending) throw Error("Not your turn");
  const call=Math.max(0,hand.currentBet-p.streetBet);
  if(action.type==="check" && call>0) throw Error("Cannot check");
  if(action.type==="raise") {
    const max=p.streetBet+p.stack;
    if(!hand.players.some(other=>other.id!==id && canAct(other)) ||
       !Number.isSafeInteger(action.to) || action.to<=hand.currentBet || action.to>max ||
       (action.to-hand.currentBet<hand.minRaise && action.to!==max) ||
       (p.actedAt!==null && p.actedAt!==0 && hand.currentBet-p.actedAt<hand.minRaise)) throw Error("Invalid raise");
  } else if(action.type!=="fold" && action.type!=="check" && action.type!=="call") throw Error("Invalid action");
  if(action.type==="fold") p.folded=true;
  else if(action.type==="call") post(hand,index,call);
  else if(action.type==="raise") {
    const increase=action.to-hand.currentBet;
    post(hand,index,action.to-p.streetBet);
    hand.currentBet=action.to;
    if(increase>=hand.minRaise) hand.minRaise=increase;
    for(const other of hand.players) if(other.id!==id && canAct(other) && other.streetBet<hand.currentBet) other.pending=true;
  }
  p.pending=false; p.actedAt=hand.currentBet;
  closeIfReady(hand,index);
}

/** A departure folds a player but never removes their contribution. */
export function forfeit(hand:BettingHand, id:string):void {
  const index=hand.players.findIndex(p=>p.id===id);
  const player=hand.players[index];
  if(!player || player.folded || player.stack===0 || hand.street==="complete" || hand.street==="showdown") return;
  const wasTurn=hand.turn===id;
  player.folded=true;
  player.pending=false;
  if(wasTurn || hand.players.filter(p=>!p.folded).length===1) closeIfReady(hand,index);
}

/** Rankings list best first; each inner list contains equally ranked player IDs. */
export function awardPots(players:PotParticipant[], rankings:string[][], button:number):Record<string,number> {
  if(players.length<2 || !Number.isInteger(button) || button<0 || button>=players.length ||
    new Set(players.map(p=>p.id)).size!==players.length ||
    players.some(p=>!Number.isSafeInteger(p.contribution)||p.contribution<0)) throw Error("Invalid contributions");
  const ids=players.map(p=>p.id), ranked=rankings.flat();
  const eligible=players.filter(p=>!p.folded).map(p=>p.id);
  if(new Set(ranked).size!==ranked.length || ranked.length!==eligible.length || ranked.some(id=>!eligible.includes(id))) throw Error("Invalid rankings");
  const result:Record<string,number>=Object.fromEntries(ids.map(id=>[id,0]));
  const levels=[...new Set(players.map(p=>p.contribution).filter(n=>n>0))].sort((a,b)=>a-b);
  let previous=0;
  for(const level of levels) {
    const contributors=players.filter(p=>p.contribution>=level);
    const amount=(level-previous)*contributors.length; previous=level;
    if(contributors.length===1) {result[contributors[0]!.id]!+=amount;continue;}
    const contenders=contributors.filter(p=>!p.folded).map(p=>p.id);
    const group=rankings.find(tie=>tie.some(id=>contenders.includes(id)));
    if(!group) throw Error("No eligible player for pot");
    const winners=group.filter(id=>contenders.includes(id));
    const share=Math.floor(amount/winners.length), remainder=amount%winners.length;
    for(const id of winners) result[id]!+=share;
    const clockwise=Array.from({length:players.length},(_,i)=>players[(button+1+i)%players.length]!.id).filter(id=>winners.includes(id));
    for(let i=0;i<remainder;i++) result[clockwise[i]!]!++;
  }
  return result;
}
