import {describe,it,expect} from "vitest";
import {parsePreferences,defaultPreferences} from "../../../apps/web/src/preferences.js";

describe("browser preferences",()=>{
  it("restores valid choices and rejects corrupt values",()=>{
    expect(parsePreferences('{"language":"en","sound":false,"volume":25}')).toEqual({language:"en",sound:false,volume:25});
    expect(parsePreferences('{"language":"xx","sound":"false","volume":999}')).toEqual(defaultPreferences);
    expect(parsePreferences("{broken")).toEqual(defaultPreferences);
    expect(parsePreferences(null)).toEqual(defaultPreferences);
  });
});
