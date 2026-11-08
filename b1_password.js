
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

/* --------------------------------------------------
   DASHBOARD PASSWORD GATE
   Set DASHBOARD_PASSWORD in the environment for deployment.
-------------------------------------------------- */
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'change-this-password';
const SESSION_COOKIE = 'reaper_dashboard_session';
const SESSION_TOKEN = crypto
  .createHmac('sha256', DASHBOARD_PASSWORD)
  .update('REAPER-CYBERCORE-DASHBOARD-SESSION')
  .digest('hex');

function safeCompare(a, b) {
  const aBuffer = Buffer.from(String(a));
  const bBuffer = Buffer.from(String(b));
  return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
}

function getCookie(req, name) {
  const cookies = req.headers.cookie || '';
  const item = cookies.split(';').map(value => value.trim())
    .find(value => value.startsWith(name + '='));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
}

function isAuthenticated(req) {
  return safeCompare(getCookie(req, SESSION_COOKIE), SESSION_TOKEN);
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  return res.redirect('/login');
}

app.use(express.urlencoded({ extended: false, limit: '2kb' }));

app.get('/login', (req, res) => {
  if (isAuthenticated(req)) return res.redirect('/');
  res.send(`
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>REAPER // ACCESS</title>
<style>
:root{color-scheme:dark;--cyan:#00f5ff;--bg:#05070b;--border:#182638;--text:#dce8f5;--muted:#63758b;--red:#ff4267}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:var(--bg);color:var(--text);font:13px monospace}
body:before{content:"";position:fixed;inset:0;pointer-events:none;background-image:linear-gradient(#00f5ff06 1px,transparent 1px),linear-gradient(90deg,#00f5ff06 1px,transparent 1px);background-size:35px 35px}
.card{position:relative;width:min(420px,100%);padding:30px;background:linear-gradient(145deg,#0b111b,#080c13);border:1px solid var(--border);border-radius:10px;box-shadow:0 0 35px #00f5ff0a}
.logo{color:var(--cyan);font-size:12px;letter-spacing:3px;margin-bottom:12px}.title{font-size:22px;letter-spacing:2px;color:#fff;margin:0}.sub{color:var(--muted);font-size:10px;letter-spacing:1.5px;margin:10px 0 26px}
label{display:block;color:var(--muted);font-size:10px;letter-spacing:1.5px;margin-bottom:8px}input{width:100%;padding:13px;background:#030508;border:1px solid #1b2c40;border-radius:4px;color:var(--cyan);outline:none;font:inherit}input:focus{border-color:var(--cyan)}button{width:100%;margin-top:14px;padding:13px;background:var(--cyan);color:#02070b;border:0;border-radius:4px;font:bold 11px monospace;letter-spacing:1px;cursor:pointer}.error{color:var(--red);font-size:11px;margin:0 0 14px}

.bot-controls { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.bot-control-btn { margin:0; width:auto; min-width:105px; padding:10px 14px; border:1px solid var(--border); border-radius:4px; font:bold 10px monospace; letter-spacing:1px; cursor:pointer; }
.bot-control-btn.start { background:var(--green); color:#03100a; }
.bot-control-btn.stop { background:var(--red); color:#160309; }
.bot-control-btn:disabled { opacity:.45; cursor:not-allowed; }
@media(max-width:600px) { .bot-controls { width:100%; } .bot-control-btn { flex:1; } }
</style>
</head>
<body><main class="card"><div class="logo">⌘ REAPER // CYBERCORE</div><h1 class="title">ACCESS REQUIRED</h1><div class="sub">MINECRAFT CONTROL INTERFACE</div>
${req.query.error ? '<p class="error">ACCESS DENIED — INCORRECT PASSWORD</p>' : ''}
<form method="POST" action="/login"><label for="password">DASHBOARD PASSWORD</label><input id="password" name="password" type="password" placeholder="Enter access password" autocomplete="current-password" required autofocus><button type="submit">UNLOCK DASHBOARD ↗</button></form></main></body></html>
  `);
});

app.post('/login', (req, res) => {
  if (safeCompare(req.body.password || '', DASHBOARD_PASSWORD)) {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${SESSION_TOKEN}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
    return res.redirect('/');
  }
  return res.redirect('/login?error=1');
});

