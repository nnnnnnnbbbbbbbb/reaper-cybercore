// Reaper Nerv Printer dashboard bridge (Mineflayer)
// Install: npm i express socket.io mineflayer multer vec3
// Start: node reaper-nerv-printer.js
// Persistent state lives in printer-state.json.
// NOTE: this accepts a JSON block plan, not raw Nerv NBT/Litematica. Nerv's addon is a
// Meteor client mod; its NBT reader/movement workflow requires a separate port.
'use strict';
const fs=require('fs'),path=require('path'),express=require('express'),http=require('http'),multer=require('multer'),mineflayer=require('mineflayer');
const {Server}=require('socket.io'),{Vec3}=require('vec3');
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());
const upload=multer({dest:path.join(__dirname,'printer-projects'),limits:{fileSize:32*1024*1024}});
const PORT=Number(process.env.PORT||3001),STATE=path.join(__dirname,'printer-state.json');
const bot=mineflayer.createBot({host:process.env.MC_HOST||'8b8t.me',port:Number(process.env.MC_PORT||25565),username:process.env.MC_USERNAME||'deadly_boxer_1',auth:process.env.MC_AUTH||'offline',version:process.env.MC_VERSION||'1.21.11'});
let online=false,running=false,busy=false,chestStock={};
const fresh=()=>({projectName:'',plan:[],origin:{x:0,y:0,z:0},chest:null,cursor:0,completed:[],status:'empty',lastError:null,updatedAt:null});
let state=(()=>{try{return JSON.parse(fs.readFileSync(STATE,'utf8'))}catch{return fresh()}})();
const valid=p=>p&&['x','y','z'].every(k=>Number.isInteger(Number(p[k])));
const xyz=p=>({x:Number(p.x),y:Number(p.y),z:Number(p.z)});
const ready=()=>online&&bot.entity&&bot.game;
function pub(){return {projectName:state.projectName,count:state.plan.length,cursor:state.cursor,completed:state.completed.length,status:state.status,chest:state.chest,lastError:state.lastError,updatedAt:state.updatedAt}}
function save(){state.updatedAt=new Date().toISOString();let t=STATE+'.tmp';fs.writeFileSync(t,JSON.stringify(state,null,2));fs.renameSync(t,STATE);io.emit('projectState',pub())}
function log(message,type='info'){console.log(message);io.emit('log',{message,type})}
bot.on('spawn',()=>{online=true;io.emit('botStatus','Online');log('Bot spawned; saved project is ready.')});
bot.on('end',()=>{online=false;running=false;state.status='paused';save();io.emit('botStatus','Offline');log('Disconnected; progress saved.','warn')});
bot.on('error',e=>{state.lastError=e.message;log('Bot error: '+e.message,'error');save()});
bot.on('messagestr',m=>log('[Server] '+String(m)));
async function openChest(){if(!ready())throw Error('Bot is not connected');if(!valid(state.chest))throw Error('Save chest coordinates first');let b=bot.blockAt(xyz(state.chest));if(!b||!['chest','trapped_chest','barrel'].includes(b.name))throw Error('Chest/barrel not found at saved coordinates (ensure chunk is loaded)');return bot.openContainer(b)}
async function scan(){let c=await openChest();try{let stock={};for(const i of c.containerItems())stock[i.name]=(stock[i.name]||0)+i.count;chestStock=stock;state.chestStock=stock;save();log('Chest scanned: '+JSON.stringify(stock));return stock}finally{c.close()}}
async function take(name,count=1){let c=await openChest();try{let left=count;for(const i of c.containerItems()){if(i.name!==name||left<=0)continue;let n=Math.min(left,i.count);await c.withdraw(i.type,i.metadata,n);left-=n}if(left)throw Error('Chest short '+left+' '+name)}finally{c.close()}}
function inventoryItem(name){return bot.inventory.items().find(i=>i.name===name)}
async function equipMaterial(name){if(!inventoryItem(name))await take(name,1);let i=inventoryItem(name);if(!i)throw Error('Material missing: '+name);await bot.equip(i,'hand')}
async function place(entry){
 const target=xyz({x:state.origin.x+entry.x,y:state.origin.y+entry.y,z:state.origin.z+entry.z});
 const block=bot.registry.blocksByName[entry.block],item=bot.registry.itemsByName[entry.block];
 if(!block||!item)throw Error('Unknown/non-placeable block: '+entry.block);
 if(bot.blockAt(target)?.name===block.name)return;
 await equipMaterial(item.name);
 // Standard support-block placement. Requires a reachable, loaded, solid adjacent block.
 const neighbors=[new Vec3(0,-1,0),new Vec3(0,1,0),new Vec3(0,0,-1),new Vec3(0,0,1),new Vec3(-1,0,0),new Vec3(1,0,0)];
 for(const n of neighbors){const ref=bot.blockAt(target.plus(n));if(!ref||ref.boundingBox!=='block')continue;
   try{await bot.placeBlock(ref,n.scaled(-1));if(bot.blockAt(target)?.name===block.name)return}catch(e){log('Placement attempt: '+e.message,'warn')}
 }
 throw Error('Could not place '+entry.block+' at '+target);
}
async function loop(){if(busy)return;busy=true;try{while(running&&state.cursor<state.plan.length){await place(state.plan[state.cursor]);state.completed.push(state.cursor);state.cursor++;state.status='running';state.lastError=null;save();io.emit('progress',{cursor:state.cursor,total:state.plan.length});await new Promise(r=>setTimeout(r,Number(process.env.PLACE_DELAY_MS||150)))}if(state.cursor>=state.plan.length){running=false;state.status='completed';save();log('Printer finished.')}}catch(e){running=false;state.status='paused';state.lastError=e.message;save();log('Paused: '+e.message,'error')}finally{busy=false}}
app.get('/',(_,r)=>r.type('html').send(PAGE));app.get('/api/state',(_,r)=>r.json(pub()));
app.post('/api/project',upload.single('plan'),(req,res)=>{try{if(!req.file)throw Error('Upload a JSON plan');let d=JSON.parse(fs.readFileSync(req.file.path,'utf8')),p=Array.isArray(d)?d:d.blocks;if(!Array.isArray(p)||!p.every(b=>valid(b)&&typeof b.block==='string'))throw Error('Expected [{x,y,z,block},...]');state.plan=p;state.projectName=req.file.originalname;state.cursor=0;state.completed=[];state.status='ready';state.lastError=null;if(d.origin&&valid(d.origin))state.origin=xyz(d.origin);save();res.json(pub());log('Loaded '+p.length+' placements')}catch(e){res.status(400).json({error:e.message})}finally{if(req.file)fs.unlink(req.file.path,()=>{})}});
app.post('/api/settings',(req,res)=>{if(!valid(req.body.origin)||!valid(req.body.chest))return res.status(400).json({error:'Origin and chest require integer x,y,z'});state.origin=xyz(req.body.origin);state.chest=xyz(req.body.chest);save();res.json(pub())});
app.post('/api/scan',async(_,res)=>{try{res.json({stock:await scan()})}catch(e){res.status(400).json({error:e.message})}});
app.post('/api/start',async(_,res)=>{if(!ready())return res.status(400).json({error:'Bot not connected'});if(!state.plan.length)return res.status(400).json({error:'Load a plan first'});try{await scan();running=true;state.status='running';state.lastError=null;save();loop();res.json(pub())}catch(e){res.status(400).json({error:e.message})}});
app.post('/api/stop',(_,res)=>{running=false;state.status='paused';save();log('Stop requested; progress persisted.');res.json(pub())});
app.post('/api/new',(_,res)=>{running=false;state=fresh();save();res.json(pub())});
io.on('connection',s=>{s.emit('projectState',pub());s.emit('botStatus',ready()?'Online':'Connecting / offline')});
server.listen(PORT,()=>log('Printer panel at http://localhost:'+PORT));
const PAGE=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reaper Printer</title><style>
*{box-sizing:border-box}body{margin:0;padding:20px;background:#080e17;color:#e5edf8;font:14px system-ui}main{max-width:1000px;margin:auto}h1{color:#78b7ff}section{background:#111b29;border:1px solid #28384e;border-radius:12px;padding:16px;margin:14px 0}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}input{width:100%;padding:10px;background:#07101b;color:white;border:1px solid #33445b;border-radius:7px;margin:5px 0}button{padding:10px 14px;border:0;border-radius:7px;background:#77b7ff;font-weight:bold;margin:5px;cursor:pointer}.stop{background:#ff7777}#log{height:220px;overflow:auto;background:#05080d;padding:12px;border-radius:8px;font:12px/1.5 monospace;white-space:pre-wrap}.muted{color:#9aacc3}.bar{height:8px;background:#243349;border-radius:6px}.bar span{display:block;height:8px;background:#73d6a0;width:0}@media(max-width:600px){.grid{grid-template-columns:1fr}}</style></head><body><main><h1>⚙ REAPER / NERV PRINTER</h1><p id="online">Connecting…</p><section><h3>Saved project · resume after reopening</h3><p id="project">No project loaded</p><div class="bar"><span id="bar"></span></div><p id="stat" class="muted"></p><input id="file" type="file" accept=".json,application/json"><button onclick="upload()">Load JSON plan</button><button onclick="call('/api/start')">Start / Resume</button><button class="stop" onclick="call('/api/stop')">Stop & Save</button><button onclick="call('/api/new')">New project</button><p class="muted">Input plan: [{x:0,y:0,z:0,block:"stone"},…]. Nerv NBT files need conversion first; raw Litematica isn't supported here.</p></section><section><h3>Origin + chest coordinates</h3><div class="grid">${['ox','oy','oz','cx','cy','cz'].map((id,i)=>'<label>'+['Origin X','Origin Y','Origin Z','Chest X','Chest Y','Chest Z'][i]+'<input id="'+id+'" type="number" value="'+(i<3?0:'')+'"></label>').join('')}</div><button onclick="settings()">Save coordinates</button><button onclick="call('/api/scan')">Scan chest</button></section><section><h3>Console</h3><div id="log"></div></section></main><script src="/socket.io/socket.io.js"></script><script>
const s=io(),L=document.getElementById('log');function log(x){L.textContent+=x+'\\n';L.scrollTop=L.scrollHeight}s.on('log',e=>log('['+e.type+'] '+e.message));s.on('botStatus',x=>document.getElementById('online').textContent=x);s.on('projectState',v=>{document.getElementById('project').textContent=v.projectName||'No project';let p=v.count?Math.round(v.completed/v.count*100):0;document.getElementById('bar').style.width=p+'%';document.getElementById('stat').textContent=(v.completed||0)+' / '+(v.count||0)+' · '+v.status+' · saved '+(v.updatedAt||'—')});
async function call(u){let r=await fetch(u,{method:'POST'}),d=await r.json();log(d.error||u+' · '+(d.status||'OK'))}async function upload(){let f=document.getElementById('file').files[0];if(!f)return log('Choose a JSON plan');let d=new FormData();d.append('plan',f);let r=await fetch('/api/project',{method:'POST',body:d}),v=await r.json();log(v.error||'Loaded '+v.count+' blocks')}async function settings(){let n=id=>Number(document.getElementById(id).value),b={origin:{x:n('ox'),y:n('oy'),z:n('oz')},chest:{x:n('cx'),y:n('cy'),z:n('cz')}};let r=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}),v=await r.json();log(v.error||'Coordinates saved')}</script></body></html>`;
