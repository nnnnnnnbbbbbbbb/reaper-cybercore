// 8b8t Minecraft + Discord bridge with dashboard Start/Stop controls.
// Secrets are read from environment variables; never commit tokens/passwords.
'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const { Client, GatewayIntentBits } = require('discord.js');

const MC_CONFIG = {
  host: '8b8t.me',
  port: 25565,
  username: 'ReaperChatBridge',
  auth: 'offline',
  version: '1.21.11',
  fakeHost: '8b8t.me',
  physicsEnabled: true,
  checkTimeoutInterval: 120000,
  hideErrors: true
};
const DISCORD_TOKEN = process.env.DISCORD_TOKEN || '';
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || '1571095467411120179';
const MC_PASSWORD = process.env.MC_PASSWORD || '';
const PORT = Number(process.env.PORT) || 3000;
const RECONNECT_MIN = 15000;
const RECONNECT_MAX = 20000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (_req, res) => {
  res.send(\`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>8b8t Bot Console</title><style>
*{box-sizing:border-box}body{margin:20px;background:#0c0f12;color:#a5acb6;font:14px 'Courier New',monospace}
h2{color:#52a3ff}#controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:16px 0}
button{border:0;border-radius:4px;padding:12px 22px;font: bold 14px 'Courier New';cursor:pointer}
#startBtn{background:#16834a;color:white}#stopBtn{background:#b83232;color:white}#sendBtn{background:#52a3ff;color:#0c0f12}
button:disabled{opacity:.45;cursor:not-allowed}#status{font-weight:bold;color:#f4b400}
#console{height:400px;overflow:auto;overflow-wrap:anywhere;background:#050709;border:1px solid #1a222d;border-radius:5px;padding:15px}
.log{margin:4px 0;line-height:1.4;white-space:pre-wrap}.sys{color:#f4b400}.srv{color:#a5acb6}.status{color:#0f9d58;font-weight:bold}.err{color:#db4437}
#input-container{display:flex;gap:10px;margin-top:15px}input{flex:1;min-width:0;background:#14191f;border:1px solid #2c384c;color:white;padding:12px;font:14px 'Courier New';border-radius:4px}
@media(max-width:500px){body{margin:10px}#input-container{flex-direction:column}}
</style></head><body>
<h2>🤖 8b8t Bot Console — \${MC_CONFIG.username}</h2>
<p>Start or stop the Minecraft connection. Unexpected kicks, socket closes and disconnects trigger automatic reconnects while running.</p>
<div id="controls"><button id="startBtn">Start Bot</button><button id="stopBtn" disabled>Stop Bot</button><span id="status">● STOPPED</span></div>
<div id="console"></div>
<div id="input-container"><input id="cmdInput" placeholder="Send Minecraft chat or command..." autocomplete="off"><button id="sendBtn">Execute</button></div>
<script src="/socket.io/socket.io.js"></script><script>
const socket=io(), logBox=document.getElementById('console'), input=document.getElementById('cmdInput');
const start=document.getElementById('startBtn'), stop=document.getElementById('stopBtn'), status=document.getElementById('status');
start.onclick=()=>socket.emit('startBot'); stop.onclick=()=>socket.emit('stopBot');
socket.on('botStatus',s=>{status.textContent=s?'● RUNNING / CONNECTING':'● STOPPED';status.style.color=s?'#0f9d58':'#f4b400';start.disabled=!!s;stop.disabled=!s;});
socket.on('botLog',d=>{const e=document.createElement('div');e.className='log '+d.type;e.textContent=d.text;logBox.appendChild(e);logBox.scrollTop=logBox.scrollHeight;});
function send(){const v=input.value.trim();if(v){socket.emit('uiCommand',v);input.value='';}}
document.getElementById('sendBtn').onclick=send;input.addEventListener('keydown',e=>{if(e.key==='Enter')send();});
</script></body></html>\`);
});

let bot = null;
let shouldRun = false;
let isShuttingDown = false;
let reconnectTimer = null;
let isShiftingServers = false;
let loginDispatched = false;
let isFullyLoaded = false;
let generation = 0;

function log(message, type = 'srv') {
  const text = String(message);
  console.log(text);
  io.emit('botLog', { text, type });
}
function setStatus() { io.emit('botStatus', shouldRun); }

const discordClient = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});
const discordQueue = [];
let discordSending = false;

async function flushDiscordQueue() {
  if (!discordClient.isReady() || discordSending) return;
  discordSending = true;
  try {
    while (discordQueue.length && discordClient.isReady()) {
      const message = discordQueue.shift();
      try {
        const channel = await discordClient.channels.fetch(DISCORD_CHANNEL_ID);
        if (channel && channel.isTextBased()) {
          await channel.send({ content: message, allowedMentions: { parse: [] } });
        } else {
          log('[Discord] Configured channel is not a text channel.', 'err');
        }
      } catch (err) {
        log('[Discord Error] ' + err.message, 'err');
      }
    }
  } finally {
    discordSending = false;
  }
}
function queueDiscord(message) {
  if (!discordClient.isReady() || !message) return;
  discordQueue.push(String(message).replace(/@(everyone|here)/g, '@​$1').slice(0, 2000));
  if (discordQueue.length > 100) discordQueue.shift();
  void flushDiscordQueue();
}

discordClient.on('messageCreate', message => {
  try {
    if (message.author.bot || message.channel.id !== DISCORD_CHANNEL_ID) return;
    const body = String(message.content || '').replace(/\s+/g, ' ').trim();
    if (!body) return;
    const name = message.member?.displayName || message.author.globalName || message.author.username;
    const chat = \`> \${name}: \${body}\`.slice(0, 256);
    if (bot?._client?.state === 'play' && !isShiftingServers) {
      bot.chat(chat);
      log('[Discord -> MC] ' + chat, 'sys');
    } else {
      log('[Discord -> MC] Skipped; Minecraft bot is not in-game.', 'err');
    }
  } catch (err) {
    log('[Discord Handler Error] ' + err.message, 'err');
  }
});

function clearReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}
function scheduleReconnect(reason = 'connection lost') {
  if (!shouldRun || isShuttingDown || reconnectTimer) return;
  const delay = Math.floor(Math.random() * (RECONNECT_MAX - RECONNECT_MIN + 1)) + RECONNECT_MIN;
  log(\`[Reconnect] \${reason}. Retrying in \${(delay / 1000).toFixed(1)} seconds...\`, 'sys');
  queueDiscord(\`⏳ Disconnected. Reconnecting in \${(delay / 1000).toFixed(1)} seconds...\`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (shouldRun && !isShuttingDown && !bot) createBotInstance();
  }, delay);
}

function createBotInstance() {
  if (!shouldRun || isShuttingDown || bot) return;
  const thisGeneration = ++generation;
  let currentBot;
  let disconnectHandled = false;

  function handleDisconnect(reason, source) {
    if (disconnectHandled || thisGeneration !== generation) return;
    disconnectHandled = true;
    log(\`[Disconnect] \${source}: \${reason || 'connection closed'}\`, 'err');
    if (bot === currentBot) bot = null;
    loginDispatched = false;
    isShiftingServers = false;
    isFullyLoaded = false;
    setStatus();
    if (shouldRun && !isShuttingDown) scheduleReconnect(source);
  }

  log(\`[System] Connecting \${MC_CONFIG.username} to \${MC_CONFIG.host}...\`, 'sys');
  loginDispatched = false;
  isShiftingServers = false;
  isFullyLoaded = false;

  try {
    currentBot = mineflayer.createBot(MC_CONFIG);
    bot = currentBot;
  } catch (err) {
    log('[Minecraft Create Error] ' + err.message, 'err');
    scheduleReconnect('bot creation failed');
    return;
  }

  // Listen for the underlying socket closing. Mineflayer's end event is also
  // registered below; the per-instance guard prevents duplicate reconnects.
  const attachSocketClose = () => {
    const socket = currentBot._client?.socket;
    if (socket && !socket.__reaperCloseHandler) {
      socket.__reaperCloseHandler = true;
      socket.once('close', hadError => handleDisconnect(
        hadError ? 'socket closed after error' : 'socket closed', 'Socket'
      ));
    }
  };
  attachSocketClose();
  currentBot._client?.once('connect', attachSocketClose);

  currentBot._client?.on('state', (next, previous) => {
    log(\`[Protocol State] \${previous} -> \${next}\`, 'sys');
    if (next === 'configuration') {
      isShiftingServers = true;
      isFullyLoaded = false;
      log('[Protocol] Server transition detected.', 'sys');
    }
    if (next === 'play') {
      isShiftingServers = false;
      try {
        currentBot.clearControlStates?.();
        currentBot.entity?.velocity?.set(0, 0, 0);
      } catch (_) {}
    }
  });

  currentBot.on('messagestr', (message, position) => {
    if (position === 'game_info') return;
    const text = String(message).trim();
    if (!text) return;
    log('[Server] ' + text, 'srv');
    queueDiscord('\`[8b8t]\` ' + text);

    if (text.includes('Connecting to 8b8t')) {
      isShiftingServers = true;
      isFullyLoaded = false;
      log('[Status] Proxy transition detected.', 'sys');
    }
    if (!isShiftingServers && !loginDispatched &&
        (text.includes('/login') || text.includes('session has been continued'))) {
      loginDispatched = true;
      if (!MC_PASSWORD) {
        log('[Login] MC_PASSWORD is not set; automatic login skipped.', 'err');
        return;
      }
      setTimeout(() => {
        if (shouldRun && bot === currentBot && currentBot._client?.state === 'play' && !isShiftingServers) {
          currentBot.chat('/login ' + MC_PASSWORD);
          log('[Login] Login command sent.', 'sys');
        }
      }, 3500);
    }
  });

  currentBot.on('health', () => {
    if (isShiftingServers || thisGeneration !== generation) return;
    if (!isFullyLoaded) {
      isFullyLoaded = true;
      const hp = typeof currentBot.health === 'number' ? currentBot.health.toFixed(1) : 'Unknown';
      const food = typeof currentBot.food === 'number' ? currentBot.food : 'Unknown';
      log(\`[Status] Connected to 8b8t! HP: \${hp} | Hunger: \${food}\`, 'status');
      queueDiscord(\`🟢 Connected to 8b8t! HP: \${hp} | Hunger: \${food}\`);
    }
  });

  currentBot.on('error', err => log('[Minecraft Error] ' + (err?.message || err), 'err'));
  currentBot.on('kicked', reason => {
    const detail = typeof reason === 'string' ? reason : JSON.stringify(reason);
    log('[Kicked] ' + detail, 'err');
    queueDiscord('🔴 Bot was kicked: ' + detail);
    // Mineflayer emits end for a completed kick; socket close is a fallback.
  });
  currentBot.on('end', reason => handleDisconnect(reason, 'Minecraft end'));
}

io.on('connection', socket => {
  socket.emit('botStatus', shouldRun);

  socket.on('startBot', () => {
    if (isShuttingDown) return;
    if (shouldRun) {
      log('[System] Bot is already running or connecting.', 'sys');
      return;
    }
    shouldRun = true;
    setStatus();
    log('[System] Start requested.', 'sys');
    createBotInstance();
  });

  socket.on('stopBot', () => {
    if (!shouldRun && !bot && !reconnectTimer) {
      log('[System] Bot is already stopped.', 'sys');
      return;
    }
    shouldRun = false;
    clearReconnect();
    generation++; // invalidate callbacks from the previous connection
    const oldBot = bot;
    bot = null;
    loginDispatched = false;
    isShiftingServers = false;
    isFullyLoaded = false;
    setStatus();
    if (oldBot) {
      try { oldBot.quit('Stopped from dashboard'); }
      catch (err) { log('[Stop Error] ' + err.message, 'err'); }
    }
    log('[System] Bot stopped; automatic reconnect disabled.', 'sys');
    queueDiscord('⏹️ Minecraft bot stopped from dashboard.');
  });

  socket.on('uiCommand', input => {
    if (typeof input !== 'string') return;
    const command = input.trim();
    if (!command) return;
    if (command.length > 256) return log('[Console] Message is too long.', 'err');
    if (bot?._client?.state === 'play' && !isShiftingServers) {
      bot.chat(command);
      log('[Console -> MC] ' + command, 'sys');
    } else {
      log('[Console] Bot is not currently in-game.', 'err');
    }
  });
});

server.listen(PORT, () => {
  log(\`[Web Server] Dashboard available at http://localhost:\${PORT}\`, 'status');
  log('[System] Dashboard ready. Press Start Bot to connect.', 'sys');
});

if (DISCORD_TOKEN) {
  discordClient.once('ready', () => {
    log('[Discord] Logged in as ' + discordClient.user.tag, 'status');
    void flushDiscordQueue();
  });
  discordClient.login(DISCORD_TOKEN).catch(err => log('[Discord Login Error] ' + err.message, 'err'));
} else {
  log('[Discord] DISCORD_TOKEN not set; Discord bridge disabled.', 'sys');
}

function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  shouldRun = false;
  clearReconnect();
  generation++;
  const oldBot = bot;
  bot = null;
  if (oldBot) {
    try { oldBot.quit('Application shutting down'); }
    catch (err) { console.error('[Shutdown] Minecraft:', err.message); }
  }
  if (discordClient.isReady()) discordClient.destroy();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
