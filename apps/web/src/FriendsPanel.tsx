import {useEffect,useState} from "react";
import type {Socket} from "socket.io-client";

type Friend={id:string;name:string;online:boolean};
type Request={id:string;senderId:string;name:string};
type FriendsState={code:string;friends:Friend[];requests:Request[]};
type Reply={ok:boolean;error?:string}&Partial<FriendsState>;
export function FriendsPanel({socket,language,close,roomCode}:{socket:Socket;language:"ru"|"en";close:()=>void;roomCode:string}) {
  const en=language==="en";
  const [state,setState]=useState<FriendsState|null>(null),[code,setCode]=useState(""),[message,setMessage]=useState("");
  const refresh=()=>{
    socket.timeout(5000).emit("friends:list",(err:Error|null,result?:Reply)=>{
      if(err || !result?.ok || !result.code || !result.friends || !result.requests){setMessage(en ? "Could not load friends." : "Не удалось загрузить список друзей.");return;}
      setState({code:result.code,friends:result.friends,requests:result.requests});
    });
  };
  useEffect(()=>{
    socket.on("friends:state",setState);
    refresh();
    const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")close();};
    window.addEventListener("keydown",onKey);
    return ()=>{socket.off("friends:state",setState);window.removeEventListener("keydown",onKey);};
  },[socket]);
  const request=()=>{
    setMessage("");
    socket.timeout(5000).emit("friends:request",code.trim(),(err:Error|null,result?:Reply)=>{
      if(err || !result?.ok){setMessage(en ? "Could not send request. Check the code or an existing request." : "Не удалось отправить заявку. Проверьте код и существующие заявки.");return;}
      setMessage(en ? "Request sent." : "Заявка отправлена.");setCode("");
    });
  };
  const act=(event:"friends:accept"|"friends:remove",id:string)=>{
    setMessage("");
    socket.timeout(5000).emit(event,id,(err:Error|null,result?:Reply)=>{
      if(err || !result?.ok){setMessage(en ? "Action failed. Please try again." : "Не удалось выполнить действие. Попробуйте ещё раз.");return;}
      refresh();
    });
  };
  const invite=(id:string)=>{
    setMessage("");
    socket.timeout(5000).emit("friends:invite",id,(err:Error|null,result?:Reply)=>{
      setMessage(err || !result?.ok ? (en ? "Could not invite this friend. They may already be at a table." : "Не удалось пригласить друга. Возможно, он уже за столом.") : (en ? "Invitation sent." : "Приглашение отправлено."));
    });
  };
  return <div className="settings-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}>
    <section className="settings-dialog friends-dialog" role="dialog" aria-modal="true" aria-labelledby="friends-title">
      <div className="settings-heading"><h2 id="friends-title">{en ? "Friends" : "Друзья"}</h2><button autoFocus className="secondary" onClick={close} aria-label={en ? "Close" : "Закрыть"}>✕</button></div>
      <p>{en ? "Share your friend code to receive an invitation." : "Передайте другу этот код, чтобы получить заявку."}</p>
      <code className="friend-code">{state?.code ?? "…"}</code>
      <label>{en ? "Friend’s code" : "Код друга"}<input maxLength={22} autoComplete="off" value={code} onChange={e=>setCode(e.target.value)}/></label>
      <button className="secondary" disabled={!socket.connected || code.trim().length!==22} onClick={request}>{en ? "Send request" : "Отправить заявку"}</button>
      {message && <p role="status">{message}</p>}
      <h3>{en ? "Incoming requests" : "Входящие заявки"}</h3>
      {!state?.requests.length && <p>{en ? "No pending requests." : "Новых заявок нет."}</p>}
      {state?.requests.map(item=><div className="friend-row" key={item.id}><span>{item.name}</span><button className="secondary" onClick={()=>act("friends:accept",item.id)}>{en ? "Accept" : "Принять"}</button></div>)}
      <h3>{en ? "Friends" : "Список друзей"}</h3>
      {!state?.friends.length && <p>{en ? "No friends yet." : "Друзей пока нет."}</p>}
      {state?.friends.map(friend=><div className="friend-row" key={friend.id}><span>{friend.name} <small>{friend.online ? (en ? "online" : "в сети") : (en ? "offline" : "не в сети")}</small></span>{roomCode && <button className="secondary" disabled={!friend.online} onClick={()=>invite(friend.id)}>{en ? "Invite" : "Пригласить"}</button>}<button className="secondary" onClick={()=>act("friends:remove",friend.id)}>{en ? "Remove" : "Удалить"}</button></div>)}
    </section>
  </div>;
}
