// ================= CONFIGURATION =================
// Replace this placeholder locally. Do not commit a real password to a public repository.
const PASSWORD = 'YOUR_PASSWORD_HERE';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const config = {
  host: '8b8t.me',
  port: 25565,
  username: 'deadly_boxer',
  auth: 'offline',
  version: '1.21.11',
  fakeHost: '8b8t.me',
  physicsEnabled: true,
  checkTimeoutInterval: 120000,
  hideErrors: true
};

let bot;
let loginDispatched = false;
let isShiftingServers = false;
let isFullyLoaded = false;
let isRunningTask = false;
let abortFlag = false;
let reconnectTimer = null;
let stopping = false;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function uiLog(message, type = 'srv') {
  console.log(message);
  io.emit('botLog', { text: String(message), type });
}

app.get('/', (req, res) => {
  res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>8b8t Bot Minimal Console</title>
<style>
body{background:#0c0f12;color:#a5acb6;font-family:monospace;margin:20px}
h2{color:#52a3ff}.action-bar,#input-container{display:flex;gap:10px;margin:15px 0}
button{border:0;border-radius:4px;padding:12px 16px;font-weight:bold;cursor:pointer}
.action-btn{flex:1;color:white}.btn-put{background:#1a73e8}.btn-take{background:#0f9d58}.btn-stop{background:#db4437}
#console{background:#050709;border:1px solid #1a222d;padding:15px;height:400px;overflow-y:auto;border-radius:5px}
.log{margin:4px 0;line-height:1.4;overflow-wrap:anywhere}.sys{color:#f4b400}.srv{color:#a5acb6}.status{color:#0f9d58}.err{color:#db4437}
input{flex:1;min-width:0;background:#14191f;border:1px solid #2c384c;color:white;padding:12px;font:inherit}
#sendBtn{background:#52a3ff}
@media(max-width:600px){.action-bar,#input-container{flex-direction:column}}
</style>
</head>
<body>
<h2>🤖 8b8t Minimal Interface (deadly_boxer)</h2>
<p style="color:#6272a4">Control donkey storage or send chat/commands to the server.</p>
<div class="action-bar">
<button class="action-btn btn-put" onclick="sendAction('deposit')">Put Items In Donkey</button>
<button class="action-btn btn-take" onclick="sendAction('withdraw')">Take Items Out Donkey</button>
<button class="action-btn btn-stop" onclick="sendAction('forceStop')">FORCE STOP</button>
</div>
<div id="console"></div>
<div id="input-container">
<input id="cmdInput" placeholder="Send chat message or server command..." autocomplete="off">
<button id="sendBtn">Execute</button>
</div>
<script src="/socket.io/socket.io.js"></script>
<script>
const socket=io(), log=document.getElementById('console'), input=document.getElementById('cmdInput');
socket.on('botLog',data=>{const line=document.createElement('div');line.className='log '+data.type;line.textContent=data.text;log.appendChild(line);log.scrollTop=log.scrollHeight;});
function sendAction(action){socket.emit('botAction',action);}
function transmit(){const value=input.value.trim();if(!value)return;socket.emit('uiCommand',value);input.value='';}
document.getElementById('sendBtn').addEventListener('click',transmit);
input.addEventListener('keydown',e=>{if(e.key==='Enter')transmit();});
</script>
</body>
</html>`);
});

function getNearestDonkey() {
  if (!bot || !bot.entities || !bot.entity) return null;
  return bot.nearestEntity(entity => {
    const name = (entity.name || '').toLowerCase();
    return (name === 'donkey' || name === 'mule') &&
      entity.position.distanceTo(bot.entity.position) < 5;
  });
}

function findEmptySlot(window, start, end) {
  for (let i = start; i < end; i++) {
    if (!window.slots[i]) return i;
  }
  return null;
}

async function runDonkeyChestTask(mode) {
  if (!bot || !bot._client || bot._client.state !== 'play' ||
      isShiftingServers || !isFullyLoaded) {
    uiLog('[Donkey] Bot is not fully loaded in the main server.', 'err');
    return;
  }
  if (isRunningTask) {
    uiLog('[Donkey] A task is already running. Press FORCE STOP first.', 'err');
    return;
  }

  isRunningTask = true;
  abortFlag = false;
  let window;

  try {
    const donkey = getNearestDonkey();
    if (!donkey) throw new Error('No donkey or mule found within 5 blocks.');

    bot.clearControlStates();
    bot.setControlState('sneak', true);
    await sleep(150);
    if (abortFlag) return;

    await bot.lookAt(donkey.position.offset(0, donkey.height * 0.85, 0), true);
    await sleep(150);
    if (abortFlag) return;

    uiLog('[Donkey] Sneaking and interacting with nearest donkey...', 'sys');

    const windowPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        bot.removeListener('windowOpen', onOpen);
        reject(new Error('Timed out waiting for donkey inventory to open.'));
      }, 3500);
      function onOpen(win) {
        clearTimeout(timeout);
        resolve(win);
      }
      bot.once('windowOpen', onOpen);
    });

    bot.activateEntity(donkey);
    window = await windowPromise;
    await sleep(250);
    if (abortFlag) return;

    const chestStart = 2;
    const chestEnd = window.inventoryStart;

    if (mode === 'deposit') {
      uiLog('[Donkey] Depositing inventory items...', 'sys');
      const items = window.items().filter(item => item.slot >= window.inventoryStart);
      for (const item of items) {
        if (abortFlag) break;
        const slot = findEmptySlot(window, chestStart, chestEnd);
        if (slot === null) {
          uiLog('[Donkey] Donkey chest is full.', 'sys');
          break;
        }
        await bot.moveSlotItem(item.slot, slot);
        await sleep(180);
      }
      if (!abortFlag) uiLog('[Donkey] Deposit finished.', 'status');
    } else if (mode === 'withdraw') {
      uiLog('[Donkey] Withdrawing donkey chest items...', 'sys');
      const items = window.items().filter(item =>
        item.slot >= chestStart && item.slot < chestEnd
      );
      for (const item of items) {
        if (abortFlag) break;
        const slot = findEmptySlot(window, window.inventoryStart, window.slots.length);
        if (slot === null) {
          uiLog('[Donkey] Bot inventory is full.', 'sys');
          break;
        }
        await bot.moveSlotItem(item.slot, slot);
        await sleep(180);
      }
      if (!abortFlag) uiLog('[Donkey] Withdrawal finished.', 'status');
    }
  } catch (err) {
    uiLog('[Donkey Error] ' + err.message, 'err');
  } finally {
    if (window && bot && bot.currentWindow === window) {
      try { window.close(); } catch (_) {}
    }
    if (bot && typeof bot.setControlState === 'function') {
      bot.setControlState('sneak', false);
    }
    isRunningTask = false;
  }
}

function forceStopTasks() {
  abortFlag = true;
  if (bot && typeof bot.clearControlStates === 'function') bot.clearControlStates();
  if (bot && bot.currentWindow) {
    try { bot.closeWindow(bot.currentWindow); } catch (_) {}
  }
  uiLog('[FORCE STOP] Task cancellation requested; controls released.', 'err');
}

function createBotInstance() {
  stopping = false;
  loginDispatched = false;
  isShiftingServers = false;
  isFullyLoaded = false;
  isRunningTask = false;
  abortFlag = true;

  uiLog(`[System] Connecting to ${config.host} as ${config.username}...`, 'sys');
  bot = mineflayer.createBot(config);

  bot._client.on('state', (newState, oldState) => {
    uiLog(`[Protocol State] ${oldState} -> ${newState}`, 'sys');
    if (newState === 'configuration') {
      isShiftingServers = true;
      isFullyLoaded = false;
    }
    if (newState === 'play') {
      isShiftingServers = false;
      if (bot.entity && bot.entity.velocity) bot.entity.velocity.set(0, 0, 0);
      bot.clearControlStates();
    }
  });

  bot.on('messagestr', (message, position) => {
    if (position === 'game_info') return;
    const msg = message.trim();
    if (msg) uiLog('[Server] ' + msg, 'srv');

    if (msg.includes('Connecting to 8b8t')) {
      isShiftingServers = true;
      isFullyLoaded = false;
    }

    if (!isShiftingServers && !loginDispatched &&
        (msg.includes('/login') || msg.includes('session has been continued'))) {
      loginDispatched = true;
      uiLog('[Lobby] Login prompt detected.', 'sys');
      setTimeout(() => {
        if (bot && bot._client && bot._client.state === 'play' && !isShiftingServers) {
          if (!PASSWORD || PASSWORD === 'YOUR_PASSWORD_HERE') {
            uiLog('[Login] Set PASSWORD at the top of server-donkey.js first.', 'err');
            return;
          }
          bot.chat('/login ' + PASSWORD);
          uiLog('[Login] Login command sent.', 'sys');
        }
      }, 3500);
    }
  });

  bot.on('health', () => {
    if (isShiftingServers) return;
    if (!isFullyLoaded) {
      isFullyLoaded = true;
      uiLog(`[Status] Main server loaded. HP: ${bot.health} | Hunger: ${bot.food}`, 'status');
    }
  });

  bot.on('error', err => uiLog('[Error] ' + (err.message || err), 'err'));
  bot.on('kicked', reason => uiLog('[Kicked] ' + reason, 'err'));

  bot.on('end', reason => {
    uiLog('[Disconnect] ' + reason, 'err');
    forceStopTasks();
    if (stopping) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(createBotInstance, 15000);
  });
}

io.on('connection', socket => {
  socket.on('uiCommand', inputText => {
    if (typeof inputText !== 'string' || inputText.length > 256) return;
    if (bot && bot._client && bot._client.state === 'play' && !isShiftingServers) {
      bot.chat(inputText);
      uiLog('[Sent Chat] ' + inputText, 'sys');
    } else {
      uiLog('[Command] Bot is not ready.', 'err');
    }
  });

  socket.on('botAction', action => {
    if (action === 'deposit') runDonkeyChestTask('deposit');
    else if (action === 'withdraw') runDonkeyChestTask('withdraw');
    else if (action === 'forceStop') forceStopTasks();
  });
});

server.listen(PORT, () => {
  console.log(`[Web Server] http://localhost:${PORT}`);
  createBotInstance();
});
