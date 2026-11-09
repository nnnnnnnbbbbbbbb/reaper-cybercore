// 8b8t.me Mineflayer Web Console
// Run: npm install express socket.io mineflayer
// Set MC_LOGIN_PASSWORD in your host's environment before starting.
// Example (Linux): export MC_LOGIN_PASSWORD='your-current-password'
// This file intentionally does not store account credentials in source.

'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT || 3000);
const config = {
  host: process.env.MC_HOST || '8b8t.me',
  port: Number(process.env.MC_PORT || 25565),
  username: process.env.MC_USERNAME || 'deadly_boxer_1',
  auth: process.env.MC_AUTH || 'offline',
  version: process.env.MC_VERSION || '1.21.11',
  checkTimeoutInterval: 120000,
};

const LOGIN_PASSWORD = process.env.MC_LOGIN_PASSWORD || '';
const LOGIN_DELAY_MS = 3500;
const RECONNECT_DELAY_MS = 15000;

let bot = null;
let reconnectTimer = null;
let loginSent = false;
let reconnectEnabled = true;
let serverTransition = false;
let botOnline = false;

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>8b8t Bot Console</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin:0; padding:24px; background:#0b1017; color:#dce5f2; font:14px/1.5 system-ui,sans-serif; }
    main { max-width:1050px; margin:auto; }
    header { display:flex; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap; margin-bottom:18px; }
    h1 { margin:0; font-size:22px; color:#7db7ff; }
    .status { color:#9aa9bc; }
    .panel { border:1px solid #243144; background:#101824; border-radius:12px; padding:16px; }
    #console { height:min(60vh,520px); min-height:280px; overflow:auto; background:#05080d; border:1px solid #202c3b; border-radius:8px; padding:12px; font:13px/1.6 ui-monospace,monospace; white-space:pre-wrap; overflow-wrap:anywhere; }
    .line { margin:2px 0; }
    .sys { color:#f3c969; } .srv { color:#c3d0e0; } .statusline { color:#70e0a1; } .err { color:#ff8585; }
    .controls { display:flex; gap:10px; margin-top:12px; }
    input { flex:1; min-width:0; background:#0a111b; color:#fff; border:1px solid #2a3a50; border-radius:8px; padding:12px; outline:none; }
    input:focus { border-color:#6aaeff; }
    button { background:#6aaeff; color:#08111c; border:0; border-radius:8px; padding:11px 16px; font-weight:700; cursor:pointer; }
    button:disabled { opacity:.45; cursor:not-allowed; }
    .hint { color:#8798ad; margin:10px 0 0; font-size:12px; }
    @media(max-width:600px) { body { padding:12px; } .controls { flex-wrap:wrap; } .controls input { flex-basis:100%; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div><h1>🤖 8b8t Bot Console</h1><div class="status">8b8t.me · deadly_boxer_1 · Minecraft 1.21.11</div></div>
      <div id="connection" class="status">Connecting…</div>
    </header>
    <section class="panel">
      <div id="console" aria-live="polite"></div>
      <div class="controls">
        <input id="message" autocomplete="off" placeholder="Chat message or server command…" />
        <button id="send">Send</button>
      </div>
      <p class="hint">Console commands are sent as chat. Keep the dashboard private; anyone who can access it may send messages as the bot.</p>
    </section>
  </main>
  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const consoleEl = document.getElementById('console');
    const input = document.getElementById('message');
    const send = document.getElementById('send');
    const connection = document.getElementById('connection');

    socket.on('botLog', (entry) => {
      const line = document.createElement('div');
      line.className = 'line ' + (entry.type || 'srv');
      line.textContent = entry.text;
      consoleEl.appendChild(line);
      consoleEl.scrollTop = consoleEl.scrollHeight;
    });
    socket.on('botStatus', (status) => {
      connection.textContent = status;
    });

    function submit() {
      const value = input.value.trim();
      if (!value) return;
      socket.emit('uiCommand', value);
      input.value = '';
      input.focus();
    }
    send.addEventListener('click', submit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });
  </script>
</body>
</html>`;

app.get('/', (_req, res) => res.type('html').send(page));

function log(text, type = 'srv') {
  console.log(text);
  io.emit('botLog', { text, type });
}

function status(text) {
  io.emit('botStatus', text);
}

function scheduleReconnect() {
  if (!reconnectEnabled || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    createBot();
  }, RECONNECT_DELAY_MS);
}

function createBot() {
  if (!reconnectEnabled) return;

  log(`[System] Connecting to ${config.host}:${config.port} as ${config.username}…`, 'sys');
  loginSent = false;
  serverTransition = false;
  botOnline = false;
  status('Connecting…');

  try {
    bot = mineflayer.createBot(config);
  } catch (error) {
    log(`[Error] Could not create bot: ${error.message}`, 'err');
    scheduleReconnect();
    return;
  }

  bot.on('messagestr', (message, position) => {
    if (position === 'game_info') return;
    const text = String(message || '').trim();
    if (!text) return;
    log(`[Server] ${text}`, 'srv');

    if (/connecting to 8b8t/i.test(text)) {
      serverTransition = true;
      botOnline = false;
      status('Server transition…');
      return;
    }

    const asksForLogin = /\/login\b/i.test(text) || /session has been continued/i.test(text);
    if (!serverTransition && !loginSent && asksForLogin) {
      if (!LOGIN_PASSWORD) {
        log('[Auth] Set MC_LOGIN_PASSWORD in the hosting environment to enable automatic /login.', 'err');
        return;
      }
      loginSent = true;
      log('[Auth] Login prompt detected; sending configured password.', 'sys');
      setTimeout(() => {
        if (bot && bot._client && bot._client.state === 'play' && !serverTransition) {
          bot.chat('/login ' + LOGIN_PASSWORD);
          log('[Auth] Login command sent.', 'sys');
        }
      }, LOGIN_DELAY_MS);
    }
  });

  bot.on('spawn', () => {
    serverTransition = false;
    botOnline = true;
    status('Online');
    log('[Status] Bot spawned in the world.', 'statusline');
  });

  bot.on('health', () => {
    if (!bot || serverTransition) return;
    const hp = Number.isFinite(bot.health) ? bot.health.toFixed(1) : 'Unknown';
    const food = Number.isFinite(bot.food) ? String(bot.food) : 'Unknown';
    log(`[Status] Health: ${hp} · Food: ${food}`, 'statusline');
  });

  bot.on('error', (error) => {
    log(`[Error] ${error && error.message ? error.message : error}`, 'err');
    status('Error');
  });

  bot.on('kicked', (reason) => {
    log(`[Kicked] ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`, 'err');
    status('Kicked');
  });

  bot.on('end', (reason) => {
    botOnline = false;
    status('Disconnected');
    log(`[Disconnect] ${reason || 'Connection ended'}`, 'err');
    bot = null;
    scheduleReconnect();
  });
}

io.on('connection', (socket) => {
  socket.emit('botStatus', botOnline ? 'Online' : 'Connecting / offline');
  socket.on('uiCommand', (raw) => {
    const message = String(raw || '').trim();
    if (!message || message.length > 256) return;
    if (!bot || !bot._client || bot._client.state !== 'play' || serverTransition) {
      socket.emit('botLog', { text: '[Console] Bot is not ready to send chat.', type: 'err' });
      return;
    }
    bot.chat(message);
    log(`[Sent] ${message}`, 'sys');
  });
});

server.listen(PORT, () => {
  console.log(`[Web Console] Listening on port ${PORT}`);
  createBot();
});

process.on('SIGINT', () => {
  reconnectEnabled = false;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (bot) bot.quit('Web console stopping');
  server.close(() => process.exit(0));
});
