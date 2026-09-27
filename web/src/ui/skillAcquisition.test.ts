import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import type { AcquisitionReview } from "../training/types.ts";
register("./svelteSsrHook.ts", import.meta.url);
const { render } = await import("svelte/server");
const Panel = (await import("./SkillAcquisition.svelte")).default;
const Row = (await import("./HangarPilotRow.svelte")).default;
test("acquisition review shows exact finance, target and explicit confirmation without mutation on render",()=>{
  let calls=0;
  const review={mode:"FAST",stage:"PROCURER",canAcquire:true,reviewID:"one-shot",skills:[{typeID:11,name:"Astrogeology",price:"450000.00"}],
    total:"31500000.00",personalBalance:"12000000.00",shortfall:"19500000.00",blockers:[],cleanup:[],
    funding:{characterID:10,corporationID:98,division:1000,balance:"100000000.00"}} as unknown as AcquisitionReview;
  const html=render(Panel,{props:{review,outcome:null,busy:false,mode:"FAST",stage:"PROCURER",officers:[],message:"",onReview(){calls++;},onAcquire(){calls++;},onChange(){}}}).body;
  for(const value of ["31,500,000 ISK","12,000,000 ISK","19,500,000 ISK","Astrogeology","Corporation 98","Acquire missing skills · FAST → PROCURER","Character wallet only","queue is a separate action"]) assert.ok(html.includes(value),value);
  assert.equal(calls,0);
});
for(const owner of ["BROWSER","BOT","RECOVERY","FACTORY","OTHER_SESSION"]) test(`Hangar Release allowed only for owned interactive BROWSER: ${owner}`,()=>{
  const pilot={characterID:9,name:"Augusta",account:"BMiner9",online:true,squads:[],training:null,skills:0} as never;
  const html=render(Row,{props:{pilot,owner,selected:false,manage:false,tapSelects:false,squads:[],squadMenuOpen:false,
    onActivate(){},onToggleSelect(){},onTogglePin(){},onRemove(){},onToggleSquadMenu(){},onToggleSquad(){},onRelease(){}}}).body;
  assert.equal(html.includes("Release pilot"),owner==="BROWSER");
});
test("Factory remains standalone: no space polling, queue writes only separate Apply; purchase never on mount",()=>{
  const src=readFileSync(new URL("./GoblinFactory.svelte",import.meta.url),"utf8");
  assert.doesNotMatch(src,/readSpaceSnapshot|setInterval/);
  assert.doesNotMatch(src.slice(src.indexOf("  onMount(")),/acquireFactorySkills\(/);
  const acquisition=src.slice(src.indexOf("  async function acquireSkills("),src.indexOf("  async function reviewQueue("));
  assert.doesNotMatch(acquisition,/applyTrainingQueue\(/);
});
