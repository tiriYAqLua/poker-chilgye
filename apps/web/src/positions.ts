export function positionLabels(players:{id:string}[],button:number,id:string):string[] {
  if(players.length<2 || button<0 || button>=players.length)return [];
  const index=players.findIndex(player=>player.id===id);
  if(index<0)return [];
  const small=players.length===2 ? button : (button+1)%players.length;
  const big=(small+1)%players.length;
  return [...(index===button ? ["D"] : []),...(index===small ? ["SB"] : []),...(index===big ? ["BB"] : [])];
}
