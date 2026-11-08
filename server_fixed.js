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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DEADLY COMMAND NODE // 8b8t</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #050811;
      --panel: #0b111e;
      --panel-accent: #111a2e;
      --border: #1b2a47;
      --border-glow: #2a3f66;
      --text: #e2eaf5;
      --text-muted: #7689a9;
      
      /* Deadly Cyan / Cyber Palette */
      --cyan: #00f0ff;
      --blue: #387cff;
      --green: #00ff66;
      --red: #ff3366;
      --amber: #ffb800;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background: radial-gradient(circle at 0% 0%, #0d1b35 0%, transparent 40%), 
                  radial-gradient(circle at 100% 100%, #121026 0%, transparent 45%), 
                  var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      padding: 24px;
      height: 100vh;
      display: flex;
      flex-direction: column;
      gap: 20px;
      overflow: hidden;
    }

    /* Top Premium Navbar */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .brand-logo {
      width: 38px;
      height: 38px;
      background: linear-gradient(135deg, var(--blue), var(--cyan));
      border-radius: 8px;
      display: grid;
      place-items: center;
      font-weight: 900;
      color: #000;
      font-size: 18px;
      box-shadow: 0 0 20px rgba(0, 240, 255, 0.25);
    }

    .brand-text h1 {
      font-size: 15px;
      font-weight: 800;
      letter-spacing: 1px;
      text-transform: uppercase;
    }

    .brand-text p {
      font-size: 11px;
      color: var(--text-muted);
      font-family: monospace;
    }

    .status-container {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border: 1px solid transparent;
      background: rgba(0,0,0,0.2);
    }
    .status-badge::before {
      content: "";
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }
    .status-disconnected { color: var(--red); border-color: rgba(255,51,102,0.2); box-shadow: 0 0 10px rgba(255,51,102,0.1); }
    .status-connecting { color: var(--amber); border-color: rgba(255,184,0,0.2); box-shadow: 0 0 10px rgba(255,184,0,0.1); }
    .status-lobby { color: var(--blue); border-color: rgba(56,124,255,0.2); box-shadow: 0 0 10px rgba(56,124,255,0.1); }
    .status-online { color: var(--green); border-color: rgba(0,255,102,0.2); box-shadow: 0 0 10px rgba(0,255,102,0.1); }

    /* Main Dashboard Dynamic Workspace Splitter */
    .dashboard {
      display: grid;
      grid-template-columns: 320px 1fr;
      gap: 20px;
      flex: 1;
      min-height: 0;
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .panel-header {
      padding: 14px 18px;
      border-bottom: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.01);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .panel-title {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-muted);
    }

    .panel-body {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      flex: 1;
      overflow-y: auto;
    }

    /* High level Google Style Form Transitions */
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .form-group label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      font-weight: 700;
    }

    input[type="text"], input[type="password"] {
      background: #060a12;
      border: 1px solid var(--border);
      color: #fff;
      padding: 10px 12px;
      font-family: monospace;
      font-size: 13px;
      border-radius: 6px;
      outline: none;
      transition: all 0.2s;
    }
    input:focus {
      border-color: var(--cyan);
      box-shadow: 0 0 0 2px rgba(0, 240, 255, 0.15);
    }

    /* Google Style Active Profile Target Card */
    .google-profile-card {
      background: var(--panel-accent);
      border: 1px solid var(--border);
      padding: 16px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .profile-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--blue), var(--cyan));
      color: #000;
      font-weight: 900;
      font-size: 16px;
      display: grid;
      place-items: center;
    }

    .profile-details {
      display: flex;
      flex-direction: column;
    }

    .profile-name {
      font-size: 14px;
      font-weight: 700;
      color: var(--cyan);
    }

    .profile-meta {
      font-size: 11px;
      color: var(--text-muted);
      font-family: monospace;
    }

    /* Actions Matrix Control Buttons */
    .btn {
      font-family: inherit;
      font-weight: 700;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 10px 16px;
      border: 1px solid transparent;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .btn-start {
      background: var(--cyan);
      color: #000;
      box-shadow: 0 4px 12px rgba(0, 240, 255, 0.15);
    }
    .btn-start:hover {
      background: #00d8e6;
      transform: translateY(-1px);
    }
    .btn-stop {
      background: rgba(255, 51, 102, 0.1);
      border-color: var(--red);
      color: var(--red);
    }
    .btn-stop:hover {
      background: var(--red);
      color: #000;
      transform: translateY(-1px);
    }
    .btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
      transform: none !important;
    }

    /* Telemetry Telemetric Metrics Deck */
    .right-workspace {
      display: flex;
      flex-direction: column;
      gap: 20px;
      min-width: 0;
    }

    .telemetry-deck {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
    }

    .metric-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 18px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .metric-label {
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
    }

    .metric-value {
      font-family: monospace;
      font-size: 20px;
      font-weight: 700;
      color: #fff;
    }

    /* Terminal Console Array */
    .terminal-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }

    .terminal-header-meta {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--border);
    }
    .dot-1 { background: var(--red); }
    .dot-2 { background: var(--amber); }
    .dot-3 { background: var(--green); }

    #console {
      background: #04070d;
      border: 1px solid var(--border);
      border-top: none;
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
      font-size: 12px;
      line-height: 1.6;
      box-shadow: inset 0 4px 20px rgba(0,0,0,0.5);
    }

    .log {
      margin-bottom: 4px;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .sys { color: var(--amber); }
    .srv { color: #8ba2c7; }
    .status { color: var(--green); font-weight: bold; }
    .err { color: var(--red); font-weight: bold; }
    .sent { color: var(--cyan); font-style: italic; }

    .terminal-input-bar {
      background: var(--panel-accent);
      border: 1px solid var(--border);
      border-top: none;
      padding: 10px 14px;
      border-radius: 0 0 12px 12px;
      display: flex;
      gap: 12px;
    }

    .terminal-input-bar input {
      flex: 1;
      border-radius: 4px;
    }

    @media (max-width: 768px) {
      body { padding: 12px; overflow-y: auto; height: auto; }
      .dashboard { grid-template-columns: 1fr; height: auto; }
      .telemetry-deck { grid-template-columns: 1fr; }
      #console { height: 350px; }
    }
  </style>
</head>
<body>
  <header class="header">
    <div class="brand">
      <div class="brand-logo">D</div>
      <div class="brand-text">
        <h1>Deadly Command Node</h1>
        <p>TUNNEL INTERFACE // CORE v${MC_VERSION}</p>
      </div>
    </div>
    <div class="status-container">
      <span id="statusLabel" class="status-badge status-disconnected">disconnected</span>
    </div>
  </header>

  <main class="dashboard">
    <aside class="panel">
      <div class="panel-header"><span class="panel-title">Session Identity</span></div>
      <div class="panel-body">
        <div id="credentialConfigArea" class="form-group">
          <label for="botUser">Bot Username</label>
          <input id="botUser" type="text" autocomplete="username" placeholder="Minecraft username">
          <label for="botPass">Server Password</label>
          <input id="botPass" name="sessionKeyEntry" type="text" autocomplete="new-password" autocapitalize="off" spellcheck="false" placeholder="Enter server password">
          <button id="startBtn" class="btn btn-start">Establish Connection</button>
        </div>

        <div id="activeProfileDisplay" class="google-profile-card" style="display:none">
          <div id="profileLetter" class="profile-avatar">D</div>
          <div class="profile-details">
            <span id="profileNameString" class="profile-name">Bot</span>
            <span class="profile-meta">ACTIVE SESSION</span>
          </div>
        </div>

        <button id="stopBtn" class="btn btn-stop" style="display:none">Terminate Pipeline</button>
        <div class="profile-meta">TARGET: ${SERVER_HOST} : ${SERVER_PORT}</div>
        <p class="profile-meta">Use this dashboard only on servers where automated clients are permitted.</p>
      </div>
    </aside>

    <section class="right-workspace">
      <div class="telemetry-deck">
        <div class="metric-card"><span class="metric-label">Vitals Meter</span><span id="valHP" class="metric-value">-- HP</span></div>
        <div class="metric-card"><span class="metric-label">Nutrition Level</span><span id="valFood" class="metric-value">-- FOOD</span></div>
        <div class="metric-card"><span class="metric-label">Coordinates Vector</span><span id="valXYZ" class="metric-value">--, --, --</span></div>
      </div>

      <div class="terminal-container panel">
        <div class="panel-header">
          <span class="panel-title">Pipeline Streams</span>
          <div class="terminal-header-meta"><span class="dot dot-1"></span><span class="dot dot-2"></span><span class="dot dot-3"></span></div>
        </div>
        <div id="console" aria-live="polite"></div>
        <div class="terminal-input-bar">
          <input id="cmdInput" type="text" placeholder="Enter chat command..." disabled>
          <button id="sendBtn" class="btn btn-start" disabled>Send</button>
        </div>
      </div>
    </section>
  </main>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const consoleDiv = document.getElementById('console');
    const botUser = document.getElementById('botUser');
    const botPass = document.getElementById('botPass');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const cmdInput = document.getElementById('cmdInput');
    const sendBtn = document.getElementById('sendBtn');
    const statusLabel = document.getElementById('statusLabel');
    const credentialConfigArea = document.getElementById('credentialConfigArea');
    const activeProfileDisplay = document.getElementById('activeProfileDisplay');
    const profileLetter = document.getElementById('profileLetter');
    const profileNameString = document.getElementById('profileNameString');
    const valHP = document.getElementById('valHP');
    const valFood = document.getElementById('valFood');
    const valXYZ = document.getElementById('valXYZ');

    // Prevent browser-restored credentials from appearing in this field.
    window.addEventListener('pageshow', () => { botPass.value = ''; });

    socket.on('botLog', (data) => {
      const logLine = document.createElement('div');
      logLine.className = 'log ' + data.type;
      logLine.textContent = data.text;
      consoleDiv.appendChild(logLine);
      consoleDiv.scrollTop = consoleDiv.scrollHeight;
    });

    socket.on('statusShift', (status, activeUser) => {
      statusLabel.className = 'status-badge status-' + status;
      statusLabel.textContent = status;

      const disconnected = status === 'disconnected';
      credentialConfigArea.style.display = disconnected ? 'flex' : 'none';
      activeProfileDisplay.style.display = disconnected ? 'none' : 'flex';
      stopBtn.style.display = disconnected ? 'none' : 'block';

      if (disconnected) {
        cmdInput.disabled = true;
        sendBtn.disabled = true;
        valHP.textContent = '-- HP';
        valFood.textContent = '-- FOOD';
        valXYZ.textContent = '--, --, --';
      } else {
        if (activeUser) {
          profileNameString.textContent = activeUser;
          profileLetter.textContent = activeUser.charAt(0).toUpperCase();
        }
        const activeSession = status === 'online' || status === 'lobby';
        cmdInput.disabled = !activeSession;
        sendBtn.disabled = !activeSession;
      }
    });

    socket.on('telemetry', (data) => {
      valHP.textContent = data.health + ' HP';
      valFood.textContent = data.food + ' FOOD';
      valXYZ.textContent = data.x + ', ' + data.y + ', ' + data.z;
    });

    startBtn.addEventListener('click', () => {
      const username = botUser.value.trim();
      const password = botPass.value;
      if (!username || !password) {
        alert('Username and password are required.');
        return;
      }
      socket.emit('startBot', { username, password });
      botPass.value = '';
    });

    stopBtn.addEventListener('click', () => socket.emit('stopBot'));

    function transmitChat() {
      const value = cmdInput.value.trim();
      if (!value) return;
      socket.emit('uiCommand', value);
      cmdInput.value = '';
    }

    sendBtn.addEventListener('click', transmitChat);
    cmdInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') transmitChat();
    });
  </script>