app.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  res.redirect('/login');
});

const MC_PASSWORD = process.env.MC_PASSWORD || '';

const HIGHLIGHTED_PLAYERS = {
  deadly_boxer: {
    label: 'OWNER',
    color: '#ff4757',
    bg: 'rgba(255,71,87,0.12)'
  },
  fitmc: {
    label: 'PRIORITY',
    color: '#ffa502',
    bg: 'rgba(255,165,2,0.12)'
  }
};

const config = {
  host: '8b8t.me',
  port: 25565,
  username: 'deadly_boxer',
  auth: 'offline',
  version: '1.21.11',
  fakeHost: '8b8t.me',
  physicsEnabled: false,
  checkTimeoutInterval: 60000,
  hideErrors: true
};

let bot = null;
let isFullyLoaded = false;
let isShiftingServers = false;
let loginDispatched = false;
let reconnectTimer = null;
let diagnosticsTimer = null;
let botManuallyStopped = false;

// --------------------------------------------------
// CYBERTECH DASHBOARD
// --------------------------------------------------

app.get('/', requireAuth, (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>REAPER // CYBERCORE</title>

<style>
:root {
  --bg:#05070b;
  --panel:#0a0e16;
  --panel2:#0e1420;
  --border:#182638;
  --cyan:#00f5ff;
  --purple:#a855f7;
  --green:#00ff9d;
  --red:#ff4267;
  --orange:#ffb000;
  --text:#dce8f5;
  --muted:#63758b;
}

* {
  box-sizing:border-box;
}

body {
  margin:0;
  background:var(--bg);
  color:var(--text);
  font-family:monospace;
  font-size:13px;
  min-height:100vh;
}

body::before {
  content:"";
  position:fixed;
  inset:0;
  background-image:
    linear-gradient(#00f5ff06 1px,transparent 1px),
    linear-gradient(90deg,#00f5ff06 1px,transparent 1px);
  background-size:35px 35px;
  pointer-events:none;
  z-index:-1;
}

.wrapper {
  max-width:1600px;
  margin:auto;
  padding:24px;
}

.topbar {
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:20px;
  flex-wrap:wrap;
  padding-bottom:22px;
  border-bottom:1px solid var(--border);
}

.brand {
  display:flex;
  align-items:center;
  gap:15px;
}

.logo {
  width:48px;
  height:48px;
  display:grid;
  place-items:center;
  background:#00f5ff12;
  border:1px solid #00f5ff66;
  color:var(--cyan);
  font-size:24px;
  border-radius:10px;
}

.brand h1 {
  font-size:20px;
  letter-spacing:3px;
  margin:0;
  color:white;
}

.brand h1 span {
  color:var(--cyan);
}

.subtitle {
  font-size:10px;
  letter-spacing:2px;
  color:var(--muted);
  margin-top:6px;
}

.header-right {
  display:flex;
  align-items:center;
  gap:18px;
}

.server-info {
  text-align:right;
}

.server-name {
  color:var(--cyan);
  font-weight:bold;
}

.server-address {
  color:var(--muted);
  font-size:11px;
  margin-top:5px;
}

.connection {
  display:flex;
  align-items:center;
  gap:8px;
  border:1px solid var(--border);
  background:var(--panel);
  padding:10px 14px;
  border-radius:6px;
  font-size:11px;
}

.connection-dot {
  width:7px;
  height:7px;
  border-radius:50%;
  background:var(--orange);
}

.connection.online .connection-dot {
  background:var(--green);
  box-shadow:0 0 10px var(--green);
}

.connection.offline .connection-dot {
  background:var(--red);
}

.section-label {
  color:var(--muted);
  font-size:10px;
  letter-spacing:2px;
  margin:25px 0 12px;
}

.stats {
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:14px;
}

.card {
  background:linear-gradient(145deg,#0b111b,#080c13);
  border:1px solid var(--border);
  border-radius:8px;
  padding:17px;
}

.stat-title {
  color:var(--muted);
  font-size:10px;
  letter-spacing:1.5px;
  text-transform:uppercase;
}

.stat-value {
  color:white;
  font-size:25px;
  font-weight:bold;
  margin-top:12px;
  overflow-wrap:anywhere;
}

.cyan { color:var(--cyan); }
.green { color:var(--green); }
.purple { color:var(--purple); }

.stat-footer {
  color:var(--muted);
  font-size:10px;
  margin-top:9px;
}

.main-grid {
  display:grid;
  grid-template-columns:minmax(0,1.8fr) minmax(300px,1fr);
  gap:18px;
  margin-top:18px;
}

.column {
  display:flex;
  flex-direction:column;
  gap:18px;
  min-width:0;
}

.panel {
  background:var(--panel);
  border:1px solid var(--border);
  border-radius:8px;
  overflow:hidden;
}

.panel-header {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  padding:15px 18px;
  border-bottom:1px solid var(--border);
  background:#0c121c;
}

.panel-title {
  color:#eaf7ff;
  font-size:11px;
  font-weight:bold;
  letter-spacing:1.5px;
}

.panel-tag {
  color:var(--cyan);
  font-size:10px;
  border:1px solid #00f5ff33;
  background:#00f5ff0a;
  padding:4px 7px;
  border-radius:3px;
}

.terminal {
  height:430px;
  background:#030508;
  padding:15px;
  overflow-y:auto;
  font-size:12px;
  scrollbar-width:thin;
}

.log {
  line-height:1.6;
  margin:3px 0;
  overflow-wrap:anywhere;
}

.log::before {
  content:"> ";
  color:#354a60;
}

.sys { color:var(--orange); }
.srv { color:#9baec2; }
.status { color:var(--green); }
.err { color:var(--red); }

.terminal-footer {
  display:flex;
  align-items:center;
  gap:8px;
  padding:12px;
  border-top:1px solid var(--border);
  background:#080c13;
}

.terminal-input {
  flex:1;
  min-width:0;
  background:#030508;
  border:1px solid #1b2c40;
  padding:12px;
  color:var(--cyan);
  outline:none;
  border-radius:4px;
}

.terminal-input:focus {
  border-color:var(--cyan);
}

.execute-btn {
  background:var(--cyan);
  color:#02070b;
  border:none;
  padding:12px 18px;
  font-size:11px;
  font-weight:bold;
  border-radius:4px;
  cursor:pointer;
}

.roster-search {
  padding:12px;
  border-bottom:1px solid var(--border);
}

.roster-search input {
  width:100%;
  background:#030508;
  color:white;
  border:1px solid #1b2c40;
  padding:10px;
  outline:none;
  border-radius:4px;
}

#player-list {
  list-style:none;
  padding:10px;
  margin:0;
  height:300px;
  overflow-y:auto;
}

.player-item {
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:10px;
  margin-bottom:4px;
  border-radius:4px;
  gap:10px;
}

.player-item:hover {
  background:#111c2a;
}

.player-left-group {
  display:flex;
  align-items:center;
  gap:10px;
  min-width:0;
}

.status-dot {
  width:6px;
  height:6px;
  background:var(--green);
  border-radius:50%;
  flex-shrink:0;
}

.player-name {
  color:#dce8f5;
  overflow-wrap:anywhere;
}

.player-badge {
  font-size:9px;
  font-weight:bold;
  padding:4px 6px;
  border-radius:3px;
  flex-shrink:0;
}

.player-count {
  color:var(--cyan);
  border:1px solid #00f5ff33;
  padding:4px 8px;
  border-radius:4px;
  font-size:10px;
}

.diagnostic-grid {
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:10px;
  padding:14px;
}

.diagnostic-item {
  background:#050910;
  border:1px solid #172638;
  border-radius:5px;
  padding:12px;
}

.diagnostic-item.wide {
  grid-column:span 2;
}

.diagnostic-label {
  color:var(--muted);
  font-size:9px;
  letter-spacing:1.5px;
  text-transform:uppercase;
}

.diagnostic-value {
  color:var(--cyan);
  font-size:16px;
  font-weight:bold;
  margin-top:8px;
  overflow-wrap:anywhere;
}

.footer {
  display:flex;
  justify-content:space-between;
  gap:12px;
  flex-wrap:wrap;
  margin-top:22px;
  padding-top:15px;
  border-top:1px solid var(--border);
  color:#46576b;
  font-size:10px;
  letter-spacing:1px;
}

@media(max-width:1000px) {
  .main-grid { grid-template-columns:1fr; }
  .stats { grid-template-columns:repeat(2,1fr); }
}

@media(max-width:600px) {
  .wrapper { padding:12px; }
  .brand h1 { font-size:16px; }
  .header-right { width:100%; justify-content:space-between; }
  .stats { gap:8px; }
  .stat-value { font-size:20px; }
  .terminal { height:350px; }
  .execute-btn { padding:12px; }
}
</style>
</head>

<body>
<div class="wrapper">

<header class="topbar">
  <div class="brand">
    <div class="logo">⌘</div>
    <div>
      <h1>REAPER <span>// CYBERCORE</span></h1>
      <div class="subtitle">MINECRAFT CONTROL INTERFACE v2.0</div>
    </div>
  </div>

  <div class="header-right">
    <div class="server-info">
      <div class="server-name">8B8T NETWORK</div>
      <div class="server-address">8b8t.me : 25565</div>
    </div>

    <div class="connection" id="connection-status">
      <span class="connection-dot"></span>
      <span id="connection-text">CONNECTING</span>
    </div>

    <div class="bot-controls">
      <button id="startBotBtn" class="bot-control-btn start" type="button">START BOT</button>
      <button id="stopBotBtn" class="bot-control-btn stop" type="button">STOP BOT</button>
    </div>
  </div>
</header>

<div class="section-label">// SYSTEM OVERVIEW</div>

<div class="stats">
  <div class="card">
    <div class="stat-title">Bot Health</div>
    <div class="stat-value green" id="stat-hp">0.0 HP</div>
    <div class="stat-footer">PLAYER STATUS</div>
  </div>

  <div class="card">
    <div class="stat-title">Hunger Level</div>
    <div class="stat-value cyan" id="stat-food">0</div>
    <div class="stat-footer">FOOD POINTS</div>
  </div>

  <div class="card">
    <div class="stat-title">Online Players</div>
    <div class="stat-value purple" id="stat-players">0</div>
    <div class="stat-footer">SERVER ROSTER</div>
  </div>

  <div class="card">
    <div class="stat-title">Coordinates</div>
    <div class="stat-value cyan" id="stat-coords"
         style="font-size:15px">0, 0, 0</div>
    <div class="stat-footer">CURRENT POSITION</div>
  </div>
</div>

<div class="main-grid">

  <div class="column">
    <section class="panel">
      <div class="panel-header">
        <div class="panel-title">⌘ LIVE TERMINAL</div>
        <span class="panel-tag">STREAM ACTIVE</span>
      </div>

      <div id="console" class="terminal"></div>

      <div class="terminal-footer">
        <input type="text" id="cmdInput"
          class="terminal-input"
          placeholder="Enter chat message..."
          autocomplete="off">
        <button id="sendBtn" class="execute-btn">SEND ↗</button>
      </div>
    </section>
  </div>

  <div class="column">

    <section class="panel">
      <div class="panel-header">
        <div class="panel-title">◈ DIAGNOSTICS</div>
        <span class="panel-tag">LIVE DATA</span>
      </div>

      <div class="diagnostic-grid">
        <div class="diagnostic-item">
          <div class="diagnostic-label">Health</div>
          <div class="diagnostic-value" id="diag-hp">0.0 HP</div>
        </div>

        <div class="diagnostic-item">
          <div class="diagnostic-label">Food</div>
          <div class="diagnostic-value" id="diag-food">0</div>
        </div>

        <div class="diagnostic-item wide">
          <div class="diagnostic-label">Position</div>
          <div class="diagnostic-value" id="diag-coords">0, 0, 0</div>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-header">
        <div class="panel-title">◈ PLAYER ROSTER</div>
        <span class="player-count" id="count-badge">0 ONLINE</span>
      </div>

      <div class="roster-search">
        <input type="text" id="searchBar"
          placeholder="Search players..."
          autocomplete="off">
      </div>

      <ul id="player-list">
        <li style="color:#63758b;padding:15px">
          Waiting for connection...
        </li>
      </ul>
    </section>

  </div>
</div>

<footer class="footer">
  <span>REAPER CYBERCORE // 8B8T NETWORK</span>
  <span>INTERFACE ONLINE</span>
</footer>

</div>

<script src="/socket.io/socket.io.js"></script>

<script>
const socket = io();

const consoleDiv = document.getElementById('console');
const input = document.getElementById('cmdInput');
const button = document.getElementById('sendBtn');
const playerListUl = document.getElementById('player-list');
const countBadge = document.getElementById('count-badge');
const searchBar = document.getElementById('searchBar');

const statHp = document.getElementById('stat-hp');
const statFood = document.getElementById('stat-food');
const statCoords = document.getElementById('stat-coords');

const diagHp = document.getElementById('diag-hp');
const diagFood = document.getElementById('diag-food');
const diagCoords = document.getElementById('diag-coords');

const statPlayers = document.getElementById('stat-players');

const connectionStatus =
  document.getElementById('connection-status');

const connectionText =
  document.getElementById('connection-text');

let rosterCache = [];
const startBotBtn = document.getElementById('startBotBtn');
const stopBotBtn = document.getElementById('stopBotBtn');
function renderBotControlState(running) {
  startBotBtn.disabled = running; stopBotBtn.disabled = !running;
  startBotBtn.innerText = running ? 'BOT RUNNING' : 'START BOT';
  stopBotBtn.innerText = running ? 'STOP BOT' : 'BOT STOPPED';
}
startBotBtn.addEventListener('click', () => socket.emit('botControl', 'start'));
stopBotBtn.addEventListener('click', () => socket.emit('botControl', 'stop'));
socket.on('botControlState', state => renderBotControlState(Boolean(state.running)));
socket.on('botControlResult', result => {
  if (!result || !result.message) return;
  const line = document.createElement('div'); line.className = 'log sys';
  line.innerText = '[' + new Date().toLocaleTimeString() + '] ' + result.message;
  consoleDiv.appendChild(line); consoleDiv.scrollTop = consoleDiv.scrollHeight;
});

socket.on('connect', () => {
  connectionStatus.className = 'connection online';
  connectionText.innerText = 'CONNECTED';
});

socket.on('disconnect', () => {
  connectionStatus.className = 'connection offline';
  connectionText.innerText = 'DISCONNECTED';
});

socket.on('botLog', (data) => {
  const line = document.createElement('div');
  line.className = 'log ' + data.type;

  const timestamp = new Date().toLocaleTimeString();

  line.innerText = '[' + timestamp + '] ' + data.text;

  consoleDiv.appendChild(line);

  while (consoleDiv.childNodes.length > 200) {
    consoleDiv.removeChild(consoleDiv.firstChild);
  }

  consoleDiv.scrollTop = consoleDiv.scrollHeight;
});

socket.on('updateDiagnostics', (data) => {
  const health = Number(data.health);
  const healthText = health.toFixed(1) + ' HP';

  statHp.innerText = healthText;
  diagHp.innerText = healthText;

  statFood.innerText = data.food;
  diagFood.innerText = data.food;

  statCoords.innerText = data.coords;
  diagCoords.innerText = data.coords;

  const hpColor = health <= 6 ? '#ff4267' : '#00ff9d';

  statHp.style.color = hpColor;
  diagHp.style.color = hpColor;
});

socket.on('updatePlayerList', (players) => {
  rosterCache = players;
  statPlayers.innerText = players.length;

  renderRoster(searchBar.value.trim().toLowerCase());
});

function renderRoster(filter) {
  playerListUl.innerHTML = '';

  let visible = 0;

  rosterCache.forEach((p) => {
    if (filter && !p.name.toLowerCase().includes(filter)) {
      return;
    }

    visible++;

    const li = document.createElement('li');
    li.className = 'player-item';

    if (p.meta) {
      li.style.background = p.meta.bg;
      li.style.borderLeft = '2px solid ' + p.meta.color;
    }

    const left = document.createElement('div');
    left.className = 'player-left-group';

    const dot = document.createElement('div');
    dot.className = 'status-dot';

    if (p.meta) {
      dot.style.background = p.meta.color;
    }

    const name = document.createElement('span');
    name.className = 'player-name';
    name.innerText = p.name;

    left.appendChild(dot);
    left.appendChild(name);
    li.appendChild(left);

    if (p.meta) {
      const badge = document.createElement('span');

      badge.className = 'player-badge';
      badge.style.color = p.meta.color;
      badge.style.border = '1px solid ' + p.meta.color;
      badge.innerText = p.meta.label;

      li.appendChild(badge);
    }

    playerListUl.appendChild(li);
  });

  countBadge.innerText = filter
    ? visible + ' / ' + rosterCache.length + ' ONLINE'
    : rosterCache.length + ' ONLINE';

  if (visible === 0) {
    const empty = document.createElement('li');

    empty.style.color = '#63758b';
    empty.style.padding = '15px';
    empty.innerText = 'No matching players found.';

    playerListUl.appendChild(empty);
  }
}

searchBar.addEventListener('input', (e) => {
  renderRoster(e.target.value.trim().toLowerCase());
});

function send() {
  const val = input.value.trim();

  if (!val) return;

  socket.emit('uiCommand', val);

  input.value = '';
  input.focus();
}

button.addEventListener('click', send);

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') send();
});
</script>

</body>
</html>
  `);
});

// --------------------------------------------------
// DASHBOARD HELPERS
// --------------------------------------------------

function uiLog(text, type = 'srv') {
  io.emit('botLog', { text, type });
}

function broadcastLivePlayers() {
  if (!bot || !bot.players) return;

  const list = Object.keys(bot.players)
    .sort()
    .map(name => ({
      name,
      meta: HIGHLIGHTED_PLAYERS[name.toLowerCase()] || null
    }));

  io.emit('updatePlayerList', list);
}

function broadcastDiagnostics() {
  if (!bot || !isFullyLoaded || isShiftingServers) return;

  const hp = Number(bot.health || 0).toFixed(1);
  const food = bot.food ?? 0;
  const p = bot.entity?.position;

  const coords = p
    ? `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`
    : '0.0, 0.0, 0.0';

  io.emit('updateDiagnostics', {
    health: hp,
    food,
    coords
  });
}

function stopLoops() {
  if (diagnosticsTimer) {
    clearInterval(diagnosticsTimer);
    diagnosticsTimer = null;
  }
}

function startLoops() {
  stopLoops();

  diagnosticsTimer = setInterval(
    broadcastDiagnostics,
    3000
  );
}

// --------------------------------------------------
// MINEFLAYER CONNECTION / DASHBOARD CONTROL
// --------------------------------------------------

function publishBotControlState() {
  io.emit('botControlState', { running: !botManuallyStopped && Boolean(bot) });
}

function stopBotFromDashboard() {
  botManuallyStopped = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  stopLoops(); isFullyLoaded = false; isShiftingServers = false;
  io.emit('updatePlayerList', []);
  const currentBot = bot;
  if (currentBot) {
    try { currentBot.quit('Stopped from dashboard'); }
    catch (err) { try { currentBot._client?.end('Stopped from dashboard'); } catch (_) {} }
  }
  bot = null;
  publishBotControlState();
  uiLog('[System] Bot stopped from dashboard.', 'sys');
}

function startBotFromDashboard() {
  if (bot && !botManuallyStopped) { publishBotControlState(); return; }
  botManuallyStopped = false;
  createBotInstance(); publishBotControlState();
  uiLog('[System] Start requested from dashboard.', 'sys');
}

function createBotInstance() {
  if (botManuallyStopped) return;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  uiLog(
    `[System] Connecting to ${config.host}...`,
    'sys'
  );

  loginDispatched = false;
  isShiftingServers = false;
  isFullyLoaded = false;

  stopLoops();

  bot = mineflayer.createBot(config);

  bot._client.on('state', (newState) => {
    if (newState === 'configuration') {
      isShiftingServers = true;
      isFullyLoaded = false;

      stopLoops();
    }

    if (newState === 'play') {
      isShiftingServers = false;

      if (typeof bot.clearControlStates === 'function') {
        bot.clearControlStates();
      }
    }
  });

  bot.on('playerJoined', () => {
    if (isFullyLoaded) broadcastLivePlayers();
  });

  bot.on('playerLeft', () => {
    if (isFullyLoaded) broadcastLivePlayers();
  });

  bot.on('messagestr', (message, pos) => {
    if (pos === 'game_info') return;

    const cleanMsg = message.trim();

    if (cleanMsg.length > 0) {
      uiLog(`[Server] ${cleanMsg}`, 'srv');
    }

    if (cleanMsg.includes('Connecting to 8b8t')) {
      isShiftingServers = true;
      isFullyLoaded = false;

      stopLoops();
    }

    // Server password is supplied through MC_PASSWORD; never hardcode it here.
    const loginPrompt = /\/login\b|please\s+login|login\s+required|session\s+has\s+been\s+continued|password/i.test(cleanMsg);

    if (
      !isShiftingServers &&
      !loginDispatched &&
      MC_PASSWORD &&
      loginPrompt
    ) {
      loginDispatched = true;

      setTimeout(() => {
        if (
          bot &&
          bot._client?.state === 'play' &&
          !isShiftingServers
        ) {
          bot.chat(`/login ${MC_PASSWORD}`);
          uiLog('[Login] Login command sent.', 'sys');
        }
      }, 3500);
    }
  });

  bot.on('health', () => {
    if (isShiftingServers) return;

    if (!isFullyLoaded) {
      isFullyLoaded = true;

      broadcastLivePlayers();
      broadcastDiagnostics();
      startLoops();

      uiLog(
        '[Status] Bot connected to the server!',
        'status'
      );
    }
  });

  bot.on('error', (err) => {
    uiLog(`[Error] ${err.message}`, 'err');
  });

  bot.on('kicked', (reason) => {
    uiLog(`[Kicked] ${String(reason)}`, 'err');
  });

  bot.on('end', (reason) => {
    uiLog(
      `[Disconnect] Connection closed: ${String(reason)}`,
      'err'
    );

    isFullyLoaded = false;
    isShiftingServers = false;

    io.emit('updatePlayerList', []);

    stopLoops();

    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    publishBotControlState();
    if (botManuallyStopped) return;
    reconnectTimer = setTimeout(() => {
      if (!botManuallyStopped) createBotInstance();
    }, 15000);
  });
}

// --------------------------------------------------
// SOCKET.IO
// --------------------------------------------------

io.use((socket, next) => {
  const cookieHeader = socket.handshake.headers.cookie || '';
  const sessionCookie = cookieHeader.split(';').map(value => value.trim())
    .find(value => value.startsWith(SESSION_COOKIE + '='));
  const token = sessionCookie ? decodeURIComponent(sessionCookie.slice(SESSION_COOKIE.length + 1)) : '';
  if (safeCompare(token, SESSION_TOKEN)) return next();
  return next(new Error('Authentication required'));
});

io.on('connection', (socket) => {
  uiLog('[Dashboard] Web client connected.', 'sys');
  socket.emit('botControlState', { running: !botManuallyStopped && Boolean(bot) });
  socket.on('botControl', action => {
    if (action === 'start') {
      startBotFromDashboard(); socket.emit('botControlResult', { message: 'Start command accepted.' });
    } else if (action === 'stop') {
      stopBotFromDashboard(); socket.emit('botControlResult', { message: 'Stop command accepted.' });
    }
  });

  if (isFullyLoaded && bot) {
    broadcastLivePlayers();
    broadcastDiagnostics();
  }

  socket.on('uiCommand', (cmd) => {
    if (
      typeof cmd !== 'string' ||
      !cmd.trim() ||      cmd.length > 256
    ) {
      return;
    }

    if (
      bot &&
      bot._client?.state === 'play' &&
      !isShiftingServers
    ) {
      bot.chat(cmd.trim());
    } else {
      socket.emit('botLog', {
        text: '[System] Bot is not connected.',
        type: 'err'
      });
    }
  });
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

server.listen(PORT, () => {
  console.log('==============================================');
  console.log(' REAPER // CYBERCORE DASHBOARD STARTED');
  console.log(` Website: http://localhost:${PORT}`);
  console.log(' Login:   Open the URL and enter your password');
  console.log('==============================================');

  botManuallyStopped = false;
  createBotInstance();
  publishBotControlState();
});