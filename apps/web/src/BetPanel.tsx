import React from "react";

type Props={min:number;max:number;currentBet:number;value:string;disabled:boolean;language:"ru"|"en";onChange:(value:string)=>void;onClose:()=>void;onRaise:()=>void};
export function BetPanel({min,max,currentBet,value,disabled,language,onChange,onClose,onRaise}:Props) {
  const en=language==="en",amount=Number(value),available=max>currentBet,valid=available&&Number.isSafeInteger(amount)&&amount>=min&&amount<=max;
  const choose=(n:number)=>onChange(String(Math.max(min,Math.min(max,Math.round(n)))));
  return <aside className="bet-panel" role="dialog" aria-label={en?"Raise options":"Выбор ставки"}>
    <div className="bet-panel-heading"><h2>{en?"Raise":"Повысить ставку"}</h2><button onClick={onClose} aria-label={en?"Close":"Закрыть"}>✕</button></div>
    <p>{en?"Total bet this round":"Общая ставка в этом круге"}</p>
    <div className="bet-panel-body"><div className="bet-slider"><input type="range" aria-label={en?"Raise amount":"Размер ставки"} min={min} max={Math.max(min,max)} step="1" value={Math.max(min,Math.min(max,Number.isFinite(amount)?amount:min))} disabled={disabled||!available} onChange={e=>onChange(e.target.value)}/></div><div className="bet-options">
      <label>{en?"Raise to":"Повысить до"}<input type="number" min={min} max={max} step="1" value={value} onChange={e=>onChange(e.target.value)} disabled={disabled||!available}/></label>
      <p>{en?`Available: ${min}–${max}`:`Доступно: ${min}–${max}`} ◉</p>
      <div className="bet-grid">{[10,50,70,100].map(percent=><button key={percent} disabled={disabled||!available} onClick={()=>choose(max*percent/100)}>{percent===100?"MAX BET":`${percent}% MAX`}</button>)}</div>
      <p>{en?"Quick amounts (total bet)":"Быстрые суммы (общая ставка)"}</p>
      <div className="bet-grid">{Array.from({length:10},(_,i)=>(i+1)*50).map(n=><button key={n} disabled={disabled||n<min||n>max} onClick={()=>onChange(String(n))}>{n}</button>)}</div>
    </div></div><button className="bet-confirm" disabled={disabled||!valid} onClick={onRaise}>{en?"Raise":"Повысить"} {valid?`${amount} ◉`:""}</button>
  </aside>;
}
