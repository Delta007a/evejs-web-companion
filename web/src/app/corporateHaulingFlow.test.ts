import test from "node:test";
import assert from "node:assert/strict";
import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";
import { fittingBody, flightBody, holdsBody, namesBody } from "./botFixtures.ts";
import type { BotScript } from "../bots/botScript.ts";

test("corporation hauling reads current divisions and dispatches an explicit guarded transfer", async () => {
  const store=createClientStore();
  const stationID=60000358, shipID=9988400023309;
  store.apply({ type:"character/online", character:{characterID:140000005,characterName:"Pilot",stationID,structureID:null,solarSystemID:30000144,corporationID:98000000},station:null });
  const requests:{path:string;body:Record<string,unknown>}[]=[];
  const fakeFetch=(async (input:unknown,init?:RequestInit) => {
    const path=String(input), body=typeof init?.body === "string" ? JSON.parse(init.body) : {};
    requests.push({path,body});
    let data:unknown={ok:true};
    if(path==="/api/bridge/flight/status") data=flightBody(true);
    if(path==="/api/bridge/fitting") data=fittingBody();
    if(path==="/api/names") data=namesBody(body);
    if(path==="/api/bridge/targets") data={ok:true,targetIDs:[]};
    if(path==="/api/bridge/ship/ore-hold") data=holdsBody(0,[]);
    if(path==="/api/bridge/inventory") data={ok:true,activeShipID:shipID,hangar:{list:[]},cargo:{list:[],capacity:{capacity:100,used:0}},volumes:{}};
    if(path.endsWith("/bays")) data={ok:true,shipID,bays:[{key:"cargo",label:"Cargo",present:true,items:[],capacity:{capacity:100,used:0},error:null}]};
    if(path==="/api/bridge/inventory/corp") data={ok:true,stationID,available:true,divisions:[{division:1,name:"Source",error:null,volumes:{34:1},list:{type:"list",items:[{type:"packedrow",fields:{itemID:100,typeID:34,groupID:18,categoryID:4,quantity:20,singleton:0}}]}}]};
    if(path==="/api/bridge/inventory/transfer") data={ok:true,applied:true,moved:[100],declined:[],notFound:[]};
    return {ok:true,status:200,json:async()=>data} as Response;
  }) as typeof fetch;
  const flow=createAppFlow(store,{fetch:fakeFetch});
  const script:BotScript={format:"evejs-bot-script",version:1,name:"corp",notes:"",home:{entity:"station",id:stationID,name:"Home",systemName:null},interrupts:[],program:[{id:"h",kind:"macro",macro:"haul-all",args:{pickupStation:{kind:"station",ref:{entity:"station",id:stationID,name:"A",systemName:null}},deliveryStation:{kind:"station",ref:{entity:"station",id:stationID+1,name:"B",systemName:null}},pickupCorpDivision:{kind:"corpDivision",division:1,name:null},deliveryCorpDivision:{kind:"corpDivision",division:2,name:null}}}]};
  try {
    await flow.startCustomBot(script);
    await new Promise(r=>setTimeout(r,150));
    assert.deepEqual(requests.find(r=>r.path==="/api/bridge/inventory/transfer")?.body,{itemIDs:[100],qty:20,from:{kind:"corp",division:1},to:{kind:"cargo"},haulContract:{stationID,typeID:34,sourceQuantity:20}});
  } finally { flow.stopCustomBot(); }
});
