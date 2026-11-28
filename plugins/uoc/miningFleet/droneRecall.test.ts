import test from "node:test";
import assert from "node:assert/strict";
import {assertFleetDroneDeparture,FleetDroneReturnIncomplete,readFleetDronePanel,recallFleetDrones} from "./droneRecall.ts";

const drone={itemID:7,typeID:101,controlled:true,activity:"mining"};
const row={itemID:7,typeID:101,quantity:-1};
function fixture(frames:{out:unknown[]|null;bay:unknown[];inSpaceError?:string}[],positions:number[]=[]){
  let time=0,read=0,position=0;
  const calls:string[]=[];
  const run={baseUrl:"http://fixture",fetch:async(url:Parameters<typeof fetch>[0])=>{
    if(String(url).endsWith("/space/snapshot")){
      const geometry=(x:number)=>({position:{x,y:0,z:0},radius:10});
      const x=positions[Math.min(position++,positions.length-1)];
      return Response.json({ok:true,space:x===undefined?null:{
        shipID:11,inSpace:true,stateValid:true,ship:geometry(0),
        entities:[{itemID:7,controllerID:11,kind:"drone",...geometry(x)}],
      }});
    }
    const {out,bay,inSpaceError}=frames[Math.min(read++,frames.length-1)]!;
    calls.push("read");
    return Response.json({ok:true,activeShipID:11,bay,inSpace:out,errors:{bay:null,inSpace:inSpaceError??null,shipInfo:null}});
  }};
  const session={flow:{requestOptions:()=>({}),flying:{bridgeDo:async(_service:string,method:string)=>{
    calls.push(method);return {type:"dict",entries:[]};
  }}}} as any;
  return {calls,session,panel:()=>readFleetDronePanel(run,session,11,()=>{}),recall:()=>recallFleetDrones(run,session,11,()=>{},
    {now:()=>time,wait:async ms=>{time+=ms;},timeoutMs:6000})};
}
test("fleet drone panel decodes controlled state, wrapped IDs, orders and shield",async()=>{
  const long=(value:number)=>({type:"long",value:String(value)});
  const f=fixture([{bay:[],out:[
    {...drone,itemID:long(7),typeID:long(101),targetID:long(23),shieldRatio:"0.6"},
    {itemID:8,controlled:false,activity:"",shieldRatio:null},
  ]}]);
  assert.deepEqual((await f.panel()).out,[
    {itemID:7,typeID:101,controlled:true,activity:"mining",targetID:23,shieldRatio:0.6},
    {itemID:8,typeID:null,controlled:false,activity:null,targetID:null,shieldRatio:null},
  ]);
});

test("fleet drone panel accepts an empty flight and rejects unavailable or ambiguous rows",async()=>{
  assert.deepEqual((await fixture([{bay:[],out:[]}]).panel()).out,[]);
  for(const frame of [{out:null},{out:[],inSpaceError:"READ_FAILED"},
    {out:[drone,{...drone,itemID:{type:"long",value:"7"}}]},{out:[{itemID:7}]}])
    await assert.rejects(fixture([{...frame,bay:[]}]).panel(),/observation is unavailable/);
});

test("eleven drones detached from former hulls do not require recall before departure",async()=>{
  const loose=Array.from({length:11},(_,i)=>({...drone,itemID:70+i,controlled:false,activity:null}));
  const f=fixture([{out:loose,bay:[]}]);
  assert.deepEqual(await f.recall(),{unrecovered:[],stillControlled:[],refusal:null});
  assert.equal(f.calls.includes("CmdReturnBay"),false);
});

test("return ACK and an empty grid still wait for the exact fresh bay row",async()=>{
  const f=fixture([{out:[drone],bay:[]},{out:[],bay:[]},{out:[],bay:[row]}]);
  assert.deepEqual(await f.recall(),{unrecovered:[],stillControlled:[],refusal:null});
  assert.equal(f.calls.filter(x=>x==="CmdReturnBay").length,1);
  assert.equal(f.calls.filter(x=>x==="InvalidateLocationCache").length,3);
});
test("absent drones are reported unrecovered and a still controlled drone blocks normal travel",async()=>{
  const disappeared=fixture([{out:[drone],bay:[]},{out:[],bay:[]}]);
  assert.match(assertFleetDroneDeparture(await disappeared.recall())??"",/not recovered.*7/);
  const stuck=fixture([{out:[drone],bay:[]}]);
  const result=await stuck.recall();
  assert.throws(()=>assertFleetDroneDeparture(result),/did not settle.*7/);
  assert.equal(stuck.calls.filter(x=>x==="CmdReturnBay").length,1);
});

test("native progress renews the no-progress window without another return order",async()=>{
  const frames=Array.from({length:11},()=>({out:[drone],bay:[]}));
  const f=fixture([...frames,{out:[],bay:[row]}],frames.map((_,i)=>20000-i*300));
  assert.deepEqual(await f.recall(),{unrecovered:[],stillControlled:[],refusal:null});
  assert.equal(f.calls.filter(x=>x==="CmdReturnBay").length,1);
});

