'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

// ======================================================
// CONFIGURATION
// ======================================================

const CONFIG = {
  host: '8b8t.me',
  port: 25565,
  username: 'deadly_boxer',
  version: '1.21.10',

  owners: ['Doraemon073', 'FlameBit', 'DeadlyNyxan'],

  antiAfk: true,
  restartDelay: 5000,
  messageDelay: 1200,

  stateFile: path.join(__dirname, 'dupe_state.json')
};

// Set MC_PASSWORD in your environment or .env file.
// Do not put your real password directly in this source file.
const PASSWORD = process.env.MC_PASSWORD;

if (!PASSWORD || !PASSWORD.trim()) {
  console.error('[FATAL] MC_PASSWORD is missing. Set it in your environment or .env file.');
  process.exit(1);
}

// ======================================================
// SETTINGS
// ======================================================

const DEFAULT_CFG = {
  prepMs: 5000,
  quitDelayMs: 1000,
  range: 12
};

const LIMITS = {
  prepMs: [0, 60000],
  quitDelayMs: [0, 30000],
  range: [2, 32]
};

const MOUNTS = new Set(['donkey', 'mule', 'llama', 'trader_llama']);

// ======================================================
// STATE MANAGEMENT
// ======================================================

function validateConfig(data) {
  const result = { ...DEFAULT_CFG };

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return result;
  }

  for (const key of Object.keys(DEFAULT_CFG)) {
    const value = Number(data[key]);
    const [min, max] = LIMITS[key];

    if (Number.isFinite(value) && value >= min && value <= max) {
      result[key] = Math.round(value);
    }
  }

  return result;
}

function loadConfig() {
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG.stateFile, 'utf8'));
    console.log('[CONFIG] Previous settings loaded.');
    return validateConfig(data);
  } catch {
    console.log('[CONFIG] Using default settings.');
    return { ...DEFAULT_CFG };
  }
}

let cfg = loadConfig();

function saveConfig() {
  try {
    const temporaryFile = CONFIG.stateFile + '.tmp';

    fs.writeFileSync(temporaryFile, JSON.stringify(cfg, null, 2), 'utf8');
    fs.renameSync(temporaryFile, CONFIG.stateFile);

    console.log('[CONFIG] Settings saved.');
  } catch (error) {
    console.error('[CONFIG] Save failed:', error.message);
  }
}

// ======================================================
// BOT INITIALIZATION
// ======================================================

console.log('========================================');
console.log('             REPEARDUPE BOT');
console.log('========================================');
console.log('[INIT] Username:', CONFIG.username);
console.log('[INIT] Server:', CONFIG.host);
console.log('[INIT] Minecraft version:', CONFIG.version);

const bot = mineflayer.createBot({
  host: CONFIG.host,
  port: CONFIG.port,
  username: CONFIG.username,
  version: CONFIG.version
});

bot.loadPlugin(pathfinder);

// ======================================================
// RUNTIME STATE
// ======================================================

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let ready = false;
let spawned = false;
let busy = false;
let registerSent = false;
let loginStarted = false;
let shuttingDown = false;
let loginTimer = null;

const outQueue = [];
let draining = false;

function isConnected() {
  return !shuttingDown && Boolean(bot.player);
}

// ======================================================
// SAFE CHAT
// ======================================================

function chat(message) {
  if (!isConnected()) {
    console.log('[CHAT] Cannot send message: bot is disconnected.');
    return false;
  }

  try {
    bot.chat(String(message));
    return true;
  } catch (error) {
    console.error('[CHAT ERROR]', error.message);
    return false;
  }
}

// ======================================================
// MESSAGE QUEUE
// ======================================================

async function drainQueue() {
  if (draining) return;

  draining = true;

  try {
    while (outQueue.length > 0) {
      if (!isConnected()) break;

      const message = outQueue.shift();

      try {
        bot.chat(message);
      } catch (error) {
        console.error('[QUEUE ERROR]', error.message);
      }

      await sleep(CONFIG.messageDelay);
    }
  } finally {
    draining = false;

    if (outQueue.length > 0 && isConnected()) {
      setImmediate(() => {
        drainQueue().catch(error => {
          console.error('[QUEUE ERROR]', error.message);
        });
      });
    }
  }
}

