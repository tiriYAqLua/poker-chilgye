import React, {useEffect, useState} from "react";
import {createRoot} from "react-dom/client";
import {io, type Socket} from "socket.io-client";
import {labels,parsePreferences,type Preferences} from "./preferences.js";
import {FriendsPanel} from "./FriendsPanel.js";
import {HistoryPanel} from "./HistoryPanel.js";
import {positionLabels} from "./positions.js";
import "./style.css";

// Fixed illustrative deal: no production deck generation happens in the browser.
const board = ["Q♠","7♥","2♣","9♦","A♣"];
const displayCard = (value: string) => value.replace(/[CDHS]$/, suit => ({C:"♣",D:"♦",H:"♥",S:"♠"}[suit] ?? suit));
type HandView = {board: string[]; hole: string[]; betting:{players:{id:string;stack:number;streetBet:number;folded:boolean}[]; street:string; turn:string|null; pot:number; currentBet:number;minRaise:number;button:number}; result?: {winners: string[]; players: {id: string; hole: string[]; category: number}[]; payouts:Record<string,number>}};
type Profile = {id:string;balance:number;seat:{room:string;stack:number}|null;nextGrantAt:number|null;accountType:"guest"|"google";googleName:string|null};
let sessionRequest:Promise<Profile>|null=null;
function ensureSession():Promise<Profile> {
  if(!sessionRequest) sessionRequest=fetch("/api/session",{method:"POST",credentials:"include"})
    .then(response=>{if(!response.ok)throw Error("Сессия недоступна");return response.json() as Promise<Profile>;})
    .finally(()=>{sessionRequest=null;});
  return sessionRequest;
}
function Card({value}: {value?: string}) {
  return <span className={"card " + (!value ? "back" : /[♥♦]/.test(value) ? "red" : "")}>{value ?? "♠"}</span>;
}
function App() {
  const [preferences,setPreferences]=useState<Preferences>(()=>{try{return parsePreferences(localStorage.getItem("poker_preferences"));}catch{return parsePreferences(null);}});
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [friendsOpen,setFriendsOpen]=useState(false);
  const [historyOpen,setHistoryOpen]=useState(false);
  const [helpOpen,setHelpOpen]=useState(false);
  const [googleEnabled,setGoogleEnabled]=useState(false);
  const [authError,setAuthError]=useState(false);
  const [invitation,setInvitation]=useState<{fromId:string;fromName:string;room:string}|null>(null);
  const t=labels[preferences.language];
  const [table, setTable] = useState(false);
  const [botMode,setBotMode] = useState(false);
  const [stage, setStage] = useState(0);
  const [name, setName] = useState("Игрок");
  const [draft, setDraft] = useState(()=>localStorage.getItem("poker_name") || "Игрок");
  const [connected, setConnected] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [players, setPlayers] = useState<{id: string; name: string;online:boolean;stack:number;leaving:boolean}[]>([]);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const [hand, setHand] = useState<HandView | null>(null);
  const [version, setVersion] = useState(0);
  const [handId, setHandId] = useState("");
  const [raiseTo, setRaiseTo] = useState("200");
  const [actionError, setActionError] = useState("");
  const [profile, setProfile] = useState<Profile|null>(null);
  const [walletError, setWalletError] = useState("");
  const [deadline, setDeadline] = useState<number|null>(null);
  const [clock, setClock] = useState(Date.now());
  const [socket] = useState<Socket>(() => io({autoConnect: false, withCredentials:true,transports:["websocket"]}));
  const visible = [0,3,4,5,5][stage] ?? 0;
  useEffect(()=>{try{localStorage.setItem("poker_preferences",JSON.stringify(preferences));}catch{/* storage may be unavailable */}document.documentElement.lang=preferences.language;document.title=preferences.language==="ru" ? "Свои • Покер" : "Svoi • Poker";},[preferences]);
  useEffect(()=>{if(!settingsOpen)return;const handle=(event:KeyboardEvent)=>{if(event.key==="Escape")setSettingsOpen(false);};window.addEventListener("keydown",handle);return()=>window.removeEventListener("keydown",handle);},[settingsOpen]);
  const playSound=()=>{
    if(!preferences.sound || preferences.volume===0)return;
    try {
      const audio=new AudioContext(), oscillator=audio.createOscillator(), gain=audio.createGain();
      oscillator.type="sine";oscillator.frequency.value=660;
      gain.gain.setValueAtTime(preferences.volume/1000,audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001,audio.currentTime+0.12);
      oscillator.connect(gain);gain.connect(audio.destination);oscillator.start();oscillator.stop(audio.currentTime+0.12);
      oscillator.onended=()=>{void audio.close();};
    } catch {/* sound is optional */ }
  };
  useEffect(() => {
    let cancelled=false;
    fetch("/api/auth/google/status").then(response=>response.ok ? response.json() as Promise<{enabled:boolean}> : {enabled:false}).then(result=>{if(!cancelled)setGoogleEnabled(result.enabled);}).catch(()=>{});
    const auth=new URL(window.location.href).searchParams.get("auth");
    if(auth){if(auth==="error")setAuthError(true);window.history.replaceState(null,"",window.location.pathname);}
    socket.on("connect", () => {
      setConnected(true); setError("");setWalletError("");
      socket.timeout(5000).emit("room:resume",localStorage.getItem("poker_name") || "Игрок",(err:Error|null,result?:{ok:boolean;room?:string;profile?:Profile})=>{
        if(!err && result?.ok && result.room){setRoomCode(result.room);setTable(true);setName(localStorage.getItem("poker_name") || "Игрок");if(result.profile)setProfile(result.profile);}
        else if(!err && result && !result.ok){setRoomCode("");setPlayers([]);setHand(null);setTable(false);}
      });
    });
    socket.on("connect_error",()=>{setConnected(false);setWalletError("Не удалось подключиться к серверу.");});
    socket.on("disconnect", () => {setConnected(false); setError("Соединение потеряно. Переподключаемся…");});
    socket.on("wallet:profile",(value:Profile)=>setProfile(value));
    socket.on("friend:invite",(value:{fromId:string;fromName:string;room:string})=>{setFriendsOpen(false);setInvitation(value);});
    socket.on("room:state", (state: {version:number; handId?:string; code: string; profile:Profile; deadline:number|null; players: {id: string; name: string;online:boolean;stack:number;leaving:boolean}[]; hand?: HandView}) => {
      setVersion(state.version); setRoomCode(state.code); setPlayers(state.players);
      setHandId(state.handId ?? "");setProfile(state.profile);setDeadline(state.deadline);setClock(Date.now());
      setHand(state.hand ?? null);
    });
    ensureSession().then(data=>{if(!cancelled){setProfile(data);socket.connect();}}).catch(()=>{if(!cancelled)setWalletError("Не удалось загрузить кошелёк. Проверьте сервер и обновите страницу.");});
    return () => {cancelled=true; socket.removeAllListeners(); socket.disconnect(); };
  }, [socket]);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return ()=>clearInterval(timer);},[]);
  const claimGrant = () => {
    setWalletError("");
    fetch("/api/grant",{method:"POST",credentials:"include"})
      .then(response=>{if(!response.ok) throw Error("Пополнение недоступно.");return response.json() as Promise<Profile>;})
      .then(setProfile).catch(()=>setWalletError(t.grantError));
  };
  const saveName=()=>{
    const value=draft.trim() || "Игрок";
    localStorage.setItem("poker_name",value);setName(value);
    if(socket.connected)socket.emit("profile:name",value,()=>{});
  };
  const openTable = () => {
    playSound();
    setError("");
    localStorage.setItem("poker_name",draft.trim() || "Игрок");
    if(!socket.connected) {setName(draft.trim() || "Игрок");setStage(0);setTable(true);return;}
    socket.timeout(5000).emit("room:create",draft.trim() || "Игрок",(err:Error|null,result?:{ok:boolean;room?:string;profile?:Profile;error?:string})=>{
      if(err || !result?.ok || !result.room){setError(result?.error ?? "Не удалось создать комнату.");return;}
      setName(draft.trim() || "Игрок");setStage(0);setRoomCode(result.room);if(result.profile)setProfile(result.profile);setTable(true);
    });
  };
  const openBots = () => {
    playSound();setBotMode(true);setTable(true);setStage(0);setRoomCode("");setHand(null);setError("");
    setPlayers([{id:"bot-1",name:"Алекс",online:true,stack:10000,leaving:false},{id:"bot-2",name:"Мила",online:true,stack:10000,leaving:false},{id:"bot-3",name:"Дэн",online:true,stack:10000,leaving:false},{id:"bot-4",name:"София",online:true,stack:10000,leaving:false},{id:"bot-5",name:"Макс",online:true,stack:10000,leaving:false}]);
  };
  const sendAction = (type:"fold"|"check"|"call"|"raise") => {
    playSound();
    setActionError("");
    socket.timeout(5000).emit("room:action", roomCode, handId, version, type==="raise" ? {type,to:Number(raiseTo)} : {type},
      (err:Error|null, result?:{ok:boolean;error?:string}) => {
        if(err || !result?.ok) {setActionError(result?.error ?? "Сервер не ответил.");socket.emit("room:sync");}
      });
  };
  const me=hand?.betting.players.find(player=>player.id===profile?.id);
  const myTurn=!!hand && hand.betting.turn===profile?.id;
  const readyPlayers=players.filter(player=>!player.leaving && player.stack>0).length;
  const callAmount=hand && me ? Math.max(0,hand.betting.currentBet-me.streetBet) : 0;
  const leave = () => {
    if(!socket.connected || !roomCode){setRoomCode("");setPlayers([]);setHand(null);setTable(false);return;}
    socket.timeout(5000).emit("room:leave",(err:Error|null,result?:{ok:boolean;profile?:Profile;pending?:boolean;error?:string})=>{
      if(err || !result?.ok){setActionError(result?.error ?? "Не удалось выйти. Попробуйте снова.");return;}
      if(result.profile)setProfile(result.profile);
      setRoomCode("");setPlayers([]);setHand(null);setTable(false);
      setError(result.pending ? "Вы выйдете после завершения раздачи; оставшиеся фишки вернутся в кошелёк." : "");
    });
  };
  const join = (code:string) => {
    playSound();
    setError("");
    localStorage.setItem("poker_name",draft.trim() || "Игрок");
    if (!socket.connected) { setError("Сервер не подключён."); return; }
    socket.timeout(5000).emit("room:join", code.trim().toUpperCase(), draft.trim() || "Игрок",
      (err: Error | null, result?: {ok: boolean; room?: string; profile?:Profile; error?: string}) => {
        if (err || !result) { setError("Сервер не ответил. Попробуйте ещё раз."); return; }
        if (!result.ok) { setError(result.error ?? "Не удалось войти в комнату."); return; }
        setName(draft.trim() || "Игрок"); setRoomCode(result.room ?? ""); if(result.profile)setProfile(result.profile);setInvitation(null);setTable(true);
      });
  };
  return <div className="app">
    <header><a href="#" onClick={e=>{e.preventDefault();leave();}}>♠ <b>СВОИ</b><span>POKER CLUB</span></a><div className="badge">{connected ? t.online : t.offline}</div><button className="settings-toggle" disabled={!connected} onClick={()=>setHistoryOpen(true)}>{preferences.language==="ru" ? "История" : "History"}</button><button className="settings-toggle" disabled={!connected} onClick={()=>setFriendsOpen(true)}>{preferences.language==="ru" ? "Друзья" : "Friends"}</button><button className="settings-toggle" onClick={()=>setSettingsOpen(true)} aria-label={t.settings}>⚙ <span>{t.settings}</span></button><div className="avatar">{name.slice(0,1).toUpperCase()}</div></header>
    {table && <button className="secondary" onClick={()=>setHelpOpen(true)}>{preferences.language==="ru" ? "? Подсказки по картам" : "? Hand guide"}</button>}
    {helpOpen && <div className="settings-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setHelpOpen(false);}}><section className="settings-dialog friends-dialog" role="dialog" aria-modal="true" aria-label="Poker hands"><div className="settings-heading"><h2>{preferences.language==="ru" ? "Комбинации в покере" : "Poker hands"}</h2><button className="secondary" onClick={()=>setHelpOpen(false)}>✕</button></div><p>{preferences.language==="ru" ? "От сильнейшей к слабейшей. Используются лучшие пять карт из двух ваших и пяти общих." : "Strongest to weakest. Use the best five cards from your two cards and the five community cards."}</p><div className="hand-guide-cards">{[["A♠","K♠","Q♠","J♠","10♠"],["9♥","8♥","7♥","6♥","5♥"],["A♠","A♥","A♦","A♣","K♠"],["K♠","K♥","K♦","7♣","7♥"],["A♦","J♦","8♦","5♦","2♦"],["9♠","8♥","7♣","6♦","5♠"],["Q♠","Q♥","Q♦","9♣","2♠"],["J♠","J♥","4♦","4♣","A♠"],["10♠","10♥","K♦","7♣","3♠"],["A♠","J♥","8♦","5♣","2♠"]].map((cards,i)=><div className="hand-guide-example" key={i}><strong>{i===0 ? (preferences.language==="ru" ? "Роял-флеш" : "Royal flush") : labels[preferences.language].categories[9-i]}</strong><div>{cards.map((card,j)=><Card key={j} value={card}/>)}</div></div>)}</div><ol>{(preferences.language==="ru" ? ["Роял-флеш — 10, J, Q, K, A одной масти.","Стрит-флеш — пять карт подряд одной масти.","Каре — четыре карты одного достоинства.","Фулл-хаус — тройка и пара.","Флеш — пять карт одной масти.","Стрит — пять карт подряд; туз может быть младшим в A-2-3-4-5.","Сет — три карты одного достоинства.","Две пары — две разные пары.","Пара — две карты одного достоинства.","Старшая карта — если комбинаций нет."] : ["Royal flush — 10, J, Q, K, A of one suit.","Straight flush — five consecutive cards of one suit.","Four of a kind — four cards of one rank.","Full house — three of a kind and a pair.","Flush — five cards of one suit.","Straight — five consecutive ranks; A-2-3-4-5 is valid.","Three of a kind — three cards of one rank.","Two pair — two different pairs.","One pair — two cards of one rank.","High card — when no other hand is made."]).map(item=><li key={item}>{item}</li>)}</ol><p>{preferences.language==="ru" ? "Пас — сбросить карты; чек — пропустить ход без ставки; колл — уравнять ставку; рейз — повысить ставку." : "Fold discards your hand; check passes without betting; call matches the bet; raise increases it."}</p></section></div>}
    {historyOpen && <HistoryPanel socket={socket} language={preferences.language} close={()=>setHistoryOpen(false)}/>}
    {friendsOpen && <FriendsPanel socket={socket} language={preferences.language} roomCode={roomCode} close={()=>setFriendsOpen(false)}/>}
    {invitation && <div className="settings-backdrop"><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="invite-title"><h2 id="invite-title">{preferences.language==="ru" ? "Приглашение в комнату" : "Room invitation"}</h2><p>{invitation.fromName} {preferences.language==="ru" ? "приглашает вас за стол." : "invites you to play."}</p>{profile?.seat && <p>{preferences.language==="ru" ? "Сначала выйдите из текущей комнаты." : "Leave your current room first."}</p>}{error && <p role="alert">{error}</p>}<button className="primary" disabled={!connected || !!profile?.seat} onClick={()=>join(invitation.room)}>{preferences.language==="ru" ? "Присоединиться" : "Join"}</button> <button className="secondary" onClick={()=>{setInvitation(null);setError("");}}>{preferences.language==="ru" ? "Отклонить" : "Decline"}</button></section></div>}
    {settingsOpen && <div className="settings-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSettingsOpen(false);}}><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className="settings-heading"><h2 id="settings-title">{t.settings}</h2><button className="secondary" autoFocus onClick={()=>setSettingsOpen(false)} aria-label={t.close}>✕</button></div><label>{t.language}<select value={preferences.language} onChange={e=>setPreferences({...preferences,language:e.target.value==="en" ? "en" : "ru"})}><option value="ru">Русский</option><option value="en">English</option></select></label><label className="sound-choice"><input type="checkbox" checked={preferences.sound} onChange={e=>setPreferences({...preferences,sound:e.target.checked})}/>{t.sound}</label><label>{t.volume} · {preferences.volume}%<input type="range" min="0" max="100" step="5" disabled={!preferences.sound} value={preferences.volume} onChange={e=>setPreferences({...preferences,volume:Number(e.target.value)})}/></label><button className="secondary" disabled={!preferences.sound || preferences.volume===0} onClick={playSound}>{t.testSound}</button><p>{t.saved}</p></section></div>}
    {!table ? <main className="lobby">
      <section className="hero"><p className="eyebrow">{t.tagline}</p><h1>{t.hero1}<br/><em>{t.hero2}</em></h1><p className="description">{t.intro}<br/>{connected ? t.connected : t.disconnected}</p><button className="primary" onClick={openTable}>{connected ? t.create : t.demo} <span>↗</span></button><button className="secondary" onClick={openBots}>{preferences.language==="ru" ? "Играть с ботами" : "Play with bots"}</button>{googleEnabled && <form method="post" action="/api/auth/google/start"><button className="secondary" disabled={!connected || !!profile?.seat} type="submit">{preferences.language==="ru" ? "Войти или сменить аккаунт Google" : "Sign in or switch Google account"}</button></form>}{profile?.accountType==="google" && <form method="post" action="/api/auth/guest"><button className="secondary" disabled={!connected || !!profile?.seat} type="submit">{preferences.language==="ru" ? "Вернуться в гостевой профиль" : "Switch to guest profile"}</button></form>}{authError && <p role="alert">{preferences.language==="ru" ? "Не удалось войти через Google. Попробуйте ещё раз." : "Google sign-in failed. Please try again."}</p>}<div className="pills"><span>Texas Hold’em</span><span>{t.upTo}</span><span>{t.chips}</span></div></section>
      <section className="wallet"><div className="eyebrow">{profile?.accountType==="google" ? `GOOGLE${profile.googleName ? ` · ${profile.googleName}` : ""}` : t.guest}</div><label>{t.name}<input maxLength={20} value={draft} onChange={e=>setDraft(e.target.value)} onBlur={saveName}/></label><label>{t.code}<input maxLength={6} placeholder={t.codeExample} value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase())}/></label><button className="secondary" disabled={!connected || !joinCode.trim()} onClick={()=>join(joinCode)}>{t.join}</button>{error && <p role="alert">{error}</p>}<div className="balance">{profile ? profile.balance.toLocaleString(preferences.language==="ru" ? "ru-RU" : "en-US") : "—"} <small>◉</small></div><p>{t.wallet}{profile?.seat ? ` · ${t.reserved}: ${profile.seat.stack.toLocaleString(preferences.language==="ru" ? "ru-RU" : "en-US")}` : ""}</p><div className="note">{profile?.accountType==="google" ? (preferences.language==="ru" ? "Кошелёк привязан к Google-аккаунту." : "Your wallet is linked to your Google account.") : t.cookie}</div><div className="wallet-bottom"><span>{t.topup}</span><strong>{t.perHour}</strong></div><button className="secondary" disabled={!profile || (profile.nextGrantAt!==null && profile.nextGrantAt>clock)} onClick={claimGrant}>{t.claim}</button>{walletError && <p role="alert">{walletError}</p>}<small>{t.grantInfo}</small></section>
      <section className="info"><div><span>{t.invite}</span><h3>{t.roomCode}</h3><p>{t.inviteInfo}</p></div><div><span>{t.play}</span><h3>Texas Hold’em</h3><p>{t.gameInfo}</p></div><div><span>{t.return}</span><h3>{t.keepChips}</h3><p>{t.walletInfo}</p></div></section>
    </main> : <main className="game">
      <div className="table-heading"><button className="secondary" onClick={()=>{setBotMode(false);leave();}}>{t.menu}</button><div><h2>{t.table}</h2><span>{roomCode ? `${t.room}: ${roomCode} · ${players.length}/6 ${t.players}` : t.localDemo}</span></div><span className="badge">{connected && roomCode ? t.realtime : t.demoOnly}</span></div>
      {roomCode && <p className="room-players">{t.participants}: {players.map(player => player.name).join(", ")}</p>}
      {hand && <p className="room-players">{t.positions}</p>}
      {hand?.result && <div className="showdown" role="status"><strong>{hand.result.winners.length > 1 ? t.tie : hand.result.players.length ? t.bestHand : t.winner}: {hand.result.winners.map(id => players.find(player => player.id === id)?.name ?? t.player).join(", ")}</strong>{hand.result.players.map(result => <div key={result.id}>{players.find(player => player.id === result.id)?.name ?? t.player}: {result.hole.map(displayCard).join(" ")} — {t.categories[result.category]}</div>)}{Object.entries(hand.result.payouts).filter(([,amount])=>amount>0).map(([id,amount])=><div key={`payout-${id}`}>{players.find(player=>player.id===id)?.name ?? t.player}: {t.payout} {amount.toLocaleString(preferences.language==="ru" ? "ru-RU" : "en-US")} ◉</div>)}</div>}
      <div className="felt">
        {roomCode ? Array.from({length: 5}, (_, i) => {
          const others = players.filter(player => player.id !== profile?.id);
          const player = others[i];
          const bettor=hand?.betting.players.find(p=>p.id===player?.id);
          return <div key={i} className={`table-place place-${i}`}>{player ? <><div className="avatar">{player.name.slice(0,1).toUpperCase()}</div><b>{player.name} {hand && positionLabels(hand.betting.players,hand.betting.button,player.id).map(label=><span className="position-badge" key={label}>{label}</span>)}</b><small>{!player.online ? `${t.offlinePlayer} · ` : ""}{bettor ? `${bettor.stack} ◉ · ${t.bet} ${bettor.streetBet}${bettor.folded ? ` · ${t.folded}` : ""}` : t.waiting}</small></> : <><span>＋</span><small>{t.free}</small></>}</div>;
        }) : (botMode ? players.map((bot,i)=><div className="seat opponent" key={bot.id}><div className="avatar">{bot.name.slice(0,1)}</div><b>{bot.name} · bot</b><span>10 000 ◉</span><div className="hand"><Card {...(stage===4 ? {value:i%2 ? "K♣" : "Q♣"} : {})}/><Card {...(stage===4 ? {value:i%2 ? "K♦" : "Q♦"} : {})}/></div></div>) : <div className="seat opponent"><div className="avatar">А</div><b>Alex · demo</b><span>10 000 ◉</span><div className="hand"><Card {...(stage===4 ? {value:"K♣"} : {})}/><Card {...(stage===4 ? {value:"K♦"} : {})}/></div></div>)}
        <div className="community"><p>{roomCode ? (hand ? t.stages[hand.betting.street as keyof typeof t.stages] ?? hand.betting.street : t.waitingHand) : [t.stages.preflop,t.stages.flop,t.stages.turn,t.stages.river,t.stages.showdown][stage]}</p><div className="cards">{board.map((value,i)=><Card key={i} {...(roomCode ? (hand?.board[i] ? {value: displayCard(hand.board[i]!)} : {}) : (i<visible ? {value} : {}))}/>)}</div><span className="pot-amount" key={hand?.betting.pot ?? 0}>{t.pot}: {hand?.betting.pot ?? 0} ◉</span></div>
        <div className="seat player"><div className="hand">{roomCode ? [0,1].map(i => <Card key={i} {...(hand?.hole[i] ? {value: displayCard(hand.hole[i]!)} : {})}/>) : <><Card value="A♠"/><Card value="Q♥"/></>}</div><b>{name} · {t.you} {hand && profile && positionLabels(hand.betting.players,hand.betting.button,profile.id).map(label=><span className="position-badge" key={label}>{label}</span>)}</b><span>{me?.stack ?? profile?.seat?.stack ?? 10000} ◉ {me ? `· ${t.bet} ${me.streetBet}` : ""}</span></div>
      </div>
      <div className="controls"><div aria-live="polite"><strong>{!hand ? (roomCode && readyPlayers>=2 ? t.readyToDeal : t.needTwo) : hand.result ? t.finished : myTurn ? t.yourTurn : `${t.turn}: ${players.find(p=>p.id===hand.betting.turn)?.name ?? t.awaiting}`}</strong><p>{actionError || (deadline && !hand?.result ? `${t.left} ${Math.max(0,Math.ceil((deadline-clock)/1000))} ${t.seconds}` : t.savedChips)}</p></div>{roomCode && (!hand || hand.result) ? <button className="primary" disabled={readyPlayers<2} onClick={()=>socket.timeout(5000).emit("room:advance",roomCode,(err:Error|null,result?:{ok:boolean;error?:string})=>{if(err || !result?.ok)setActionError(preferences.language==="ru" ? result?.error ?? t.startError : t.startError);})}>{hand ? t.newHand : t.deal}</button> : roomCode && hand ? <div className="actions"><button disabled={!myTurn} onClick={()=>sendAction("fold")}>{t.fold}</button><button disabled={!myTurn} onClick={()=>sendAction(callAmount ? "call" : "check")}>{callAmount ? `${t.call} ${Math.min(callAmount,me?.stack ?? 0)}` : t.check}</button><label>{t.raiseTo}<input type="number" min="1" step="1" value={raiseTo} onChange={e=>setRaiseTo(e.target.value)}/></label><button disabled={!myTurn} onClick={()=>sendAction("raise")}>{t.raise}</button></div> : <button className="primary" onClick={()=>setStage(stage===4 ? 0 : stage+1)}>{t.nextCard}</button>}</div>
    </main>}
    <footer>СВОИ © 2026<span>{t.footer}</span></footer>
  </div>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);


