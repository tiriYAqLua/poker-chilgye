/** In-memory per-account limit for a single server process. */
export class AttemptLimiter {
  private attempts=new Map<string,{count:number;until:number}>();
  constructor(private readonly limit:number,private readonly windowMs:number) {}
  allowed(id:string,now=Date.now()):boolean {
    const entry=this.attempts.get(id);
    if(!entry)return true;
    if(now>=entry.until){this.attempts.delete(id);return true;}
    return entry.count<this.limit;
  }
  fail(id:string,now=Date.now()):void {
    for(const [key,value] of this.attempts)if(now>=value.until)this.attempts.delete(key);
    const entry=this.attempts.get(id);
    if(entry)entry.count++;
    else if(this.attempts.size<10000)this.attempts.set(id,{count:1,until:now+this.windowMs});
    else throw Error("Слишком много попыток. Попробуйте позже.");
  }
  reset(id:string):void {this.attempts.delete(id);}
}