function queueChat(message) {
  if (outQueue.length >= 100) {
    console.log('[QUEUE] Queue limit reached.');
    return;
  }

  outQueue.push(String(message).slice(0, 250));

  drainQueue().catch(error => {
    console.error('[QUEUE ERROR]', error.message);
  });
}

function say(player, messages) {
  for (const message of [].concat(messages)) {
    queueChat(`/msg ${player} ${message}`);
  }
}

// ======================================================
// RESTART MANAGEMENT
// ======================================================

function restart(reason) {
  if (shuttingDown) return;

  shuttingDown = true;
  ready = false;

  console.log('');
  console.log('[RESTART] Reason:', reason);
  console.log(`[RESTART] Exiting in ${CONFIG.restartDelay / 1000} seconds.`);

  if (loginTimer) clearTimeout(loginTimer);

  try {
    bot.pathfinder.stop();
  } catch {}

  setTimeout(() => process.exit(1), CONFIG.restartDelay);
}

// ======================================================
// CONNECTION EVENTS
// ======================================================

bot.on('login', () => {
  console.log('[CONNECTION] Protocol login successful.');
});

bot.on('spawn', () => {
  console.log('[CONNECTION] Bot spawned.');
  spawned = true;

  try {
    const movements = new Movements(bot);
    movements.canDig = false;
    movements.allow1by1towers = false;
    movements.scafoldingBlocks = [];

    bot.pathfinder.setMovements(movements);
    console.log('[PATHFINDER] Movement settings configured.');
  } catch (error) {
    console.error('[PATHFINDER ERROR]', error.message);
  }

  // A later respawn should not send the login command again.
  if (loginStarted) {
    ready = true;
    return;
  }

  loginStarted = true;

  loginTimer = setTimeout(() => {
    if (!spawned || shuttingDown) return;

    console.log('[AUTH] Sending login command.');
    chat(`/login ${PASSWORD}`);

    loginTimer = setTimeout(() => {
      if (!spawned || shuttingDown) return;

      ready = true;
      console.log('[AUTH] Login sequence completed.');
      console.log('[BOT] Ready to receive owner commands.');
      console.log('[BOT] Type *help for available commands.');
    }, 4000);
  }, 5000);
});

bot.on('messagestr', line => {
  console.log('[SERVER]', line);

  if (
    !registerSent &&
    /\/register/i.test(line) &&
    !/already|registered|ya est/i.test(line)
  ) {
    registerSent = true;
    console.log('[AUTH] Registration request detected.');
    chat(`/register ${PASSWORD} ${PASSWORD}`);
  }

  handleWhisper(line);
});

bot.on('kicked', reason => {
  console.log(
    '[KICKED]',
    typeof reason === 'string' ? reason : JSON.stringify(reason)
  );
});

bot.on('error', error => {
  console.error('[BOT ERROR]', error.message || error);

  if (!spawned) {
    restart('Connection error before spawn');
  }
});

bot.on('end', reason => {
  spawned = false;
  ready = false;
  restart('Connection ended: ' + (reason || 'Unknown reason'));
});

// ======================================================
// ENTITY DETECTION
// ======================================================

function findMount() {
  if (!bot.entity || !bot.entity.position) return null;

  const position = bot.entity.position;
  let closest = null;
  let closestDistance = Infinity;

  for (const entity of Object.values(bot.entities)) {
    if (
      !entity ||
      entity === bot.entity ||
      !MOUNTS.has(entity.name) ||
      !entity.position
    ) {
      continue;
    }

    const distance = entity.position.distanceTo(position);

    if (
      Number.isFinite(distance) &&
      distance <= cfg.range &&
      distance < closestDistance
    ) {
      closest = entity;
      closestDistance = distance;
    }
  }

  return closest;
}

// ======================================================
// TIMEOUT HELPER
// ======================================================

