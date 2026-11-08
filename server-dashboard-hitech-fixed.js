const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = Number(process.env.PORT) || 3000;

const SERVER_HOST = '8b8t.me';
const SERVER_PORT = 25565;
const MC_VERSION = '1.21.11';

let bot = null;
let botStatus = 'disconnected';
let botConfig = { username: '', password: '' };
let manuallyStopped = true;
let loginDispatched = false;
let isShiftingServers = false;
let isFullyLoaded = false;
let reconnectTimeout = null;
let telemetryInterval = null;

app.get('/', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Deadly Control Panel</title>
<style>
:root{color-scheme:dark;--bg:#070b13;--panel:#0e1624;--panel2:#111d30;--line:#243650;--text:#e4edf8;--muted:#8193ad;--cyan:#45d9ff;--blue:#6487ff;--green:#54f0a1;--red:#ff5e83;--amber:#ffc76a}
*{box-sizing:border-box}body{margin:0;padding:26px;background:radial-gradient(ellipse at 12% 0%,#132c48 0,transparent 35%),radial-gradient(ellipse at 90% 15%,#191b42 0,transparent 32%),var(--bg);color:var(--text);font:14px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;min-height:100vh;display:flex;flex-direction:column;gap:20px}
.header{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:4px 0 20px;border-bottom:1px solid #263b55}.brand{display:flex;align-items:center;gap:14px}.brandmark{display:grid;place-items:center;width:46px;height:46px;border:1px solid #3d9dbb;background:linear-gradient(145deg,#12334a,#111c31);border-radius:14px;color:var(--cyan);font-size:22px;box-shadow:0 0 28px #45d9ff18}.brand h1{font-size:18px;letter-spacing:2px;margin:0;font-weight:850}.brand p{margin:5px 0 0;color:var(--muted);font:11px/1.3 ui-monospace,monospace;letter-spacing:1.4px}.header-right{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.status-wrap{color:var(--muted);font-size:12px;letter-spacing:.7px}.status-badge{display:inline-flex;align-items:center;gap:7px;padding:6px 10px;border-radius:999px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;border:1px solid transparent}.status-badge:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;box-shadow:0 0 9px currentColor}.status-disconnected{color:var(--red);background:#ff5e8310;border-color:#ff5e8330}.status-connecting{color:var(--amber);background:#ffc76a10;border-color:#ffc76a30}.status-lobby{color:var(--cyan);background:#45d9ff10;border-color:#45d9ff30}.status-online{color:var(--green);background:#54f0a110;border-color:#54f0a130}
.dashboard{display:grid;grid-template-columns:minmax(280px,350px) minmax(0,1fr);gap:20px;flex:1;min-height:0}.panel{background:linear-gradient(155deg,#111c2cdd,#0b1220f2);border:1px solid var(--line);border-radius:17px;box-shadow:0 18px 45px #0003;overflow:hidden}.panel-head{display:flex;align-items:center;justify-content:space-between;padding:17px 19px;border-bottom:1px solid #22334a}.panel-title{font-size:12px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase}.eyebrow{color:var(--muted);font:10px ui-monospace,monospace;letter-spacing:1.2px}.account-panel{display:flex;flex-direction:column}.account-body{padding:19px;display:flex;flex-direction:column;gap:17px}.fields{display:flex;flex-direction:column;gap:14px}.group{display:flex;flex-direction:column;gap:7px}.group label{font-size:10px;text-transform:uppercase;color:var(--muted);font-weight:800;letter-spacing:1.2px}input{width:100%;min-width:0;background:#070d17;border:1px solid #2a3d57;color:#f3f8ff;padding:12px 13px;font:13px ui-monospace,monospace;border-radius:10px;outline:none;transition:border-color .18s,box-shadow .18s}input:focus{border-color:var(--cyan);box-shadow:0 0 0 3px #45d9ff14}.profile{align-items:center;gap:12px;font-size:13px}.avatar{display:grid;place-items:center;background:linear-gradient(135deg,var(--cyan),var(--blue));color:#06101d;width:42px;height:42px;border-radius:13px;font-weight:900;box-shadow:0 0 24px #45d9ff24}.profile strong{color:var(--cyan)!important;overflow-wrap:anywhere}.actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}.btn{font:inherit;font-weight:800;cursor:pointer;border-radius:10px;font-size:12px;letter-spacing:.5px;padding:11px 15px;border:1px solid transparent;min-height:42px;transition:transform .15s,filter .15s}.btn:hover:not(:disabled){filter:brightness(1.1);transform:translateY(-1px)}.start{background:linear-gradient(135deg,#4ceba0,#1cbf86);color:#04150e;box-shadow:0 7px 20px #22d99416}.stop{background:#351a2a;border-color:#a63c61;color:#ff91ad}.btn:disabled{opacity:.4;cursor:not-allowed}.note{color:var(--muted);font-size:11px;line-height:1.6;border-top:1px solid #22334a;padding-top:14px}.right-stack{display:flex;flex-direction:column;gap:18px;min-height:0}.telemetry{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;background:transparent;padding:0;border:0;box-shadow:none;font:inherit}.metric{background:linear-gradient(145deg,#111e30,#0b1320);border:1px solid var(--line);border-radius:15px;padding:15px 17px;min-width:0}.metric-label{color:var(--muted);font-size:10px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase}.metric-value{margin-top:8px;font:700 21px ui-monospace,monospace;color:#f3f8ff;overflow-wrap:anywhere}.metric-value small{font-size:12px;color:var(--muted);font-weight:500}.main{display:flex;flex-direction:column;flex:1;min-height:280px}.console-head{display:flex;align-items:center;justify-content:space-between;background:#101a2a;border:1px solid var(--line);border-bottom:0;border-radius:15px 15px 0 0;padding:12px 16px}.console-label{display:flex;align-items:center;gap:10px;font-size:11px;font-weight:800;letter-spacing:1.2px}.window-dots{display:flex;gap:5px}.window-dots i{width:7px;height:7px;border-radius:50%;background:#42536c}.window-dots i:first-child{background:#ff6687}.window-dots i:nth-child(2){background:#ffc76a}.window-dots i:nth-child(3){background:#54f0a1}.console-meta{font:10px ui-monospace,monospace;color:var(--muted)}#console{background:#050910eF;border:1px solid var(--line);padding:17px;flex:1;overflow-y:auto;font:12px/1.7 ui-monospace,SFMono-Regular,monospace;box-shadow:inset 0 2px 15px #0008;min-height:200px}.log{margin:3px 0;white-space:pre-wrap;overflow-wrap:anywhere}.sys{color:var(--amber)}.srv{color:#9aabc2}.status{color:var(--green);font-weight:bold}.err{color:var(--red);font-weight:bold}.sent{color:var(--cyan);font-style:italic}.chat{display:flex;gap:10px;background:#101a2a;border:1px solid var(--line);border-top:0;padding:12px;border-radius:0 0 15px 15px}.chat input{flex:1}.chat .btn{min-width:82px}
@media(max-width:800px){body{padding:15px}.dashboard{grid-template-columns:1fr}.right-stack{min-height:430px}.account-body{gap:14px}.header{align-items:flex-start}.brand h1{font-size:15px}.telemetry{gap:8px}.metric{padding:12px}.metric-value{font-size:17px}}
@media(max-width:480px){.header{flex-direction:column}.header-right{width:100%;justify-content:space-between}.telemetry{grid-template-columns:1fr 1fr}.metric:last-child{grid-column:span 2}.actions{grid-template-columns:1fr 1fr}}

/* Viewport-lock + console-only scrolling fix */
body{height:100vh;height:100dvh;min-height:0;overflow:hidden;gap:14px}
.header{flex:0 0 auto;margin:0}
.control{flex:0 0 auto;min-height:0}
.main{flex:1 1 auto;min-height:0;height:0;overflow:hidden}
#console{flex:1 1 auto;min-height:0;height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}
.chat{flex:0 0 auto;min-width:0}
.chat input{min-width:0}
@media(max-width:650px){body{padding:12px;gap:10px}.header{flex-wrap:wrap}.control{padding:12px}.fields{min-width:0}.actions{flex-shrink:0}.main{min-height:0;height:0}}
</style>
</head>
<body>
<header class="header">
  <div><h2>⚡ DEADLY CONTROL PANEL (8b8t.me)</h2><div style="margin-top:6px">Status: <span id="statusLabel" class="status-badge status-disconnected">disconnected</span></div></div>
  <div class="telemetry"><div>HP: <span id="valHP">--</span></div><div>Food: <span id="valFood">--</span></div><div>XYZ: <span id="valXYZ">--, --, --</span></div></div>
</header>
<section class="control">
  <div id="credentialConfigArea" class="fields">
    <div class="group"><label for="botUser">Bot Username</label><input id="botUser" name="panel_mc_user_2026" type="text" placeholder="Enter username" value="" autocomplete="off" autocapitalize="off" spellcheck="false" readonly onfocus="this.removeAttribute('readonly')"></div>
    <div class="group"><label for="botPass">Bot Password</label><input id="botPass" name="panel_mc_pass_2026" type="text" placeholder="Enter password" value="" autocomplete="off" readonly onfocus="this.removeAttribute('readonly')"></div>
  </div>
  <div id="activeProfileDisplay" class="profile" style="display:none">
    <div id="profileLetter" class="avatar">D</div><div>Active Bot Account: <strong id="profileNameString" style="color:var(--blue)"></strong></div>
  </div>
  <div class="actions"><button id="startBtn" class="btn start">Start Bot</button><button id="stopBtn" class="btn stop" style="display:none">Stop Bot</button></div>
</section>
<main class="main"><div id="console"></div><div class="chat"><input id="cmdInput" placeholder="Send chat message or command..." autocomplete="off" disabled><button id="sendBtn" class="btn start" disabled>Send</button></div></main>
<script src="/socket.io/socket.io.js"></script>
<script>
const socket=io();
const $=id=>document.getElementById(id);
const consoleDiv=$('console'),botUser=$('botUser'),botPass=$('botPass'),startBtn=$('startBtn'),stopBtn=$('stopBtn'),cmdInput=$('cmdInput'),sendBtn=$('sendBtn');
function logLine(data){const el=document.createElement('div');el.className='log '+(data.type||'srv');if(Array.isArray(data.segments)){for(const part of data.segments){const span=document.createElement('span');span.className=part.type||'srv';span.textContent=part.text;el.appendChild(span)}}else{el.textContent=data.text}consoleDiv.appendChild(el);consoleDiv.scrollTop=consoleDiv.scrollHeight}
socket.on('botLog',logLine);
socket.on('statusShift',(status,activeUser)=>{
  $('statusLabel').className='status-badge status-'+status;
  $('statusLabel').textContent=status;
  const disconnected=status==='disconnected';
  $('credentialConfigArea').style.display=disconnected?'flex':'none';
  $('activeProfileDisplay').style.display=disconnected?'none':'flex';
  startBtn.style.display=disconnected?'inline-block':'none';
  stopBtn.style.display=disconnected?'none':'inline-block';
  const active=status==='online'||status==='lobby';
  cmdInput.disabled=!active;sendBtn.disabled=!active;
  if(disconnected){$('valHP').textContent='--';$('valFood').textContent='--';$('valXYZ').textContent='--, --, --'}
  if(activeUser){$('profileNameString').textContent=activeUser;$('profileLetter').textContent=activeUser.charAt(0).toUpperCase()}
});
socket.on('telemetry',data=>{$('valHP').textContent=data.health;$('valFood').textContent=data.food;$('valXYZ').textContent=data.x+', '+data.y+', '+data.z;$('valHP').style.color=Number(data.health)<10?'var(--red)':'white'});
startBtn.addEventListener('click',()=>{const username=botUser.value.trim(),password=botPass.value;if(!username||!password){alert('Username and password are required.');return}socket.emit('startBot',{username,password})});
stopBtn.addEventListener('click',()=>socket.emit('stopBot'));
function transmit(){const message=cmdInput.value.trim();if(!message)return;socket.emit('uiCommand',message);cmdInput.value=''}
sendBtn.addEventListener('click',transmit);cmdInput.addEventListener('keydown',e=>{if(e.key==='Enter')transmit()});
</script>
</body></html>`);
});

function flattenChatComponent(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(flattenChatComponent).join('');
  if (typeof value === 'object') {
    let result = typeof value.text === 'string' ? value.text : '';
    if (Array.isArray(value.extra)) result += value.extra.map(flattenChatComponent).join('');
    if (Array.isArray(value.with)) result += value.with.map(flattenChatComponent).join('');
    return result;
  }
  return '';
}

function uiLog(text, type = 'srv') {
  console.log(text);
  io.emit('botLog', { text, type });
}

function updateStatus(status) {
  botStatus = status;
  io.emit('statusShift', status, botConfig.username);
}

function sendTelemetryUpdate() {
  if (!bot) return;
  const health = Number.isFinite(bot.health) ? bot.health.toFixed(1) : 'Unknown';
  const food = Number.isFinite(bot.food) ? bot.food : 'Unknown';
  let x = '0', y = '0', z = '0';
  if (bot.entity?.position) {
    x = bot.entity.position.x.toFixed(1);
    y = bot.entity.position.y.toFixed(1);
    z = bot.entity.position.z.toFixed(1);
  }
  io.emit('telemetry', { health, food, x, y, z });
}

function clearTimers() {
  if (telemetryInterval) clearInterval(telemetryInterval);
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  telemetryInterval = null;
  reconnectTimeout = null;
}

function killBotInstance() {
  clearTimers();
  const oldBot = bot;
  bot = null;
  loginDispatched = false;
  isShiftingServers = false;
  isFullyLoaded = false;
  if (oldBot) {
    try { oldBot.quit(); } catch (_) {}
    try { oldBot.removeAllListeners(); } catch (_) {}
  }
  updateStatus('disconnected');
}

function launchBotInstance() {
  if (bot || manuallyStopped || !botConfig.username) return;

  loginDispatched = false;
  isShiftingServers = false;
  isFullyLoaded = false;
  updateStatus('connecting');
  uiLog(`[System] Connecting to ${SERVER_HOST} as ${botConfig.username}...`, 'sys');

  bot = mineflayer.createBot({
    host: SERVER_HOST,
    port: SERVER_PORT,
    username: botConfig.username,
    auth: 'offline',
    version: MC_VERSION,
    fakeHost: SERVER_HOST,
    physicsEnabled: true,
    checkTimeoutInterval: 120000,
    hideErrors: true
  });

  telemetryInterval = setInterval(sendTelemetryUpdate, 500);

  bot._client.on('state', (newState, oldState) => {
    uiLog(`[Protocol State] ${oldState} -> ${newState}`, 'sys');
    if (newState === 'configuration') {
      isShiftingServers = true;
      isFullyLoaded = false;
      updateStatus('connecting');
    }
    if (newState === 'play') {
      isShiftingServers = false;
      if (bot?.entity?.velocity) bot.entity.velocity.set(0, 0, 0);
      bot?.clearControlStates?.();
    }
  });

  bot.on('messagestr', (message, messagePosition) => {
    if (messagePosition === 'game_info') return;
    const cleanMsg = String(message).trim();
    if (cleanMsg) uiLog(`[Server] ${cleanMsg}`, 'srv');

    if (cleanMsg.includes('Connecting to 8b8t')) {
      isShiftingServers = true;
      isFullyLoaded = false;
      updateStatus('connecting');
    }

    if (!isShiftingServers && !loginDispatched &&
        (cleanMsg.toLowerCase().includes('/login') ||
         cleanMsg.toLowerCase().includes('session has been continued'))) {
      loginDispatched = true;
      updateStatus('lobby');
      uiLog('[Lobby] Login prompt detected; sending authentication.', 'sys');

      setTimeout(() => {
        if (bot && bot._client?.state === 'play' && !isShiftingServers && !manuallyStopped) {
          bot.chat(`/login ${botConfig.password}`);
          uiLog('[Lobby] Login command sent.', 'sys');
        }
      }, 3500);
    }
  });

  bot.on('health', () => {
    if (isShiftingServers) return;
    if (!isFullyLoaded) {
      isFullyLoaded = true;
      updateStatus('online');
      uiLog(`[Status] Connected. HP: ${bot.health} | Food: ${bot.food}`, 'status');
    }
    sendTelemetryUpdate();
  });

  bot.on('error', err => uiLog(`[Error] ${err.message || err}`, 'err'));
  bot.on('kicked', reason => {
    // Preserve the server's chat-component colors, so only the actual red
    // error text is red; prefixes and other formatting stay neutral.
    function getColoredSegments(component, inheritedType = 'srv') {
      if (component == null) return [];
      if (Array.isArray(component)) {
        return component.flatMap(item => getColoredSegments(item, inheritedType));
      }
      if (typeof component === 'string' || typeof component === 'number') {
        return [{ text: String(component), type: inheritedType }];
      }
      if (typeof component !== 'object') return [];

      const type = component.color === 'red' ? 'err' : inheritedType;
      const segments = [];
      if (typeof component.text === 'string' && component.text) {
        segments.push({ text: component.text, type });
      }
      if (Array.isArray(component.extra)) {
        segments.push(...component.extra.flatMap(item => getColoredSegments(item, type)));
      }
      if (Array.isArray(component.with)) {
        segments.push(...component.with.flatMap(item => getColoredSegments(item, type)));
      }
      return segments;
    }

    const reasonSegments = getColoredSegments(reason);
    const segments = [{ text: '[Kicked] ', type: 'srv' }, ...reasonSegments];
    const plainText = segments.map(part => part.text).join('') ||
      '[Kicked] The server disconnected the bot.';
    console.log(plainText);
    io.emit('botLog', { text: plainText, segments });
  });

  bot.on('end', reason => {
    uiLog(`[Disconnect] Connection ended: ${String(reason || '')}`, 'err');
    clearTimers();
    bot = null;
    loginDispatched = false;
    isShiftingServers = false;
    isFullyLoaded = false;

    if (!manuallyStopped && botConfig.username) {
      updateStatus('connecting');
      uiLog('[System] Reconnecting in 15 seconds...', 'sys');
      reconnectTimeout = setTimeout(launchBotInstance, 15000);
    } else {
      updateStatus('disconnected');
    }
  });
}

io.on('connection', socket => {
  socket.emit('statusShift', botStatus, botConfig.username);
  if (bot) sendTelemetryUpdate();

  socket.on('startBot', data => {
    if (bot || botStatus === 'connecting') return;
    const username = String(data?.username || '').trim();
    const password = String(data?.password || '');
    if (!username || !password) return;
    botConfig = { username, password };
    manuallyStopped = false;
    launchBotInstance();
  });

  socket.on('stopBot', () => {
    manuallyStopped = true;
    uiLog('[System] Stop requested; shutting down bot.', 'err');
    botConfig.password = '';
    killBotInstance();
  });

  socket.on('uiCommand', inputText => {
    const message = String(inputText || '').trim();
    if (!message || !bot || bot._client?.state !== 'play' || isShiftingServers) return;
    try {
      bot.chat(message);
      uiLog(`[Sent Chat] ${message}`, 'sent');
    } catch (err) {
      uiLog(`[System Error] ${err.message}`, 'err');
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Deadly panel running at http://localhost:${PORT}`);
  console.log('Panel bound to localhost only; do not expose it publicly without authentication.');
});