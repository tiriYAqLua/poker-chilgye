import type {Server as HttpServer} from "node:http";
import {Server} from "socket.io";
import type {BettingAction} from "@poker/game-engine";
import {sessionToken} from "./api.js";
import {AsyncRoomManager,type AsyncRoom} from "./rooms-async.js";
import {tableView} from "./table.js";
import type {PostgresWalletStore} from "./postgres-wallet.js";
import {AttemptLimiter} from "./rate-limit.js";

const ORIGIN="http://127.0.0.1:5173",accountRoom=(id:string)=>`account:${id}`;
type Reply=(result:object)=>void;
const replyOrNoop=(value:unknown):Reply=>typeof value==="function"?value as Reply:()=>{};

/** Socket handlers always await PostgreSQL before acknowledging an action. */
export async function attachAsyncRealtime(http:HttpServer,wallet:PostgresWalletStore,key:Buffer,allowedOrigin=ORIGIN) {
  const manager=await AsyncRoomManager.restore(wallet,key),roomAttempts=new AttemptLimiter(12,60_000);
  const io=new Server(http,{transports:["websocket"],cors:{origin:allowedOrigin,credentials:true,methods:["GET","POST"]},allowRequest:(req,done)=>done(null,req.headers.origin===allowedOrigin)});
  const turnTimers=new Map<string,NodeJS.Timeout>(),leaveTimers=new Map<string,NodeJS.Timeout>(),deadlines=new Map<string,{signature:string;at:number}>();
  const online=(id:string)=>Boolean(io.sockets.adapter.rooms.get(accountRoom(id))?.size);
  const friendState=async(id:string)=>({code:await wallet.friendCode(id),friends:(await wallet.friends(id)).map(friend=>({...friend,online:online(friend.id)})),requests:await wallet.incomingRequests(id)});
  const notifyFriends=async(id:string)=>{for(const friend of await wallet.friends(id))io.to(accountRoom(friend.id)).emit("friends:state",await friendState(friend.id));};
  const cancelTimer=(timers:Map<string,NodeJS.Timeout>,id:string)=>{const timer=timers.get(id);if(timer)clearTimeout(timer);timers.delete(id);};
  const publish=async(room:AsyncRoom):Promise<void>=>{
    const players=await Promise.all(room.players.map(async({id,name,leaving})=>({id,name,leaving,online:id.startsWith("bot:")||online(id),stack:(await wallet.seat(id))?.stack??0})));
    for(const player of room.players){
      if(player.leaving||player.id.startsWith("bot:"))continue;
      const hand=room.hand?.table.betting.players.some(item=>item.id===player.id)?tableView(room.hand.table,player.id):undefined;
      io.to(accountRoom(player.id)).emit("room:state",{code:room.code,players,hand,handId:room.hand?.id,version:room.hand?.version??0,deadline:deadlines.get(room.code)?.at??null,profile:await wallet.profile(player.id)});
    }
    if(room.hand?.table.result)for(const player of room.hand.table.betting.players)if(!player.id.startsWith("bot:"))io.to(accountRoom(player.id)).emit("wallet:profile",await wallet.profile(player.id));
  };
  const schedule=(room:AsyncRoom):void=>{
    const hand=room.hand;if(!hand||hand.table.result||!hand.table.betting.turn){cancelTimer(turnTimers,room.code);deadlines.delete(room.code);return;}
    const turn=hand.table.betting.turn,handId=hand.id,version=hand.version,signature=`${handId}:${version}:${turn}`;
    if(deadlines.get(room.code)?.signature===signature)return;
    const bot=turn.startsWith("bot:");
    const delay=bot?900:20_000;
    cancelTimer(turnTimers,room.code);deadlines.set(room.code,{signature,at:Date.now()+delay});
    const timer=setTimeout(()=>{void (async()=>{
      turnTimers.delete(room.code);deadlines.delete(room.code);const current=manager.get(room.code);
      if(!current?.hand||current.hand.id!==handId||current.hand.version!==version||current.hand.table.betting.turn!==turn)return;
      const player=current.hand.table.betting.players.find(item=>item.id===turn);if(!player)return;
      try{await manager.action(room.code,turn,handId,version,{type:player.streetBet>=current.hand.table.betting.currentBet?"check":bot?"call":"fold"});const updated=manager.get(room.code);if(updated){schedule(updated);await publish(updated);}else await publish(current);}catch(error){console.error("Turn timeout failed",error);}
    })();},delay);timer.unref();turnTimers.set(room.code,timer);
  };
  const scheduleDeparture=(id:string):void=>{
    cancelTimer(leaveTimers,id);const timer=setTimeout(()=>{void (async()=>{
      leaveTimers.delete(id);if(online(id))return;const seat=await wallet.seat(id);if(!seat)return;
      try{await manager.leave(seat.room,id);const room=manager.get(seat.room);if(room){schedule(room);await publish(room);}else{cancelTimer(turnTimers,seat.room);deadlines.delete(seat.room);}}catch(error){console.error("Seat timeout failed",error);}
    })();},600_000);timer.unref();leaveTimers.set(id,timer);
  };
  for(const id of await wallet.activeHandIds()) {const hand=await wallet.loadHand(id,key),roomCode=(hand?.state as {room?:string}|undefined)?.room,room=roomCode?manager.get(roomCode):undefined;if(room){schedule(room);for(const player of room.players)if(!player.id.startsWith("bot:"))scheduleDeparture(player.id);}}
  io.use((socket,next)=>{void (async()=>{const token=sessionToken(socket.handshake.headers.cookie),id=token?await wallet.authenticate(token):null;if(!id){next(new Error("Необходима гостевая сессия"));return;}socket.data.userId=id;next();})().catch(()=>next(new Error("Необходима гостевая сессия")));});
  io.on("connection",socket=>{
    const id=socket.data.userId as string;
    socket.join(accountRoom(id));
    cancelTimer(leaveTimers,id);
    const playerName=(value:unknown)=>typeof value==="string"&&value.trim()?value.trim().slice(0,20):"Игрок";
    const run=(reply:unknown,operation:()=>Promise<object>)=>{void (async()=>{const respond=replyOrNoop(reply);try{respond({ok:true,...await operation()});}catch(error){respond({ok:false,error:error instanceof Error?error.message:"Ошибка сервера"});}})();};
    socket.on("friends:list",reply=>run(reply,()=>friendState(id)));
    socket.on("profile:name",(raw,reply)=>run(reply,async()=>{if(typeof raw!=="string"||!raw.trim()||raw.trim().length>20)throw Error("Укажите имя до 20 символов");if(await wallet.seat(id))throw Error("Имя можно изменить в главном меню после выхода из комнаты");await wallet.setDisplayName(id,raw.trim());await notifyFriends(id);return {};}));
    socket.on("history:list",reply=>run(reply,async()=>({hands:await wallet.handHistory(id)})));
    socket.on("friends:request",(raw,reply)=>run(reply,async()=>{if(typeof raw!=="string")throw Error("Invalid friend code");const request=await wallet.requestFriend(id,raw.trim()),recipient=await wallet.requestRecipient(id,request);if(recipient)io.to(accountRoom(recipient)).emit("friends:state",await friendState(recipient));return {request};}));
    socket.on("friends:accept",(raw,reply)=>run(reply,async()=>{if(typeof raw!=="string")throw Error("Invalid request");const incoming=(await wallet.incomingRequests(id)).find(item=>item.id===raw);if(!incoming)throw Error("Invitation not found");await wallet.acceptFriend(id,raw);io.to(accountRoom(id)).emit("friends:state",await friendState(id));io.to(accountRoom(incoming.senderId)).emit("friends:state",await friendState(incoming.senderId));return {};}));
    socket.on("friends:remove",(raw,reply)=>run(reply,async()=>{if(typeof raw!=="string"||!(await wallet.friends(id)).some(friend=>friend.id===raw))throw Error("Friend not found");await wallet.removeFriend(id,raw);io.to(accountRoom(id)).emit("friends:state",await friendState(id));io.to(accountRoom(raw)).emit("friends:state",await friendState(raw));return {};}));
    socket.on("friends:invite",(raw,reply)=>run(reply,async()=>{if(typeof raw!=="string"||!(await wallet.friends(id)).some(friend=>friend.id===raw))throw Error("Друг не найден");const seat=await wallet.seat(id),room=seat?manager.get(seat.room):undefined,sender=room?.players.find(player=>player.id===id&&!player.leaving);if(!room||!sender)throw Error("Сначала войдите в комнату");if(room.players.length>=6)throw Error("В комнате нет свободных мест");if(!online(raw))throw Error("Друг не в сети");if(await wallet.seat(raw))throw Error("Друг уже находится за столом");io.to(accountRoom(raw)).emit("friend:invite",{fromId:id,fromName:sender.name,room:room.code});return {};}));
    socket.on("room:create",(name,reply)=>run(reply,async()=>{const room=await manager.create(id,playerName(name));await publish(room);return {room:room.code,profile:await wallet.profile(id)};}));
    socket.on("room:create-bots",(name,reply)=>run(reply,async()=>{const room=await manager.create(id,playerName(name));try{await manager.addBots(room);}catch(error){await manager.leave(room.code,id);throw error;}await publish(room);return {room:room.code,profile:await wallet.profile(id)};}));
    socket.on("room:join",(raw,name,reply)=>run(reply,async()=>{if(!roomAttempts.allowed(id))throw Error("Слишком много попыток. Попробуйте через минуту.");try{if(typeof raw!=="string"||!/^[A-Z2-9]{6}$/i.test(raw.trim()))throw Error("Проверьте код комнаты");const room=await manager.join(raw.trim().toUpperCase(),id,playerName(name));roomAttempts.reset(id);await publish(room);return {room:room.code,profile:await wallet.profile(id)};}catch(error){roomAttempts.fail(id);throw error;}}));
    socket.on("room:resume",(nameOrReply,maybeReply)=>{const reply=typeof nameOrReply==="function"?nameOrReply:maybeReply;run(reply,async()=>{const seat=await wallet.seat(id);if(!seat)return {profile:await wallet.profile(id)};const room=manager.get(seat.room);if(!room){await wallet.cashOut(id);return {profile:await wallet.profile(id)};}const existing=room.players.find(player=>player.id===id);if(!existing){await wallet.cashOut(id);return {profile:await wallet.profile(id)};}if(existing.leaving)return {pending:true,profile:await wallet.profile(id)};await manager.join(room.code,id,typeof nameOrReply==="string"?playerName(nameOrReply):existing.name);await publish(room);return {room:room.code,profile:await wallet.profile(id)};});});
    socket.on("room:sync",reply=>run(reply,async()=>{const seat=await wallet.seat(id),room=seat?manager.get(seat.room):undefined;if(!room)throw Error("Нет активного места");await publish(room);return {room:room.code,profile:await wallet.profile(id)};}));
    socket.on("room:leave",reply=>run(reply,async()=>{const seat=await wallet.seat(id);if(!seat)return {profile:await wallet.profile(id)};await manager.leave(seat.room,id);const room=manager.get(seat.room);if(room){schedule(room);await publish(room);}else{cancelTimer(turnTimers,seat.room);deadlines.delete(seat.room);}return {profile:await wallet.profile(id),pending:!!await wallet.seat(id)};}));
    socket.on("room:advance",(raw,reply)=>run(reply,async()=>{if(typeof raw!=="string")throw Error("Нет комнаты");const hand=await manager.start(raw,id),room=manager.get(raw)!;schedule(room);await publish(room);return {handId:hand.id,version:hand.version};}));
    socket.on("room:action",(raw,handId,version,action,reply)=>run(reply,async()=>{if(typeof raw!=="string"||typeof handId!=="string"||!Number.isSafeInteger(version)||!action||typeof action!=="object")throw Error("Некорректное действие");const candidate=action as Record<string,unknown>;if(!["fold","check","call","raise"].includes(String(candidate.type))||(candidate.type==="raise"&&typeof candidate.to!=="number"))throw Error("Некорректное действие");const prior=manager.get(raw);await manager.action(raw,id,handId,version as number,candidate as BettingAction);const room=manager.get(raw);if(room){schedule(room);await publish(room);}else if(prior)await publish(prior);return {};}));
    socket.on("disconnect",()=>{
      if(online(id))return;
      scheduleDeparture(id);
      void (async()=>{
        const seat=await wallet.seat(id),room=seat?manager.get(seat.room):undefined;
        if(room)await publish(room);
        await notifyFriends(id);
      })().catch(error=>console.error("Failed to update player presence",error));
    });
    void (async()=>{
      const seat=await wallet.seat(id),room=seat?manager.get(seat.room):undefined;
      if(room&&socket.connected)await publish(room);
      if(socket.connected)await notifyFriends(id);
    })().catch(error=>console.error("Failed to synchronize player presence",error));
  });
  return {close:()=>{for(const timer of turnTimers.values())clearTimeout(timer);for(const timer of leaveTimers.values())clearTimeout(timer);io.close();}};
}