test("F4 drone bay updates before the recall acknowledgment is lost",async()=>{
 const f=fixture([{out:[drone],bay:[]},{out:[],bay:[row]}]);
 const bridgeDo=f.session.flow.flying.bridgeDo;let delivered=false,writes=0;
 f.session.flow.flying.bridgeDo=async(service:string,method:string)=>{
  if(method!=="CmdReturnBay")return bridgeDo(service,method);
  writes++;delivered=true;
  await Promise.resolve();
  throw Object.assign(Error("Recall response was lost"),{code:"CALL_TIMEOUT"});
 };
 const result=await f.recall();
 assert.ok(delivered);assert.equal(writes,1);
 assert.deepEqual(result.unrecovered,[]);assert.deepEqual(result.stillControlled,[]);
 assert.equal(result.refusal,"Recall response was lost");
});

function beltFlight({onboard=7,droneCapacity=50,cargoUsed=0,returnAt=9000,includeReserved=false,moveReply="applied",droneOwner=1,
  beforeWrite=()=>{}}:{
  onboard?:number;droneCapacity?:number;cargoUsed?:number;returnAt?:number;includeReserved?:boolean;
  moveReply?:"applied"|"lost"|"unknown";droneOwner?:number;beforeWrite?:()=>void;
}={}){
  let time=0,repairAvailableAt=returnAt;
  const initial={itemID:50,typeID:101,quantity:onboard,categoryID:18,volume:5};
  const bay=[{...initial}];
  const cargo=cargoUsed?[{itemID:99,typeID:505,quantity:cargoUsed,categoryID:7,volume:1}]:[];
  const drones=Array.from({length:4},(_,i)=>({...drone,itemID:7+i}));
  drones.push({...drone,itemID:100,controlled:false});
  const orders:{method:string;ids:number[]}[]=[],moves:object[]=[],reads:string[]=[];
  const used=(items:typeof bay)=>items.reduce((sum,i)=>sum+(i.quantity===-1?1:i.quantity)*i.volume,0);
  const heldCount=()=>drones.filter(row=>row.controlled).length;
  const run={baseUrl:"http://fixture",fetch:async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
    const path=new URL(String(input)).pathname;
    reads.push(path);
    const ok=(value:object)=>Response.json({ok:true,...value});
    switch(path){
      case "/api/bridge/drones":
        return ok({activeShipID:11,bay,inSpace:drones,errors:{bay:null,inSpace:null,shipInfo:null}});
      case "/api/bridge/space/snapshot":
        return ok({space:{
          inSpace:true,shipID:11,solarSystemID:300,
          ship:{itemID:11,characterID:1,position:{x:0,y:0,z:0},radius:10},
          entities:drones.map(row=>({...row,kind:"drone",ownerID:droneOwner,controllerID:row.controlled?11:null,
            position:{x:2300,y:0,z:0},radius:1})),
        }});
      case "/api/bridge/flight/status":
        return ok({flight:{shipID:11,inSpace:true,docked:false,solarSystemID:300,shipMode:"STOP",transition:{phase:"ready"}}});
      case "/api/bridge/ship/11/bays":
        return ok({shipID:11,activeShipID:11,bays:[
          {key:"drone",present:true,error:null,items:bay,capacity:{capacity:droneCapacity,used:used(bay)+(includeReserved?5*heldCount():0)}},
          {key:"cargo",present:true,error:null,items:cargo,capacity:{capacity:100,used:used(cargo)}},
        ]});
      case "/api/types/volumes":
        return ok({volumes:{101:5}});
      case "/api/bridge/inventory/transfer":{
        const move=JSON.parse(String(init?.body));
        assert.deepEqual(move,{
          itemIDs:[50],qty:1,from:{kind:"shipBay",bay:"drone"},to:{kind:"cargo"},expectedScope:{shipID:11,solarSystemID:300},
        });
        moves.push(move);
        if(moveReply==="unknown")throw Error("Inventory transport timeout");
        bay[0]!.quantity-=move.qty;
        cargo.push({...initial,itemID:250,quantity:move.qty});
        if(moveReply==="lost")throw Error("Inventory reply lost after the item moved");
        return ok({applied:true});
      }
      default:throw Error("Unexpected fixture path "+path);
    }
  }};
  const session={flow:{requestOptions:()=>({}),flying:{bridgeDo:async(_service:string,method:string,args:[number[]])=>{
    if(method!=="InvalidateLocationCache"){
      assert.ok(method==="CmdReturnBay"||method==="CmdAbandonDrone");
      orders.push({method,ids:args[0]});
      for(const id of args[0]){
        const row=drones.find(drone=>drone.itemID===id);
        assert.ok(row?.controlled,"only the current ship's controlled drones accept orders");
        if(method==="CmdReturnBay")row.activity="returning";
        else{row.controlled=false;row.activity="idle";}
      }
    }
    return {type:"dict",entries:[]};
  }}}} as any;
  return {orders,moves,reads,bay,cargo,drones,used:()=>used(bay),makeReturnAvailable:()=>{repairAvailableAt=time;},
    recall:()=>recallFleetDrones(run,session,11,()=>{},{
      now:()=>time,timeoutMs:6000,beltRecovery:{characterID:1,systemID:300,beforeWrite},
      wait:async ms=>{
        time+=ms;
        // EveJS requires room for the entire flight, including reservations
        // for drones still outside after this tick.
        if(time<repairAvailableAt||used(bay)+5*heldCount()>droneCapacity)return;
        for(const [index,row] of [...drones.entries()].reverse()){
          if(!row.controlled||row.activity!=="returning")continue;
          bay.push({...initial,itemID:row.itemID,quantity:-1});
          drones.splice(index,1);
        }
      },
    }),
  };
}