function withTimeout(promise, ms, label) {
  let timer;

  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Operation timed out: ${label}`));
    }, ms);
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

// ======================================================
// MOUNT EVENT
// ======================================================

function mountEntity(entity) {
  return new Promise((resolve, reject) => {
    let finished = false;

    const cleanup = () => {
      clearTimeout(timer);
      bot.removeListener('mount', onMount);
    };

    const finish = error => {
      if (finished) return;
      finished = true;
      cleanup();

      if (error) reject(error);
      else resolve();
    };

    const onMount = () => finish();

    const timer = setTimeout(() => {
      finish(new Error('Mount timed out. Check whether the entity is rideable.'));
    }, 5000);

    bot.once('mount', onMount);

    try {
      bot.mount(entity);
    } catch (error) {
      finish(error);
    }
  });
}

// ======================================================
// DISMOUNT
// ======================================================

function dismountBot() {
  if (!bot.vehicle) return false;

  try {
    bot.dismount();
    return true;
  } catch (error) {
    console.error('[MOUNT ERROR]', error.message);
    return false;
  }
}

// ======================================================
// STATUS
// ======================================================

function statusText() {
  if (!bot.entity) return 'Bot has not spawned yet.';

  const position = bot.entity.position;
  const nearby = findMount();
  const vehicle = bot.vehicle ? bot.vehicle.name : 'none';

  const mountStatus = nearby
    ? `${nearby.name} (${nearby.position.distanceTo(position).toFixed(1)} blocks)`
    : 'none';

  return [
    `Ready: ${ready}`,
    `Busy: ${busy}`,
    `Mounted: ${vehicle}`,
    `Nearby mount: ${mountStatus}`,
    `Position: ${Math.round(position.x)}, ${Math.round(position.y)}, ${Math.round(position.z)}`,
    `Search range: ${cfg.range}`,
    `Queue: ${outQueue.length}`
  ].join(' | ');
}

// ======================================================
// COMMAND HANDLER
// ======================================================

function handle(player, command, args) {
  if (!ready) {
    return say(player, 'Bot is not ready.');
  }

  switch (command) {
    case 'help':
      return say(player, [
        'Available commands:',
        '*help | *tpa | *dupe | *dismount | *kill | *status',
        '*cfg [prepMs|quitDelayMs|range] [value]'
      ]);

    case 'tpa':
      queueChat(`/tpa ${player}`);
      return say(player, 'Teleport request sent.');

    case 'dupe':
      return doDupe(player);

    case 'dismount': {
      if (!bot.vehicle) {
        return say(player, 'The bot is not mounted.');
      }

      dismountBot();
      return say(player, 'Dismount requested.');
    }

    case 'kill':
      chat('/kill');
      return say(player, 'Kill command sent.');

    case 'status':
      return say(player, statusText());

    case 'cfg': {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const key = parts[0];

      if (!key) {
        return say(player, `Current configuration: ${JSON.stringify(cfg)}`);
      }

      if (!Object.prototype.hasOwnProperty.call(DEFAULT_CFG, key)) {
        return say(
          player,
          `Unknown setting. Available: ${Object.keys(DEFAULT_CFG).join(', ')}`
        );
      }

      const value = Number(parts[1]);
      const [min, max] = LIMITS[key];

      if (!Number.isFinite(value) || value < min || value > max) {
        return say(player, `${key} must be between ${min} and ${max}.`);
      }

      cfg[key] = Math.round(value);
      saveConfig();

      return say(player, `Configuration updated: ${JSON.stringify(cfg)}`);
    }

    default:
      return say(player, 'Unknown command. Type *help.');
  }
}

// ======================================================
// MOUNT / DISCONNECT OPERATION
// ======================================================

async function doDupe(player) {
  if (busy) {
    return say(player, 'Bot is busy. Please wait.');
  }

  if (!ready || !bot.entity) {
    return say(player, 'Bot is not ready.');
  }

  busy = true;
  let shouldDisconnect = false;

  try {
    console.log(`[OPERATION] Request received from ${player}.`);

    let mount = findMount();

    if (!mount) {
      return say(
        player,
        `No donkey, mule or llama found within ${cfg.range} blocks.`
      );
    }

    console.log(`[ENTITY] Found ${mount.name}, ID: ${mount.id}`);

    if (bot.vehicle) {
      dismountBot();
      await sleep(500);
    }

    // Navigate to the entity when it is not already nearby.
    if (mount.position.distanceTo(bot.entity.position) > 2.5) {
      console.log('[PATHFINDER] Navigation requested.');

      const position = mount.position;
      const navigation = bot.pathfinder.goto(
        new goals.GoalNear(position.x, position.y, position.z, 2)
      );

      try {
        await withTimeout(navigation, 20000, 'navigation');
      } catch (error) {
        bot.pathfinder.stop();
        throw error;
      }
    }

    if (!bot.entity || shuttingDown) {
      throw new Error('Bot is no longer available.');
    }

    say(player, [
      `Operation prepared. Delay: ${cfg.prepMs} ms.`,
      'Waiting before the next action.'
    ]);

    await sleep(cfg.prepMs);

    if (shuttingDown || !bot.entity) {
      throw new Error('Bot disconnected during preparation.');
    }

    mount = findMount();

    if (!mount) {
      throw new Error('Target entity is no longer nearby.');
    }

    await bot.lookAt(
      mount.position.offset(0, (mount.height || 1.4) / 2, 0),
      true
    );

    console.log('[MOUNT] Mount request initiated.');
    await mountEntity(mount);

    console.log(`[MOUNT] Mounted successfully: ${mount.name} (${mount.id})`);
    say(player, 'Mount event received successfully.');

    await sleep(cfg.quitDelayMs);

    console.log('[OPERATION] Disconnecting bot.');
    shouldDisconnect = true;

  } catch (error) {
    console.error('[OPERATION ERROR]', error.message);
    say(player, `Operation failed: ${error.message}`.slice(0, 200));

  } finally {
    busy = false;

    if (shouldDisconnect && !shuttingDown) {
      bot.quit('Operation completed');
    }
  }
}

// ======================================================
// OWNER WHISPER HANDLER
// ======================================================

function handleWhisper(line) {
  if (!ready || shuttingDown) return;

  // Chat formats vary by server. These patterns cover common formats.
  const patterns = [
    /^([A-Za-z0-9_]{3,16})\s+whispers\s*:\s*\*(dupe|tpa|kill|dismount|status|cfg|help)\b\s*(.*)$/i,
    /^\[?([A-Za-z0-9_]{3,16})\s+->\s+(?:you|me)\]?\s*:\s*\*(dupe|tpa|kill|dismount|status|cfg|help)\b\s*(.*)$/i
  ];

  let match = null;

  for (const pattern of patterns) {
    match = line.match(pattern);
    if (match) break;
  }

  if (!match) return;

  const player = match[1];
  const command = match[2].toLowerCase();
  const args = (match[3] || '').trim();

  const authorized = CONFIG.owners.some(
    owner => owner.toLowerCase() === player.toLowerCase()
  );

  if (!authorized) {
    console.log(`[SECURITY] Unauthorized command from ${player}.`);
    return;
  }

  console.log(`[COMMAND] ${player}: *${command} ${args}`);

  try {
    handle(player, command, args);
  } catch (error) {
    console.error('[COMMAND ERROR]', error.message);
  }
}

// ======================================================
// ANTI-AFK
// ======================================================

if (CONFIG.antiAfk) {
  setInterval(() => {
    if (
      !ready ||
      busy ||
      bot.vehicle ||
      !bot.entity ||
      shuttingDown
    ) {
      return;
    }

    try {
      bot.look(bot.entity.yaw + 0.4, bot.entity.pitch, true);
      bot.swingArm('right');
    } catch (error) {
      console.error('[ANTI-AFK ERROR]', error.message);
    }
  }, 45000);
}

// ======================================================
// PERIODIC STATUS
// ======================================================

setInterval(() => {
  if (!ready || shuttingDown) return;
  console.log('[STATUS]', statusText());
}, 120000);

// ======================================================
// GRACEFUL SHUTDOWN
// ======================================================

function gracefulShutdown(signal) {
  if (shuttingDown) return;

  console.log(`[SYSTEM] Received ${signal}.`);

  shuttingDown = true;
  ready = false;

  if (loginTimer) clearTimeout(loginTimer);

  try {
    bot.pathfinder.stop();
  } catch {}

  try {
    bot.quit('Process shutting down');
  } catch {}

  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ======================================================
// STARTUP COMPLETE
// ======================================================

console.log('[INIT] Event handlers registered.');
console.log('[INIT] Waiting for Minecraft connection...');