import {useEffect,useState} from "react";
import type {Socket} from "socket.io-client";

type Hand={handId:string;room:string;change:number;finishedAt:number};
export function HistoryPanel({socket,language,close}:{socket:Socket;language:"ru"|"en";close:()=>void}) {
  const [hands,setHands]=useState<Hand[]|null>(null),[error,setError]=useState(false);
  const en=language==="en";
  useEffect(()=>{
    let active=true;
    socket.timeout(5000).emit("history:list",(err:Error|null,result?:{ok:boolean;hands?:Hand[]})=>{
      if(!active)return;
      if(err || !result?.ok || !result.hands)setError(true);else setHands(result.hands);
    });
    const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")close();};
    window.addEventListener("keydown",onKey);
    return ()=>{active=false;window.removeEventListener("keydown",onKey);};
  },[socket]);
  return <div className="settings-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}><section className="settings-dialog friends-dialog" role="dialog" aria-modal="true" aria-labelledby="history-title">
    <div className="settings-heading"><h2 id="history-title">{en ? "Hand history" : "История раздач"}</h2><button autoFocus className="secondary" onClick={close} aria-label={en ? "Close" : "Закрыть"}>✕</button></div>
    <p>{en ? "Your last 50 completed hands." : "Последние 50 завершённых раздач."}</p>
    {error ? <p role="alert">{en ? "Could not load history." : "Не удалось загрузить историю."}</p> : !hands ? <p>{en ? "Loading…" : "Загрузка…"}</p> : hands.length===0 ? <p>{en ? "No completed hands yet." : "Завершённых раздач пока нет."}</p> : hands.map(hand=><div className="friend-row" key={hand.handId}><span>{new Date(hand.finishedAt).toLocaleString(en ? "en-US" : "ru-RU")}<small> · {en ? "Room" : "Комната"} {hand.room}</small></span><strong>{hand.change>0 ? "+" : ""}{hand.change.toLocaleString(en ? "en-US" : "ru-RU")} ◉</strong></div>)}
  </section></div>;
}