test("35/50 m³ plus four Acolytes moves one onboard drone to cargo and recalls all four",async()=>{
  for(const includeReserved of [false,true]){
    const f=beltFlight({includeReserved,moveReply:includeReserved?"lost":"applied"});
    assert.deepEqual(await f.recall(),{unrecovered:[],stillControlled:[],refusal:null});
    assert.equal(f.moves.length,1);
    assert.deepEqual(f.orders,[{method:"CmdReturnBay",ids:[7,8,9,10]}]);
    assert.equal(f.cargo[0]?.quantity,1);
    assert.equal(f.used(),50);
    assert.deepEqual(f.bay.map(d=>d.itemID).sort((a,b)=>a-b),[7,8,9,10,50]);
    assert.deepEqual(f.drones.map(d=>d.itemID),[100]);
  }
});

test("35/50 m³ with no cargo room releases only the required drone and recalls the other three",async()=>{
  const f=beltFlight({cargoUsed:100});
  const result=await f.recall();
  assert.deepEqual(result,{unrecovered:[7],stillControlled:[],refusal:null});
  assert.deepEqual(f.orders,[{method:"CmdReturnBay",ids:[7,8,9,10]},{method:"CmdAbandonDrone",ids:[7]}]);
  assert.equal(f.moves.length,0);
  assert.equal(f.used(),50);
});

test("a slow ordinary recall with enough room leaves the flight intact and settles on the next observation",async()=>{
  const f=beltFlight({onboard:6,cargoUsed:100});
  const first=await f.recall();
  assert.throws(()=>assertFleetDroneDeparture(first),FleetDroneReturnIncomplete);
  f.makeReturnAvailable();
  assert.deepEqual(await f.recall(),{unrecovered:[],stillControlled:[],refusal:null});
  assert.deepEqual(f.orders,[{method:"CmdReturnBay",ids:[7,8,9,10]}]);
  assert.equal(f.moves.length,0);
  assert.equal(f.used(),50);
});

test("a modded Drone Bay with effective capacity above the hull baseline keeps every returning drone", async () => {
  const f = beltFlight({ droneCapacity: 75, cargoUsed: 100, includeReserved: true });
  const first = await f.recall();
  assert.throws(() => assertFleetDroneDeparture(first), FleetDroneReturnIncomplete);
  f.makeReturnAvailable();
  assert.deepEqual(await f.recall(), { unrecovered: [], stillControlled: [], refusal: null });
  assert.equal(f.used(), 55);
  assert.equal(f.moves.length, 0);
  assert.deepEqual(f.orders, [{ method: "CmdReturnBay", ids: [7, 8, 9, 10] }]);
});

test("an unverified cargo move cannot cause a drone to be released",async()=>{
  const f=beltFlight({moveReply:"unknown"});
  const result=await f.recall();
  assert.match(result.refusal??"",/not confirmed/);
  assert.deepEqual(result.stillControlled,[7,8,9,10]);
  assert.equal(f.moves.length,1);
  assert.deepEqual(f.orders,[{method:"CmdReturnBay",ids:[7,8,9,10]}]);
});

test("a controller match without current ownership cannot authorize abandonment",async()=>{
  const f=beltFlight({cargoUsed:100,droneOwner:2});
  const result=await f.recall();
  assert.match(result.refusal??"",/could not be verified/);
  assert.equal(f.orders.some(order=>order.method==="CmdAbandonDrone"),false);
  assert.equal(f.moves.length,0);
});

test("Stop during the overflow check cancels recovery writes",async()=>{
  const f=beltFlight({beforeWrite:()=>{throw Error("Run no longer relocating");}});
  await assert.rejects(f.recall(),/Run no longer relocating/);
  assert.equal(f.moves.length,0);
  assert.deepEqual(f.orders,[{method:"CmdReturnBay",ids:[7,8,9,10]}]);
});
