import {describe,it,expect} from "vitest";
import {mkdtempSync,rmSync,readFileSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {loadOrCreateKey,parseConfiguredKey} from "../../../apps/server/src/key.js";

describe("local snapshot encryption key",()=>{
  it("creates a key once and loads the same bytes after restart",()=>{
    const dir=mkdtempSync(join(tmpdir(),"poker-key-test-"));
    try {
      const path=join(dir,"key");
      const first=loadOrCreateKey(path);
      expect(first).toHaveLength(32);
      expect(loadOrCreateKey(path)).toEqual(first);
      expect(readFileSync(path)).toEqual(first);
    } finally {rmSync(dir,{recursive:true,force:true});}
  });
  it("does not create a replacement key when an unfinished hand requires the original",()=>{
    const dir=mkdtempSync(join(tmpdir(),"poker-key-test-"));
    try {
      const path=join(dir,"key");
      expect(()=>loadOrCreateKey(path,false)).toThrow();
      expect(existsSync(path)).toBe(false);
      const original=loadOrCreateKey(path);
      expect(loadOrCreateKey(path,false)).toEqual(original);
    } finally {rmSync(dir,{recursive:true,force:true});}
  });
  it("validates a persistent secret supplied by the hosting environment",()=>{
    const value=Buffer.alloc(32,42).toString("base64");
    expect(parseConfiguredKey(value)).toEqual(Buffer.alloc(32,42));
    expect(()=>parseConfiguredKey("invalid")).toThrow();
    expect(()=>parseConfiguredKey(Buffer.alloc(31).toString("base64"))).toThrow();
  });
});