</body>
</html>`);
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
  let x = '0.0';
  let y = '0.0';
  let z = '0.0';

  if (bot.entity && bot.entity.position) {
    x = bot.entity.position.x.toFixed(1);
    y = bot.entity.position.y.toFixed(1);
    z = bot.entity.position.z.toFixed(1);
  }

  io.emit('telemetry', { health, food, x, y, z });
}

function killBotInstance() {
  if (telemetryInterval) {
    clearInterval(telemetryInterval);
    telemetryInterval = null;
  }
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (bot) {
    const oldBot = bot;
    bot = null;
    try {
      oldBot.quit();
    } catch (_error) {}
    oldBot.removeAllListeners();
  }

  loginDispatched = false;
  isShiftingServers = false;
  isFullyLoaded = false;
  updateStatus('disconnected');
}

function launchBotInstance() {
  if (bot || manuallyStopped) return;

  updateStatus('connecting');
  uiLog(`[System] Connecting to ${SERVER_HOST} as ${botConfig.username}...`, 'sys');

  bot = mineflayer.createBot({
    host: SERVER_HOST,
    port: SERVER_PORT,
    username: botConfig.username,
    auth: 'offline',
    version: MC_VERSION,
    checkTimeoutInterval: 120000
  });

  telemetryInterval = setInterval(sendTelemetryUpdate, 1000);

  bot._client.on('state', (newState, oldState) => {
    uiLog(`[Protocol State] ${oldState} -> ${newState}`, 'sys');

    if (newState === 'configuration') {
      isShiftingServers = true;
      isFullyLoaded = false;
      updateStatus('connecting');
    }

    if (newState === 'play') {
      isShiftingServers = false;
      if (bot && typeof bot.clearControlStates === 'function') {
        bot.clearControlStates();
      }
    }
  });

  bot.on('messagestr', (message, messagePosition) => {
    if (messagePosition === 'game_info') return;
    const cleanMessage = message.trim();
    if (cleanMessage) uiLog(`[Server] ${cleanMessage}`, 'srv');

    if (cleanMessage.includes('Connecting to 8b8t')) {
      isShiftingServers = true;
      isFullyLoaded = false;
      updateStatus('connecting');
    }

    if (
      !isShiftingServers &&
      !loginDispatched &&
      (cleanMessage.includes('/login') || cleanMessage.includes('session has been continued'))
    ) {
      loginDispatched = true;
      updateStatus('lobby');
      uiLog('[Lobby] Login prompt detected.', 'sys');

      setTimeout(() => {
        if (bot && bot._client && bot._client.state === 'play' && !isShiftingServers) {
          bot.chat(`/login ${botConfig.password}`);
          uiLog('[Lobby] Login command sent.', 'sys');
        }
      }, 3500);
    }
  });

  bot.on('spawn', () => {
    if (isShiftingServers) return;
    isFullyLoaded = true;
    updateStatus('online');
    uiLog('[Status] Bot spawned in the server.', 'status');
    sendTelemetryUpdate();
  });

  bot.on('health', sendTelemetryUpdate);

  bot.on('error', (error) => {
    uiLog(`[Error] ${error.message || error}`, 'err');
  });

  bot.on('kicked', (reason) => {
    uiLog(`[Kicked] ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`, 'err');
  });

  bot.on('end', (reason) => {
    uiLog(`[Disconnect] Connection ended: ${reason || 'unknown reason'}`, 'err');
    killBotInstance();

    if (!manuallyStopped && botConfig.username) {
      updateStatus('connecting');
      uiLog('[System] Reconnecting in 15 seconds...', 'sys');
      reconnectTimeout = setTimeout(launchBotInstance, 15000);
    }
  });
}

io.on('connection', (socket) => {
  socket.emit('statusShift', botStatus, botConfig.username);
  if (bot) sendTelemetryUpdate();

  socket.on('startBot', (data) => {
    if (bot || !data || !data.username || !data.password) return;
    manuallyStopped = false;
    botConfig.username = String(data.username).trim();
    botConfig.password = String(data.password);
    launchBotInstance();
  });

  socket.on('stopBot', () => {
    uiLog('[System] Stop requested. Disconnecting...', 'err');
    manuallyStopped = true;
    botConfig.username = '';
    botConfig.password = '';
    killBotInstance();
  });

  socket.on('uiCommand', (inputText) => {
    if (bot && bot._client && bot._client.state === 'play' && !isShiftingServers) {
      try {
        bot.chat(String(inputText));
        uiLog(`[Sent Chat] ${inputText}`, 'sent');
      } catch (error) {
        uiLog(`[System Error] ${error.message}`, 'err');
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Deadly Command Node is available at http://localhost:${PORT}`);
});