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
:root{--bg:#0a0d12;--panel:#111622;--input:#171e2e;--border:#243146;--text:#c9d1d9;--muted:#6e7681;--blue:#388bfd;--green:#34d058;--red:#ea4aaa;--yellow:#e3b341}
*{box-sizing:border-box}body{margin:0;padding:24px;background:radial-gradient(ellipse at top left,#14233b 0%,#0a0d12 48%,#080a0f 100%);color:var(--text);font:14px system-ui,-apple-system,"Segoe UI",sans-serif;min-height:100vh;height:100vh;display:flex;flex-direction:column}
.header{display:flex;justify-content:space-between;align-items:center;gap:15px;flex-wrap:wrap;padding:0 0 18px;border-bottom:1px solid #26354b;margin-bottom:22px}
h2{margin:0;color:#72aaff;font-weight:750;letter-spacing:.7px;text-shadow:0 0 24px #388bfd35}.telemetry{display:flex;gap:16px;background:#0b111cdd;padding:12px 17px;border-radius:12px;border:1px solid #2a3b54;font:13px monospace;box-shadow:0 8px 24px #0003}.telemetry span{color:white;font-weight:bold}
.status-badge{padding:4px 8px;border-radius:12px;font-size:12px;font-weight:bold;text-transform:uppercase;border:1px solid transparent}
.status-disconnected{color:var(--red);background:#ea4aaa19;border-color:#ea4aaa33}.status-connecting{color:var(--yellow);background:#e3b34119;border-color:#e3b34133}.status-lobby{color:var(--blue);background:#388bfd19;border-color:#388bfd33}.status-online{color:var(--green);background:#34d05819;border-color:#34d05833}
.control{display:flex;align-items:center;justify-content:space-between;gap:16px;background:linear-gradient(135deg,#131b2a,#0e1420);border:1px solid #2a3a51;padding:18px;border-radius:14px;margin-bottom:22px;min-height:78px;box-shadow:0 12px 30px #0003}
.fields{display:flex;gap:15px;flex:1}.group{display:flex;flex-direction:column;gap:5px;flex:1;max-width:300px}.group label{font-size:11px;text-transform:uppercase;color:var(--muted);font-weight:bold;letter-spacing:.5px}
input{min-width:0;background:#0b111c;border:1px solid #2a3a51;color:white;padding:11px 12px;font:inherit;border-radius:8px;outline:none;transition:border-color .18s,box-shadow .18s}input:focus{border-color:var(--blue);box-shadow:0 0 0 3px #388bfd20}
.profile{display:flex;align-items:center;gap:12px;font-size:15px}.avatar{background:linear-gradient(135deg,#72aaff,#388bfd);color:#07101e;width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-weight:800;box-shadow:0 0 22px #388bfd35}
.actions{display:flex;gap:10px}.btn{font:inherit;font-weight:750;cursor:pointer;border-radius:9px;font-size:14px;padding:10px 20px;border:0;height:40px;transition:transform .15s,filter .15s}.btn:hover:not(:disabled){filter:brightness(1.08);transform:translateY(-1px)}.start{background:linear-gradient(135deg,#51e58a,#2fc96c);color:#07130b;box-shadow:0 5px 18px #34d05820}.stop{background:linear-gradient(135deg,#ff648e,#df3b69);color:white}.btn:disabled{opacity:.45;cursor:not-allowed}
.main{display:flex;flex-direction:column;flex:1;min-height:0}#console{background:#070a10e8;border:1px solid #26354b;padding:17px;flex:1;overflow-y:auto;border-radius:12px 12px 0 0;font:13px/1.6 monospace;box-shadow:inset 0 2px 12px #0008}.log{margin:3px 0;white-space:pre-wrap;overflow-wrap:anywhere}.sys{color:var(--yellow)}.srv{color:#8b949e}.status{color:var(--green);font-weight:bold}.err{color:var(--red);font-weight:bold}.sent{color:#58a6ff;font-style:italic}
.chat{display:flex;gap:10px;background:#111827;border:1px solid #26354b;border-top:0;padding:12px;border-radius:0 0 12px 12px}.chat input{flex:1}
@media(max-width:650px){body{padding:12px}.control{align-items:stretch;flex-direction:column}.fields{flex-direction:column}.group{max-width:none}.actions button{flex:1}.telemetry{flex-wrap:wrap;gap:10px}.header{align-items:flex-start}}
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
    <div class="group"><label for="botPass">Bot Password</label><input id="botPass" name="panel_mc_pass_2026" type="password" placeholder="Enter password" value="" autocomplete="new-password" readonly onfocus="this.removeAttribute('readonly')"></div>
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
function logLine(data){const el=document.createElement('div');el.className='log '+(data.type||'srv');el.textContent=data.text;consoleDiv.appendChild(el);consoleDiv.scrollTop=consoleDiv.scrollHeight}
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
  bot.on('kicked', reason => uiLog(`[Kicked] ${String(reason)}`, 'err'));

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