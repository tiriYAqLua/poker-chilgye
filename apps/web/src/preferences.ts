export type Preferences = {language:"ru"|"en";sound:boolean;volume:number};
export const defaultPreferences:Preferences = {language:"ru",sound:true,volume:50};
export function parsePreferences(raw:string|null):Preferences {
  try {
    const value=JSON.parse(raw ?? "null") as Partial<Preferences>|null;
    if(!value || (value.language!=="ru" && value.language!=="en") || typeof value.sound!=="boolean" ||
      typeof value.volume!=="number" || !Number.isInteger(value.volume) || value.volume<0 || value.volume>100) return {...defaultPreferences};
    return {language:value.language,sound:value.sound,volume:value.volume};
  } catch {return {...defaultPreferences};}
}
export const labels = {
  ru:{
    settings:"Настройки",close:"Закрыть",language:"Язык",sound:"Звуковые эффекты",volume:"Громкость",testSound:"Проверить звук",saved:"Сохраняется на этом устройстве",
    online:"● Сервер онлайн",offline:"○ Сервер не запущен",tagline:"ХОРОШАЯ КОМПАНИЯ. ХОРОШАЯ ИГРА.",hero1:"Все свои.",hero2:"Карты на стол.",intro:"Ваш покерный клуб для друзей.",
    connected:"Сервер подключён — можно создать комнату.",disconnected:"Запустите сервер, чтобы создать комнату для друзей.",create:"Создать комнату",demo:"Открыть локальное демо",
    upTo:"До 6 игроков",chips:"Виртуальные фишки",guest:"ГОСТЕВОЙ ПРОФИЛЬ",name:"Имя за столом",code:"Код комнаты",codeExample:"Например, ABC234",join:"Войти по коду",
    wallet:"Доступно в кошельке",reserved:"зарезервировано за столом",cookie:"Гостевой кошелёк привязан к этому браузеру. При очистке данных браузера доступ к нему будет потерян.",
    topup:"Бесплатное пополнение",perHour:"5 000 / час",claim:"Получить фишки",grantInfo:"Доступно раз в час.",
    invite:"01 / ПРИГЛАШАЙТЕ",roomCode:"Комната по коду",inviteInfo:"Создайте комнату и передайте её код участникам.",play:"02 / ИГРАЙТЕ",gameInfo:"Делайте ставки и открывайте карты вместе.",
    return:"03 / ВОЗВРАЩАЙТЕСЬ",keepChips:"Фишки останутся с вами",walletInfo:"Гостевой кошелёк сохраняется на сервере.",
    menu:"← Главное меню",table:"Стол для своих",room:"Код комнаты",players:"игроков",localDemo:"Локальная тестовая раздача",realtime:"Real-time подключён",demoOnly:"Демо · без ставок",
    participants:"Участники комнаты",positions:"D — дилер · SB — малый блайнд · BB — большой блайнд",tie:"Ничья",winner:"Победитель",bestHand:"Лучшая комбинация",payout:"Получено из банка",player:"Игрок",offlinePlayer:"Не в сети",bet:"ставка",folded:"пас",waiting:"Ожидает раздачу",free:"Свободно",you:"вы",
    waitingHand:"ОЖИДАНИЕ РАЗДАЧИ",pot:"Банк",needTwo:"Для начала нужно минимум два игрока",readyToDeal:"Игроки готовы — можно раздать карты",finished:"Раздача завершена",yourTurn:"Ваш ход",turn:"Ход",awaiting:"ожидание",
    left:"Осталось",seconds:"сек. После таймера — чек или пас.",savedChips:"Виртуальные фишки сохраняются после завершения раздачи.",newHand:"Новая раздача",deal:"Раздать карты",
    fold:"Пас",call:"Уравнять",check:"Чек",raiseTo:"Ставка до",raise:"Повысить",nextCard:"Следующая карта",footer:"Без реальных денег · Локальная версия",
    reconnect:"Соединение потеряно. Переподключаемся…",connectionError:"Не удалось подключиться к серверу.",sessionError:"Не удалось загрузить кошелёк. Проверьте сервер и обновите страницу.",
    grantError:"Пополнение доступно раз в час после завершения раздачи.",createError:"Не удалось создать комнату.",serverTimeout:"Сервер не ответил.",leaveError:"Не удалось выйти. Попробуйте снова.",
    leavePending:"Вы выйдете после завершения раздачи; оставшиеся фишки вернутся в кошелёк.",serverOffline:"Сервер не подключён.",joinError:"Не удалось войти в комнату.",startError:"Не удалось начать раздачу.",
    stages:{preflop:"ПРЕФЛОП",flop:"ФЛОП",turn:"ТЕРН",river:"РИВЕР",showdown:"ВСКРЫТИЕ",complete:"ЗАВЕРШЕНО"},
    categories:["Старшая карта","Пара","Две пары","Сет","Стрит","Флеш","Фулл-хаус","Каре","Стрит-флеш"]
  },
  en:{
    settings:"Settings",close:"Close",language:"Language",sound:"Sound effects",volume:"Volume",testSound:"Test sound",saved:"Saved on this device",
    online:"● Server online",offline:"○ Server offline",tagline:"GOOD COMPANY. GOOD GAME.",hero1:"Among friends.",hero2:"Cards on the table.",intro:"Your poker club for friends.",
    connected:"Connected — create a room to play.",disconnected:"Start the server to create a room for friends.",create:"Create room",demo:"Open local demo",
    upTo:"Up to 6 players",chips:"Virtual chips",guest:"GUEST PROFILE",name:"Name at the table",code:"Room code",codeExample:"For example, ABC234",join:"Join by code",
    wallet:"Available in wallet",reserved:"reserved at the table",cookie:"Your guest wallet is linked to this browser. Clearing browser data will remove access to it.",
    topup:"Free refill",perHour:"5,000 / hour",claim:"Get chips",grantInfo:"Available once an hour.",
    invite:"01 / INVITE",roomCode:"A room by code",inviteInfo:"Create a room and share its code with players.",play:"02 / PLAY",gameInfo:"Place bets and reveal cards together.",
    return:"03 / RETURN",keepChips:"Keep your chips",walletInfo:"Your guest wallet is saved on the server.",
    menu:"← Main menu",table:"Friends' table",room:"Room code",players:"players",localDemo:"Local practice deal",realtime:"Real-time connected",demoOnly:"Demo · no bets",
    participants:"Room participants",positions:"D — dealer · SB — small blind · BB — big blind",tie:"Tie",winner:"Winner",bestHand:"Best hand",payout:"Received from pot",player:"Player",offlinePlayer:"Offline",bet:"bet",folded:"folded",waiting:"Waiting for the next hand",free:"Available",you:"you",
    waitingHand:"WAITING FOR DEAL",pot:"Pot",needTwo:"At least two players are needed",readyToDeal:"Players are ready — deal the cards",finished:"Hand finished",yourTurn:"Your turn",turn:"Turn",awaiting:"waiting",
    left:"Time left",seconds:"sec. Timeout will check or fold.",savedChips:"Virtual chips are saved when the hand finishes.",newHand:"New hand",deal:"Deal cards",
    fold:"Fold",call:"Call",check:"Check",raiseTo:"Raise to",raise:"Raise",nextCard:"Next card",footer:"No real money · Local version",
    reconnect:"Connection lost. Reconnecting…",connectionError:"Could not connect to the server.",sessionError:"Could not load your wallet. Check the server and refresh.",
    grantError:"The refill is available once an hour after the hand ends.",createError:"Could not create a room.",serverTimeout:"The server did not respond.",leaveError:"Could not leave. Please try again.",
    leavePending:"You will leave after the hand; remaining chips return to your wallet.",serverOffline:"The server is offline.",joinError:"Could not join the room.",startError:"Could not start the hand.",
    stages:{preflop:"PREFLOP",flop:"FLOP",turn:"TURN",river:"RIVER",showdown:"SHOWDOWN",complete:"FINISHED"},
    categories:["High card","Pair","Two pair","Three of a kind","Straight","Flush","Full house","Four of a kind","Straight flush"]
  }
} as const;
