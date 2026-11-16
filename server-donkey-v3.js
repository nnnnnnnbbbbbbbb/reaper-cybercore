// ================= CONFIGURATION =================\n// Updated from the 16 Nov 2026 source: includes horse-window packet detection.
// Set your account password here locally.
// IMPORTANT: Do not commit a real password to a public GitHub repository.
const PASSWORD = 'CHANGE_ME';

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

let bot = null;
let loginDispatched = false;
let isShiftingServers = false;
let isFullyLoaded = false;
let isRunningTask = false;
let abortFlag = false;
let reconnectTimer = null;
let intentionalStop = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function uiLog(message, type = 'srv') {
  console.log(message);
  io.emit('botLog', { text: String(message), type });
}

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>8b8t Bot Live Minimal Console</title>
      <style>
        body {
          background: #0c0f12;
          color: #a5acb6;
          font-family: 'Courier New', monospace;
          margin: 20px;
        }

        h2 {
          color: #52a3ff;
          margin-bottom: 5px;
        }

        .action-bar {
          display: flex;
          gap: 10px;
          margin-bottom: 15px;
        }

        .action-btn {
          flex: 1;
          padding: 12px 16px;
          font-family: inherit;
          font-weight: bold;
          font-size: 14px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          color: #fff;
        }

        .btn-put { background: #1a73e8; }
        .btn-put:hover { background: #1557b0; }
        .btn-take { background: #0f9d58; }
        .btn-take:hover { background: #0b8043; }
        .btn-stop { background: #db4437; }
        .btn-stop:hover { background: #b33227; }

        #console {
          background: #050709;
          border: 1px solid #1a222d;
          padding: 15px;
          height: 400px;
          overflow-y: auto;
          border-radius: 5px;
          box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.8);
        }

        .log {
          margin: 4px 0;
          line-height: 1.4;
          font-size: 14px;
          overflow-wrap: anywhere;
        }

        .sys { color: #f4b400; }
        .srv { color: #a5acb6; }
        .status { color: #0f9d58; font-weight: bold; }
        .err { color: #db4437; }

        #input-container {
          display: flex;
          margin-top: 15px;
          gap: 10px;
        }

        input {
          flex: 1;
          min-width: 0;
          background: #14191f;
          border: 1px solid #2c384c;
          color: #fff;
          padding: 12px;
          font-family: inherit;
          font-size: 14px;
          border-radius: 4px;
          outline: none;
        }

        input:focus { border-color: #52a3ff; }

        #sendBtn {
          background: #52a3ff;
          color: #0c0f12;
          border: none;
          padding: 0 25px;
          font-family: inherit;
          font-weight: bold;
          cursor: pointer;
          border-radius: 4px;
          font-size: 14px;
        }

        #sendBtn:hover { background: #358eff; }

        @media (max-width: 650px) {
          .action-bar,
          #input-container {
            flex-direction: column;
          }

          #sendBtn { padding: 12px; }
        }
      </style>
    </head>

    <body>
      <h2>🤖 8b8t Minimal Interface (deadly_boxer)</h2>

      <p style="color:#6272a4;margin-top:0;">
        Control donkey chest storage or send chat/commands directly into the server stream.
      </p>

      <div class="action-bar">
        <button class="action-btn btn-put" onclick="sendAction('deposit')">
          Put Items In Donkey
        </button>

        <button class="action-btn btn-take" onclick="sendAction('withdraw')">
          Take Items Out Donkey
        </button>

        <button class="action-btn btn-stop" onclick="sendAction('forceStop')">
          FORCE STOP
        </button>
      </div>

      <div id="console"></div>

      <div id="input-container">
        <input
          type="text"
          id="cmdInput"
          placeholder="Send chat message or execute server command..."
          autocomplete="off"
        >
        <button id="sendBtn">Execute</button>
      </div>

      <script src="/socket.io/socket.io.js"></script>
      <script>
        const socket = io();
        const consoleDiv = document.getElementById('console');
        const input = document.getElementById('cmdInput');
        const button = document.getElementById('sendBtn');

        socket.on('botLog', (data) => {
          const logLine = document.createElement('div');
          logLine.className = 'log ' + data.type;
          logLine.textContent = data.text;
          consoleDiv.appendChild(logLine);
          consoleDiv.scrollTop = consoleDiv.scrollHeight;
        });

        function sendAction(actionName) {
          socket.emit('botAction', actionName);
        }

        function transmitInput() {
          const value = input.value.trim();
          if (!value) return;

          socket.emit('uiCommand', value);
          input.value = '';
        }

        button.addEventListener('click', transmitInput);

        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') transmitInput();
        });
      </script>
    </body>
    </html>
  `);
});

// Find the nearest donkey or mule within five blocks.
function getNearestDonkey() {
  if (!bot || !bot.entities || !bot.entity) return null;

  return bot.nearestEntity((entity) => {
    const name = (entity.name || '').toLowerCase();

    return (
      (name === 'donkey' || name === 'mule') &&
      entity.position.distanceTo(bot.entity.position) < 5
    );
  });
}

// Set the sneak state.
function setServerSneak(enabled) {
  if (!bot || typeof bot.setControlState !== 'function') return;
  bot.setControlState('sneak', enabled);
}

// Interact with the selected donkey.
function interactWithDonkey(donkey) {
  if (!bot || !donkey) {
    throw new Error('Cannot interact: bot or donkey is unavailable.');
  }

  bot.activateEntity(donkey);
}

// Find an empty slot in the requested slot range.
function findEmptySlot(window, start, end) {
  for (let slot = start; slot < end; slot++) {
    if (!window.slots[slot]) return slot;
  }

  return null;
}

async function runDonkeyChestTask(mode) {
  if (
    !bot ||
    !bot._client ||
    bot._client.state !== 'play' ||
    isShiftingServers ||
    !isFullyLoaded
  ) {
    uiLog('[Donkey] Bot is not fully loaded in the main server yet.', 'err');
    return;
  }

  if (isRunningTask) {
    uiLog('[Donkey] A task is already running. Press FORCE STOP first.', 'err');
    return;
  }

  if (mode !== 'deposit' && mode !== 'withdraw') {
    uiLog('[Donkey] Unknown storage action.', 'err');
    return;
  }

  isRunningTask = true;
  abortFlag = false;

  let window = null;

  try {
    const donkey = getNearestDonkey();

    if (!donkey) {
      throw new Error('No donkey or mule found within 5 blocks.');
    }

    bot.clearControlStates();
    setServerSneak(true);
    await sleep(150);

    if (abortFlag) return;

    await bot.lookAt(
      donkey.position.offset(0, donkey.height * 0.85, 0),
      true
    );

    await sleep(150);

    if (abortFlag) return;

    uiLog('[Donkey] Sneaking and interacting with nearest donkey...', 'sys');

    const windowPromise = new Promise((resolve, reject) => {
      let fallbackTimer = null;
      let settled = false;
      const seenPackets = [];
      const client = bot._client;

      const onAnyPacket = (data, meta) => {
        const packetName = meta && typeof meta.name === 'string'
          ? meta.name
          : '';

        if (
          packetName &&
          /window|screen|horse|mount/i.test(packetName)
        ) {
          seenPackets.push(packetName);
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        if (fallbackTimer) clearTimeout(fallbackTimer);
        bot.removeListener('windowOpen', onWindowOpen);

        if (client) {
          client.removeListener('open_horse_window', onHorsePacket);
          client.removeListener('mount_screen_open', onHorsePacket);
          client.removeListener('packet', onAnyPacket);
        }
      };

      const finish = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;

        const packetDetails = seenPackets.length
          ? ` Saw related packets: ${seenPackets.join(', ')}.`
          : ' No related window/horse packets were observed.';

        cleanup();
        reject(
          new Error(
            'Timed out waiting for donkey chest to open. Check that the donkey has a chest equipped and is not blocked.' +
            packetDetails
          )
        );
      }, 5000);

      function onWindowOpen(openedWindow) {
        finish(openedWindow);
      }

      function onHorsePacket(packet) {
        // Give Mineflayer time to construct currentWindow from the packet.
        setTimeout(() => {
          if (settled) return;

          if (bot.currentWindow) {
            finish(bot.currentWindow);
          } else {
            uiLog(
              `[Donkey] Horse-window packet received (ID: ${packet.windowId ?? 'unknown'}), but Mineflayer has not created currentWindow yet.`,
              'err'
            );
          }
        }, 150);
      }

      bot.once('windowOpen', onWindowOpen);

      if (client) {
        client.on('packet', onAnyPacket);
        client.once('open_horse_window', onHorsePacket);
        client.once('mount_screen_open', onHorsePacket);
      }

      uiLog('[Donkey] Sneaking and interacting with the donkey...', 'sys');
      interactWithDonkey(donkey);

      fallbackTimer = setTimeout(() => {
        if (!abortFlag && !bot.currentWindow && !settled) {
          uiLog('[Donkey] Retrying interaction...', 'sys');
          setServerSneak(true);

          try {
            interactWithDonkey(donkey);
          } catch (error) {
            uiLog(`[Donkey] Retry interaction failed: ${error.message}`, 'err');
          }
        }
      }, 1800);
    });

    window = await windowPromise;
    await sleep(250);

    if (abortFlag) return;

    if (!window || !Array.isArray(window.slots)) {
      throw new Error('The server opened a horse screen, but no usable inventory window was created.');
    }

    uiLog(
      `[Donkey] Chest opened! (Type: ${window.type}, Slots: ${window.slots.length})`,
      'status'
    );

    // Donkey inventory: slot 0 = saddle, slot 1 = armor/carpet,
    // slots 2 through inventoryStart - 1 = chest storage.
    const chestStart = 2;
    const chestEnd = window.inventoryStart;

    if (
      typeof chestEnd !== 'number' ||
      chestEnd <= chestStart
    ) {
      throw new Error('Opened donkey menu, but it has no chest storage.');
    }

    if (mode === 'deposit') {
      uiLog('[Donkey] Putting items from bot inventory into donkey chest...', 'sys');

      const playerItems = window.items().filter(
        (item) => item.slot >= window.inventoryStart
      );

      if (playerItems.length === 0) {
        uiLog('[Donkey] Bot inventory is already empty.', 'sys');
      }

      for (const item of playerItems) {
        if (abortFlag) break;

        const emptySlot = findEmptySlot(window, chestStart, chestEnd);

        if (emptySlot === null) {
          uiLog('[Donkey] Donkey chest is full.', 'sys');
          break;
        }

        await bot.moveSlotItem(item.slot, emptySlot);
        await sleep(220);
      }

      if (!abortFlag) {
        uiLog('[Donkey] Finished putting items into donkey chest.', 'status');
      }
    }

    if (mode === 'withdraw') {
      uiLog('[Donkey] Taking items out of donkey chest...', 'sys');

      const chestItems = window.items().filter(
        (item) => item.slot >= chestStart && item.slot < chestEnd
      );

      if (chestItems.length === 0) {
        uiLog('[Donkey] Donkey chest is already empty.', 'sys');
      }

      for (const item of chestItems) {
        if (abortFlag) break;

        const emptyPlayerSlot = findEmptySlot(
          window,
          window.inventoryStart,
          window.slots.length
        );

        if (emptyPlayerSlot === null) {
          uiLog('[Donkey] Bot inventory is full.', 'sys');
          break;
        }

        await bot.moveSlotItem(item.slot, emptyPlayerSlot);
        await sleep(220);
      }

      if (!abortFlag) {
        uiLog('[Donkey] Finished taking items out of donkey chest.', 'status');
      }
    }

    await sleep(250);
  } catch (error) {
    uiLog(`[Donkey Error] ${error.message}`, 'err');
  } finally {
    if (window && bot && bot.currentWindow === window) {
      try {
        window.close();
      } catch (closeError) {
        uiLog(`[Donkey] Could not close window: ${closeError.message}`, 'err');
      }
    }

    setServerSneak(false);
    isRunningTask = false;
  }
}

function forceStopTasks() {
  abortFlag = true;

  if (bot) {
    setServerSneak(false);

    if (typeof bot.clearControlStates === 'function') {
      bot.clearControlStates();
    }

    if (bot.currentWindow) {
      try {
        bot.closeWindow(bot.currentWindow);
      } catch (error) {
        uiLog(`[FORCE STOP] Window close failed: ${error.message}`, 'err');
      }
    }
  }

  uiLog(
    '[FORCE STOP] Cancellation requested, crouch released, and open chest closed.',
    'err'
  );
}

function createBotInstance() {
  intentionalStop = false;
  loginDispatched = false;
  isShiftingServers = false;
  isFullyLoaded = false;
  isRunningTask = false;
  abortFlag = true;

  uiLog(
    `[System] Routing 1.21.11 proxy tunnel to ${config.host} as ${config.username}...`,
    'sys'
  );

  bot = mineflayer.createBot(config);

  bot._client.on('state', (newState, oldState) => {
    uiLog(
      `[Protocol State] Proxy network shift: ${oldState} -> ${newState}`,
      'sys'
    );

    if (newState === 'configuration') {
      isShiftingServers = true;
      isFullyLoaded = false;

      uiLog(
        '[Protocol Control] Freeze engaged for version 1.21.11 server jump...',
        'sys'
      );
    }

    if (newState === 'play') {
      isShiftingServers = false;

      if (bot.entity && bot.entity.velocity) {
        bot.entity.velocity.set(0, 0, 0);
      }

      if (typeof bot.clearControlStates === 'function') {
        bot.clearControlStates();
      }
    }
  });

  bot.on('messagestr', (message, messagePosition) => {
    if (messagePosition === 'game_info') return;

    const cleanMsg = message.trim();

    if (cleanMsg.length > 0) {
      uiLog(`[Server] ${cleanMsg}`, 'srv');
    }

    if (cleanMsg.includes('Connecting to 8b8t')) {
      isShiftingServers = true;
      isFullyLoaded = false;

      uiLog('[Status] Proxy transition broadcast caught.', 'sys');
    }

    if (
      !isShiftingServers &&
      !loginDispatched &&
      (
        cleanMsg.includes('/login') ||
        cleanMsg.includes('session has been continued')
      )
    ) {
      loginDispatched = true;

      uiLog(
        '[Lobby] Connection confirmed. Checking password configuration...',
        'sys'
      );

      setTimeout(() => {
        if (
          bot &&
          bot._client &&
          bot._client.state === 'play' &&
          !isShiftingServers
        ) {
          if (!PASSWORD || PASSWORD === 'CHANGE_ME') {
            uiLog(
              '[Lobby] Set PASSWORD at the top of server-donkey.js before running.',
              'err'
            );
            return;
          }

          bot.chat(`/login ${PASSWORD}`);
          uiLog('[Lobby] Login command sent.', 'sys');
        }
      }, 3500);
    }
  });

  bot.on('health', () => {
    if (isShiftingServers) return;

    if (!isFullyLoaded) {
      isFullyLoaded = true;

      const currentHealth =
        bot.health !== undefined && bot.health !== null
          ? bot.health.toFixed(1)
          : 'Unknown';

      const currentFood =
        bot.food !== undefined && bot.food !== null
          ? bot.food
          : 'Unknown';

      uiLog(
        `[Status] SUCCESS! Bot standing inside 8b8t main server! HP: ${currentHealth} | Hunger: ${currentFood}`,
        'status'
      );
    }
  });

  bot.on('error', (error) => {
    uiLog(`[Error] ${error.message || error}`, 'err');
  });

  bot.on('kicked', (reason) => {
    uiLog(`[Kicked] ${reason}`, 'err');
  });

  bot.on('end', (reason) => {
    uiLog(`[Disconnect] Pipeline closed: ${reason}`, 'err');
    forceStopTasks();

    if (intentionalStop) return;

    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(createBotInstance, 15000);
  });
}

io.on('connection', (socket) => {
  socket.on('uiCommand', (inputText) => {
    if (typeof inputText !== 'string' || inputText.length > 256) {
      return;
    }

    if (
      bot &&
      bot._client &&
      bot._client.state === 'play' &&
      !isShiftingServers
    ) {
      bot.chat(inputText);
      uiLog(`[Sent Chat] ${inputText}`, 'sys');
    } else {
      uiLog('[Command] Bot is not ready to receive commands.', 'err');
    }
  });

  socket.on('botAction', (actionName) => {
    if (actionName === 'deposit') {
      runDonkeyChestTask('deposit');
    } else if (actionName === 'withdraw') {
      runDonkeyChestTask('withdraw');
    } else if (actionName === 'forceStop') {
      forceStopTasks();
    }
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('======================================================');
  console.log(`[Web Server] Running live at: http://localhost:${PORT}`);
  console.log('======================================================');
  console.log('');

  createBotInstance();
});