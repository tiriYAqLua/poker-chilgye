import type {Server as HttpServer} from "node:http";
import {Server} from "socket.io";
import type {BettingAction} from "@poker/game-engine";
import {sessionToken} from "./api.js";
import {RoomManager,type Room} from "./rooms.js";
import {tableView} from "./table.js";
import type {WalletStore} from "./wallet.js";
import {AttemptLimiter} from "./rate-limit.js";

const ORIGIN="http://127.0.0.1:5173";
const accountRoom=(id:string)=>`account:${id}`;
type Reply=(result:object)=>void;
const replyOrNoop=(value:unknown):Reply=>typeof value==="function" ? value as Reply : ()=>{};

/** Single-process local runtime. Socket identities are never used as player IDs. */
export function attachRealtime(http:HttpServer,wallet:WalletStore,key:Buffer,allowedOrigin=ORIGIN) {
  const manager=new RoomManager(wallet,key);
  const roomAttempts=new AttemptLimiter(12,60000);
  const io=new Server(http,{transports:["websocket"],cors:{origin:allowedOrigin,credentials:true,methods:["GET","POST"]},
    allowRequest:(req,done)=>done(null,req.headers.origin===allowedOrigin)});
  const turnTimers=new Map<string,NodeJS.Timeout>(), leaveTimers=new Map<string,NodeJS.Timeout>();
  const deadlines=new Map<string,{signature:string;at:number}>();
  io.use((socket,next)=>{
    const token=sessionToken(socket.handshake.headers.cookie);
    const id=token ? wallet.authenticate(token) : null;
    if(!id){next(new Error("Необходима гостевая сессия"));return;}
    socket.data.userId=id;next();
  });
  const online=(id:string)=>Boolean(io.sockets.adapter.rooms.get(accountRoom(id))?.size);
  const friendState=(id:string)=>({code:wallet.friendCode(id),friends:wallet.friends(id).map(friend=>({...friend,online:online(friend.id)})),requests:wallet.incomingRequests(id)});
  const notifyFriends=(id:string)=>{for(const friend of wallet.friends(id))io.to(accountRoom(friend.id)).emit("friends:state",friendState(friend.id));};
  const cancelTimer=(timers:Map<string,NodeJS.Timeout>,key:string)=>{const timer=timers.get(key);if(timer)clearTimeout(timer);timers.delete(key);};
  function publish(room:Room):void {
    const players=room.players.map(({id,name,leaving})=>({id,name,leaving,online:online(id),stack:wallet.seat(id)?.stack ?? 0}));
    for(const player of room.players) {
      if(player.leaving) continue;
      const hand=room.hand?.table.betting.players.some(p=>p.id===player.id) ? tableView(room.hand.table,player.id) : undefined;
      io.to(accountRoom(player.id)).emit("room:state",{code:room.code,players,hand,handId:room.hand?.id,version:room.hand?.version ?? 0,deadline:deadlines.get(room.code)?.at ?? null,profile:wallet.profile(player.id)});
    }
    if(room.hand?.table.result) for(const player of room.hand.table.betting.players) io.to(accountRoom(player.id)).emit("wallet:profile",wallet.profile(player.id));
  }
  function schedule(room:Room):void {
    const hand=room.hand;
    if(!hand || hand.table.result || !hand.table.betting.turn){cancelTimer(turnTimers,room.code);deadlines.delete(room.code);return;}
    const turn=hand.table.betting.turn,handId=hand.id,version=hand.version;
    const signature=`${handId}:${version}:${turn}`;
    if(deadlines.get(room.code)?.signature===signature)return;
    cancelTimer(turnTimers,room.code);
    deadlines.set(room.code,{signature,at:Date.now()+20000});
    const timer=setTimeout(()=>{
      turnTimers.delete(room.code);
      deadlines.delete(room.code);
      const current=manager.get(room.code);
      if(!current?.hand || current.hand.id!==handId || current.hand.version!==version || current.hand.table.betting.turn!==turn)return;
      const player=current.hand.table.betting.players.find(p=>p.id===turn);
      if(!player)return;
      try {
        manager.action(room.code,turn,handId,version,{type:player.streetBet>=current.hand.table.betting.currentBet ? "check" : "fold"});
        const updated=manager.get(room.code);if(updated){schedule(updated);publish(updated);}else publish(current);
      } catch(error){console.error("Turn timeout failed",error);}
    },20000);
    timer.unref();turnTimers.set(room.code,timer);
  }
  function scheduleDeparture(id:string):void {
    cancelTimer(leaveTimers,id);
    const timer=setTimeout(()=>{
      leaveTimers.delete(id);
      if(online(id))return;
      const seat=wallet.seat(id);if(!seat)return;
      try {
        manager.leave(seat.room,id);
        const room=manager.get(seat.room);if(room){schedule(room);publish(room);}else {cancelTimer(turnTimers,seat.room);deadlines.delete(seat.room);}
      } catch(error){console.error("Seat timeout failed",error);}
    },600000);
    timer.unref();leaveTimers.set(id,timer);
  }
  for(const id of wallet.activeHandIds()) {
    const hand=wallet.loadHand(id,key);
    const roomCode=(hand?.state as {room?:string}|undefined)?.room;
    const room=roomCode ? manager.get(roomCode) : undefined;
    if(room) {schedule(room);for(const player of room.players)scheduleDeparture(player.id);}
  }
  io.on("connection",socket=>{
    const id=socket.data.userId as string;
    socket.join(accountRoom(id));cancelTimer(leaveTimers,id);
    const currentSeat=wallet.seat(id);
    if(currentSeat) {const room=manager.get(currentSeat.room);if(room)publish(room);}
    const playerName=(input:unknown)=>typeof input==="string" && input.trim() ? input.trim().slice(0,20) : "Игрок";
    const run=(reply:unknown,fn:()=>object)=>{const respond=replyOrNoop(reply);try {respond({ok:true,...fn()});}catch(error){respond({ok:false,error:error instanceof Error ? error.message : "Ошибка сервера"});}};
    notifyFriends(id);
    socket.on("friends:list",(reply:unknown)=>run(reply,()=>friendState(id)));
    socket.on("profile:name",(raw:unknown,reply:unknown)=>run(reply,()=>{
      if(typeof raw!=="string" || !raw.trim() || raw.trim().length>20)throw Error("Укажите имя до 20 символов");
      if(wallet.seat(id))throw Error("Имя можно изменить в главном меню после выхода из комнаты");
      wallet.setDisplayName(id,raw.trim());notifyFriends(id);return {};
    }));
    socket.on("history:list",(reply:unknown)=>run(reply,()=>({hands:wallet.handHistory(id)})));
    socket.on("friends:request",(raw:unknown,reply:unknown)=>run(reply,()=>{
      if(typeof raw!=="string")throw Error("Invalid friend code");
      const request=wallet.requestFriend(id,raw.trim());
      const recipient=wallet.requestRecipient(id,request);
      if(recipient)io.to(accountRoom(recipient)).emit("friends:state",friendState(recipient));
      return {request};
    }));
    socket.on("friends:accept",(raw:unknown,reply:unknown)=>run(reply,()=>{
      if(typeof raw!=="string")throw Error("Invalid request");
      const incoming=wallet.incomingRequests(id).find(item=>item.id===raw);
      if(!incoming)throw Error("Invitation not found");
      wallet.acceptFriend(id,raw);
      io.to(accountRoom(id)).emit("friends:state",friendState(id));
      io.to(accountRoom(incoming.senderId)).emit("friends:state",friendState(incoming.senderId));
      return {};
    }));
    socket.on("friends:remove",(raw:unknown,reply:unknown)=>run(reply,()=>{
      if(typeof raw!=="string" || !wallet.friends(id).some(friend=>friend.id===raw))throw Error("Friend not found");
      wallet.removeFriend(id,raw);
      io.to(accountRoom(id)).emit("friends:state",friendState(id));
      io.to(accountRoom(raw)).emit("friends:state",friendState(raw));
      return {};
    }));
    socket.on("friends:invite",(raw:unknown,reply:unknown)=>run(reply,()=>{
      if(typeof raw!=="string" || !wallet.friends(id).some(friend=>friend.id===raw))throw Error("Друг не найден");
      const seat=wallet.seat(id),room=seat ? manager.get(seat.room) : undefined;
      const sender=room?.players.find(player=>player.id===id && !player.leaving);
      if(!room || !sender)throw Error("Сначала войдите в комнату");
      if(room.players.length>=6)throw Error("В комнате нет свободных мест");
      if(!online(raw))throw Error("Друг не в сети");
      if(wallet.seat(raw))throw Error("Друг уже находится за столом");
      io.to(accountRoom(raw)).emit("friend:invite",{fromId:id,fromName:sender.name,room:room.code});
      return {};
    }));
    socket.on("room:create",(name:unknown,reply:unknown)=>run(reply,()=>{
      const code=manager.create(id,playerName(name));const room=manager.get(code)!;
      publish(room);return {room:code,profile:wallet.profile(id)};
    }));
    socket.on("room:join",(raw:unknown,name:unknown,reply:unknown)=>run(reply,()=>{
      if(!roomAttempts.allowed(id))throw Error("Слишком много попыток. Попробуйте через минуту.");
      try {
        if(typeof raw!=="string" || !/^[A-Z2-9]{6}$/i.test(raw.trim())) throw Error("Проверьте код комнаты");
        const room=manager.join(raw.trim().toUpperCase(),id,playerName(name));roomAttempts.reset(id);publish(room);return {room:room.code,profile:wallet.profile(id)};
      } catch(error) {roomAttempts.fail(id);throw error;}
    }));
    socket.on("room:resume",(nameOrReply:unknown,maybeReply:unknown)=>{
      const reply=typeof nameOrReply==="function" ? nameOrReply : maybeReply;
      run(reply,()=>{
      const seat=wallet.seat(id);if(!seat)throw Error("Нет активного места");
      const room=manager.get(seat.room);if(!room)throw Error("Комната недоступна");
      const existing=room.players.find(p=>p.id===id);
      if(existing) manager.join(room.code,id,typeof nameOrReply==="string" ? playerName(nameOrReply) : existing.name);
      publish(room);return {room:room.code,profile:wallet.profile(id)};
      });
    });
    socket.on("room:sync",(reply:unknown)=>run(reply,()=>{
      const seat=wallet.seat(id);
      const room=seat ? manager.get(seat.room) : undefined;
      if(!room)throw Error("Нет активного места");
      publish(room);return {room:room.code,profile:wallet.profile(id)};
    }));
    socket.on("room:leave",(reply:unknown)=>run(reply,()=>{
      const seat=wallet.seat(id);if(!seat)return {profile:wallet.profile(id)};
      manager.leave(seat.room,id);const room=manager.get(seat.room);
      if(room){schedule(room);publish(room);}else {cancelTimer(turnTimers,seat.room);deadlines.delete(seat.room);}
      return {profile:wallet.profile(id),pending:!!wallet.seat(id)};
    }));
    socket.on("room:advance",(raw:unknown,reply:unknown)=>run(reply,()=>{
      if(typeof raw!=="string")throw Error("Нет комнаты");
      const hand=manager.start(raw,id);const room=manager.get(raw)!;
      schedule(room);publish(room);return {handId:hand.id,version:hand.version};
    }));
    socket.on("room:action",(raw:unknown,handId:unknown,version:unknown,action:unknown,reply:unknown)=>run(reply,()=>{
      if(typeof raw!=="string" || typeof handId!=="string" || !Number.isSafeInteger(version) || !action || typeof action!=="object")throw Error("Некорректное действие");
      const candidate=action as Record<string,unknown>;
      if(!["fold","check","call","raise"].includes(String(candidate.type)) || (candidate.type==="raise" && typeof candidate.to!=="number"))throw Error("Некорректное действие");
      const prior=manager.get(raw);
      manager.action(raw,id,handId,version as number,candidate as BettingAction);
      const room=manager.get(raw);if(room){schedule(room);publish(room);}else if(prior)publish(prior);
      return {};
    }));
    socket.on("disconnect",()=>{
      if(!online(id)) {
        notifyFriends(id);
        const seat=wallet.seat(id);const room=seat ? manager.get(seat.room) : undefined;
        if(room){publish(room);scheduleDeparture(id);}
      }
    });
  });
  return {close:()=>{for(const timer of turnTimers.values())clearTimeout(timer);for(const timer of leaveTimers.values())clearTimeout(timer);io.close();}};
}
