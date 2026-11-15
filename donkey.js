
'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const minecraftData = require('minecraft-data');
const {
    pathfinder,
    Movements,
    goals
} = require('mineflayer-pathfinder');

// =====================================================
// CONFIGURATION
// =====================================================

// Set your Minecraft password in this constant on your own machine.
// Do not put a real password in a public GitHub repository.
const LOGIN_PASSWORD = 'YOUR_PASSWORD_HERE';

const CONFIG = {
    host: '8b8t.me',
    port: 25565,
    username: 'deadly_boxer',
    auth: 'offline',
    version: '1.21.11',
    fakeHost: '8b8t.me',

    physicsEnabled: true,
    checkTimeoutInterval: 120000,
    hideErrors: true,

    webPort: Number(process.env.PORT || 3000),

    searchDistance: 64,
    interactionDistance: 3,

    loginCommand: `/login ${LOGIN_PASSWORD}`,

    reconnectDelay: 15000,
    windowTimeout: 12000,
    interactionAttempts: 3,
    interactionRetryDelay: 1500,
    maxConsoleLines: 500
};

// =====================================================
// WEB SERVER
// =====================================================

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let bot = null;
let connected = false;
let busy = false;
let activeWindow = null;

let movements = null;
let taskGeneration = 0;
let currentTask = 'Idle';

let loginDispatched = false;
let isShiftingServers = false;
let isFullyLoaded = false;
let manualStop = false;

let reconnectTimer = null;
let loginTimer = null;

let serverStarted = false;

// =====================================================
// UTILITIES
// =====================================================

const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

function uiLog(message, type = 'srv') {
    const time = new Date().toLocaleTimeString();

    console.log(`[${time}] ${message}`);

    io.emit('botLog', {
        time,
        text: message,
        type
    });
}

function updateStatus() {
    io.emit('botStatus', {
        connected,
        busy,
        task: currentTask
    });
}

function assertTask(id) {
    if (id !== taskGeneration) {
        throw new Error('Operation cancelled');
    }

    if (!bot || !connected || !bot.entity) {
        throw new Error('Bot disconnected');
    }
}

function isShulker(item) {
    return Boolean(
        item &&
        typeof item.name === 'string' &&
        item.name.endsWith('shulker_box')
    );
}

function distance(a, b) {
    return a.distanceTo(b);
}

// =====================================================
// INVENTORY HELPERS
// =====================================================

function getBotShulkers() {
    if (!bot) return [];

    // Player storage + hotbar only.
    // Armor and offhand excluded.

    return bot.inventory.slots
        .slice(9, 45)
        .filter(isShulker);
}

function getChestShulkers(window) {
    const containerEnd =
        Number.isInteger(window.inventoryStart)
            ? window.inventoryStart
            : window.slots.length - 36;

    return window.slots
        .slice(0, containerEnd)
        .filter(isShulker);
}

function groupShulkers(items) {
    const groups = new Map();

    for (const item of items) {
        if (!isShulker(item)) continue;

        const key = item.type;

        if (!groups.has(key)) {
            groups.set(key, {
                type: item.type,
                metadata: item.metadata ?? 0,
                count: 0
            });
        }

        groups.get(key).count += item.count;
    }

    return [...groups.values()];
}

// =====================================================
// WINDOW MANAGEMENT
// =====================================================

async function closeInventory() {
    const window = activeWindow;

    activeWindow = null;

    if (!window || !bot) return;

    try {
        await bot.closeWindow(window);
    } catch (error) {
        // The server may already have closed it.
    }
}

function waitForWindowOpen(id) {
    let handler;
    let timer;
    let cancellationTimer;

    let settled = false;

    let resolvePromise;
    let rejectPromise;

    const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });

    function cleanup() {
        clearTimeout(timer);
        clearInterval(cancellationTimer);

        if (bot && handler) {
            bot.removeListener('windowOpen', handler);
        }
    }

    function finish(error, window) {
        if (settled) return;

        settled = true;
        cleanup();

        if (error) rejectPromise(error);
        else resolvePromise(window);
    }

    handler = window => {
        finish(null, window);
    };

    bot.on('windowOpen', handler);

    timer = setTimeout(() => {
        finish(new Error('Donkey inventory opening timed out'));
    }, CONFIG.windowTimeout);

    cancellationTimer = setInterval(() => {
        if (id !== taskGeneration || !connected) {
            finish(new Error('Operation cancelled'));
        }
    }, 100);

    return {
        promise,

        cancel() {
            finish(new Error('Inventory opening cancelled'));
        }
    };
}

// =====================================================
// DONKEY SEARCH
// =====================================================

function getNearestDonkeys() {
    if (!bot || !bot.entity) return [];

    const origin = bot.entity.position;

    return Object.values(bot.entities)
        .filter(entity => {
            return (
                entity &&
                entity.name === 'donkey' &&
                entity.position &&
                distance(origin, entity.position) <=
                    CONFIG.searchDistance
            );
        })
        .sort((a, b) => {
            return (
                distance(origin, a.position) -
                distance(origin, b.position)
            );
        });
}

// =====================================================
// NAVIGATION
// =====================================================

async function navigateToDonkey(donkey, id) {
    assertTask(id);

    if (!bot.pathfinder) {
        throw new Error('Pathfinder unavailable');
    }

    if (!bot.entities[donkey.id]) {
        throw new Error('Donkey disappeared');
    }

    const pos = donkey.position;

    uiLog(
        `[NAVIGATION] Target: ${pos.x.toFixed(1)}, ` +
        `${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`,
        'sys'
    );

    await bot.pathfinder.goto(
        new goals.GoalNear(
            Math.floor(pos.x),
            Math.floor(pos.y),
            Math.floor(pos.z),
            CONFIG.interactionDistance
        )
    );

    assertTask(id);

    if (!bot.entities[donkey.id]) {
        throw new Error('Donkey disappeared during navigation');
    }

    const finalDistance = distance(
        bot.entity.position,
        donkey.position
    );

    if (finalDistance > 4) {
        throw new Error('Donkey is still too far away');
    }
}

async function findNearestReachableDonkey(id) {
    assertTask(id);

    const donkeys = getNearestDonkeys();

    if (!donkeys.length) {
        throw new Error('No nearby donkeys detected');
    }

    uiLog(
        `[SEARCH] Detected ${donkeys.length} donkey(s)`,
        'sys'
    );

    for (const donkey of donkeys) {
        assertTask(id);

        try {
            await navigateToDonkey(donkey, id);

            uiLog(
                `[SEARCH] Reachable donkey: ${donkey.id}`,
                'status'
            );

            return donkey;

        } catch (error) {
            assertTask(id);

            uiLog(
                `[SEARCH] Navigation failed: ${error.message}`,
                'err'
            );
        }
    }

    throw new Error('No reachable donkey found');
}

// =====================================================
// SNEAK + RIGHT CLICK DONKEY
// =====================================================

async function openDonkeyChest(donkey, id) {
    assertTask(id);

    if (!bot.entities[donkey.id]) {
        throw new Error('Donkey no longer exists');
    }

    const currentDistance = distance(
        bot.entity.position,
        donkey.position
    );

    if (currentDistance > CONFIG.interactionDistance + 1) {
        throw new Error('Move closer to donkey first');
    }

    await bot.lookAt(donkey.position.offset(0, 0.8, 0), true);
    assertTask(id);

    uiLog('[CHEST] One interaction only: sneak -> RIGHT-CLICK -> release sneak -> wait for GUI.', 'sys');

    let windowHandler;
    let timeoutHandle;
    let resolveWindow;
    let rejectWindow;
    let settled = false;

    const windowPromise = new Promise((resolve, reject) => {
        resolveWindow = resolve;
        rejectWindow = reject;
    });

    const cleanup = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (bot && windowHandler) {
            bot.removeListener('windowOpen', windowHandler);
        }
    };

    const finish = (error, window) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) rejectWindow(error);
        else resolveWindow(window);
    };

    windowHandler = window => {
        if (window && Array.isArray(window.slots) && window.slots.length >= 45) {
            finish(null, window);
        }
    };

    // Start listening before sending the single interaction packet.
    bot.on('windowOpen', windowHandler);

    timeoutHandle = setTimeout(() => {
        finish(new Error(
            `Donkey inventory did not open within ${CONFIG.windowTimeout / 1000}s`
        ));
    }, CONFIG.windowTimeout);

    try {
        assertTask(id);

        // Hold sneak only for the interaction itself.
        bot.setControlState('sneak', true);
        await sleep(250);
        assertTask(id);

        if (!bot.entities[donkey.id]) {
            throw new Error('Donkey disappeared before interaction');
        }

        uiLog('[CHEST] Sending ONE right-click while sneaking...', 'sys');

        // Minecraft use_entity: mouse 0 = INTERACT (right-click).
        // mouse 1 is ATTACK (left-click) and is never sent.
        bot._client.write('use_entity', {
            target: donkey.id,
            mouse: 0,
            sneaking: true
        });

        // Release sneak immediately after the one right-click.
        bot.setControlState('sneak', false);
        uiLog('[CHEST] Sneak released. Waiting for donkey GUI; no more clicks will be sent...', 'sys');

        // Wait passively for the server to open the inventory GUI.
        const window = await windowPromise;
        assertTask(id);

        if (!window || !Array.isArray(window.slots)) {
            throw new Error('No valid donkey inventory window received');
        }

        activeWindow = window;

        const containerSlots =
            Number.isInteger(window.inventoryStart)
                ? window.inventoryStart
                : window.slots.length - 36;

        if (containerSlots < 15) {
            await closeInventory();
            throw new Error(
                `Unexpected donkey inventory layout: ${window.slots.length} total slots`
            );
        }

        uiLog(
            `[CHEST] Donkey GUI opened. No additional interaction was sent. Container slots: ${containerSlots}`,
            'status'
        );

        return window;
    } catch (error) {
        uiLog(`[CHEST] Interaction failed: ${error.message}`, 'err');
        throw error;
    } finally {
        cleanup();
        if (bot) {
            try {
                bot.setControlState('sneak', false);
            } catch (_) {}
        }
    }
}

// =====================================================
// DEPOSIT SHULKERS
// =====================================================

async function depositShulkers(window, id) {
    assertTask(id);

    const groups = groupShulkers(
        getBotShulkers()
    );

    if (!groups.length) {
        uiLog('[DEPOSIT] No shulker boxes in inventory.', 'sys');
        return;
    }

    uiLog(
        `[DEPOSIT] Found ${groups.length} shulker type(s)`,
        'sys'
    );

    for (const group of groups) {
        assertTask(id);

        uiLog(
            `[DEPOSIT] Transferring ${group.count} box(es)`,
            'sys'
        );

        await window.deposit(
            group.type,
            group.metadata,
            group.count,
            null
        );

        assertTask(id);

        uiLog(
            `[DEPOSIT] Processed ${group.count} box(es)`,
            'status'
        );
    }

    uiLog('[DEPOSIT] Operation completed.', 'status');
}

// =====================================================
// WITHDRAW SHULKERS
// =====================================================

async function withdrawShulkers(window, id) {
    assertTask(id);

    const groups = groupShulkers(
        getChestShulkers(window)
    );

    if (!groups.length) {
        uiLog('[WITHDRAW] No shulker boxes in donkey chest.', 'sys');
        return;
    }

    uiLog(
        `[WITHDRAW] Found ${groups.length} shulker type(s)`,
        'sys'
    );

    for (const group of groups) {
        assertTask(id);

        uiLog(
            `[WITHDRAW] Taking ${group.count} box(es)`,
            'sys'
        );

        await window.withdraw(
            group.type,
            group.metadata,
            group.count,
            null
        );

        assertTask(id);

        uiLog(
            `[WITHDRAW] Processed ${group.count} box(es)`,
            'status'
        );
    }

    uiLog('[WITHDRAW] Operation completed.', 'status');
}

// =====================================================
// FIND DONKEY AND OPEN CHEST
// =====================================================

async function findUsableDonkeyChest(id) {
    const donkeys = getNearestDonkeys();

    if (!donkeys.length) {
        throw new Error('No nearby donkeys found');
    }

    for (const donkey of donkeys) {
        assertTask(id);

        try {
            await navigateToDonkey(donkey, id);

            assertTask(id);

            const window = await openDonkeyChest(donkey, id);

            return {
                donkey,
                window
            };

        } catch (error) {
            if (id !== taskGeneration) {
                throw error;
            }

            await closeInventory();

            uiLog(
                `[CHEST] Donkey ${donkey.id}: ${error.message}`,
                'err'
            );
        }
    }

    throw new Error('No usable donkey chest found');
}

// =====================================================
// OPERATION MANAGER
// =====================================================

async function runOperation(name, callback) {
    if (!connected || !bot || !bot.entity) {
        uiLog('[ERROR] Bot is not connected.', 'err');
        return;
    }

    if (busy) {
        uiLog('[ERROR] Another operation is running.', 'err');
        return;
    }

    busy = true;

    const id = ++taskGeneration;

    currentTask = name;

    updateStatus();

    uiLog(`[TASK] Starting ${name}`, 'sys');

    try {
        await callback(id);

        assertTask(id);

        uiLog(`[TASK] ${name} completed successfully.`, 'status');

    } catch (error) {
        uiLog(`[TASK] ${error.message}`, 'err');

    } finally {
        if (id === taskGeneration) {
            await closeInventory();

            if (bot) {
                try {
                    bot.setControlState('sneak', false);
                } catch (_) {}
            }

            busy = false;
            currentTask = 'Idle';

            updateStatus();
        }
    }
}

// =====================================================
// BUTTON ACTIONS
// =====================================================

function goNearDonkey() {
    return runOperation(
        'Go Near Donkey',
        async id => {
            const donkey = await findNearestReachableDonkey(id);

            assertTask(id);

            uiLog(
                `[NAVIGATION] Near donkey ${donkey.id}`,
                'status'
            );
        }
    );
}

function depositOperation() {
    return runOperation(
        'Deposit Shulkers',
        async id => {
            const result = await findUsableDonkeyChest(id);

            await depositShulkers(result.window, id);
        }
    );
}

function withdrawOperation() {
    return runOperation(
        'Withdraw Shulkers',
        async id => {
            const result = await findUsableDonkeyChest(id);

            await withdrawShulkers(result.window, id);
        }
    );
}

// =====================================================
// FORCE STOP
// =====================================================

async function forceStop() {
    uiLog('[FORCE STOP] Cancelling all tasks!', 'err');

    // Invalidate current operation immediately.
    taskGeneration++;

    if (bot) {
        try {
            bot.pathfinder.setGoal(null);
            bot.clearControlStates();
            bot.stopDigging();
            bot.setControlState('sneak', false);
        } catch (_) {}
    }

    busy = false;
    currentTask = 'Force Stopped';

    updateStatus();

    await closeInventory();

    uiLog(
        '[FORCE STOP] Navigation cancelled. Pending tasks invalidated.',
        'status'
    );

    currentTask = 'Idle';
    updateStatus();
}

// =====================================================
// TELEMETRY
// =====================================================

function sendTelemetry() {
    if (!bot || !connected || !bot.entity) return;

    const pos = bot.entity.position;

    io.emit('telemetry', {
        health: bot.health,
        food: bot.food,

        position: {
            x: pos.x.toFixed(1),
            y: pos.y.toFixed(1),
            z: pos.z.toFixed(1)
        }
    });
}

// =====================================================
// MINECRAFT CONNECTION
// =====================================================

function createBotInstance() {
    if (bot || manualStop) return;

    clearTimeout(reconnectTimer);
    reconnectTimer = null;

    loginDispatched = false;
    isShiftingServers = false;
    isFullyLoaded = false;

    uiLog(
        `[SYSTEM] Connecting to ${CONFIG.host}:${CONFIG.port} as ${CONFIG.username}`,
        'sys'
    );

    let thisBot;

    try {
        thisBot = mineflayer.createBot({
            host: CONFIG.host,
            port: CONFIG.port,
            username: CONFIG.username,
            auth: CONFIG.auth,
            version: CONFIG.version,
            fakeHost: CONFIG.fakeHost,
            physicsEnabled: CONFIG.physicsEnabled,
            checkTimeoutInterval: CONFIG.checkTimeoutInterval,
            hideErrors: CONFIG.hideErrors
        });
    } catch (error) {
        uiLog(`[CONNECT ERROR] ${error.message}`, 'err');
        scheduleReconnect();
        return;
    }

    bot = thisBot;

    thisBot.loadPlugin(pathfinder);

    // -----------------------------------------
    // PROXY STATE
    // -----------------------------------------

    thisBot._client.on('state', (newState, oldState) => {
        if (bot !== thisBot) return;

        uiLog(
            `[PROTOCOL] ${oldState} -> ${newState}`,
            'sys'
        );

        if (newState === 'configuration') {
            isShiftingServers = true;
            isFullyLoaded = false;

            uiLog('[PROXY] Server transition detected.', 'sys');
        }

        if (newState === 'play') {
            isShiftingServers = false;

            try {
                if (thisBot.entity && thisBot.entity.velocity) {
                    thisBot.entity.velocity.set(0, 0, 0);
                }

                thisBot.clearControlStates();
            } catch (_) {}
        }
    });

    // -----------------------------------------
    // SPAWN
    // -----------------------------------------

    thisBot.once('spawn', () => {
        if (bot !== thisBot) return;

        connected = true;

        try {
            const data = minecraftData(thisBot.version);

            movements = new Movements(thisBot, data);

            movements.canDig = false;
            movements.allow1by1towers = false;

            thisBot.pathfinder.setMovements(movements);

            uiLog('[BOT] Spawned successfully.', 'status');

        } catch (error) {
            uiLog(`[PATHFINDER ERROR] ${error.message}`, 'err');
        }

        updateStatus();
        sendTelemetry();
    });

    // -----------------------------------------
    // SERVER MESSAGES
    // -----------------------------------------

    thisBot.on('messagestr', (message, position) => {
        if (bot !== thisBot) return;

        if (position === 'game_info') return;

        const clean = String(message).trim();

        if (!clean) return;

        uiLog(`[SERVER] ${clean}`, 'srv');

        if (clean.includes('Connecting to 8b8t')) {
            isShiftingServers = true;
            isFullyLoaded = false;

            uiLog('[PROXY] Transition message received.', 'sys');
        }

        const lowerMessage = clean.toLowerCase();

        if (
            !isShiftingServers &&
            !loginDispatched &&
            (
                lowerMessage.includes('/login') ||
                lowerMessage.includes('session has been continued')
            )
        ) {
            loginDispatched = true;

            if (!CONFIG.loginCommand) {
                uiLog(
                    '[LOGIN] Set LOGIN_PASSWORD in the configuration before running.',
                    'err'
                );
                return;
            }

            uiLog('[LOGIN] Login prompt detected. Waiting 5 seconds...', 'sys');

            clearTimeout(loginTimer);

            loginTimer = setTimeout(() => {
                if (
                    bot === thisBot &&
                    thisBot._client &&
                    thisBot._client.state === 'play' &&
                    !isShiftingServers
                ) {
                    thisBot.chat(CONFIG.loginCommand);
                    uiLog('[LOGIN] Login command sent after 5 seconds.', 'sys');
                } else {
                    uiLog('[LOGIN] Skipped: bot is no longer in the play state.', 'err');
                }
            }, 5000);
        }
    });

    // -----------------------------------------
    // HEALTH
    // -----------------------------------------

    thisBot.on('health', () => {
        if (bot !== thisBot || isShiftingServers) return;

        connected = true;

        if (!isFullyLoaded) {
            isFullyLoaded = true;

            uiLog(
                `[STATUS] Main server loaded. HP: ${thisBot.health} | Hunger: ${thisBot.food}`,
                'status'
            );
        }

        sendTelemetry();
        updateStatus();
    });

    // -----------------------------------------
    // ERRORS
    // -----------------------------------------

    thisBot.on('error', error => {
        if (bot !== thisBot) return;

        uiLog(
            `[ERROR] ${error.message || error}`,
            'err'
        );
    });

    thisBot.on('kicked', reason => {
        if (bot !== thisBot) return;

        uiLog(
            `[KICKED] ${JSON.stringify(reason)}`,
            'err'
        );
    });

    // -----------------------------------------
    // DISCONNECT
    // -----------------------------------------

    thisBot.on('end', reason => {
        if (bot !== thisBot) return;

        uiLog(
            `[DISCONNECT] ${reason || 'Connection ended'}`,
            'err'
        );

        connected = false;
        taskGeneration++;

        busy = false;
        activeWindow = null;
        currentTask = 'Disconnected';

        clearTimeout(loginTimer);

        bot = null;
        movements = null;

        updateStatus();

        if (!manualStop) {
            scheduleReconnect();
        }
    });
}

function scheduleReconnect() {
    if (manualStop || reconnectTimer) return;

    uiLog('[SYSTEM] Reconnecting in 15 seconds...', 'sys');

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;

        if (!manualStop && !bot) {
            createBotInstance();
        }
    }, CONFIG.reconnectDelay);
}

// =====================================================
// WEBSITE
// =====================================================

app.get('/', (req, res) => {
    res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">

<title>8b8t Donkey Manager</title>

<style>
* {    box-sizing: border-box;
}

body {
    background: #0c0f12;
    color: #a5acb6;
    font-family: 'Courier New', monospace;
    margin: 20px;
}

h2 {
    color: #52a3ff;
}

.panel {
    background: #10151c;
    border: 1px solid #1a222d;
    padding: 16px;
    margin-bottom: 15px;
    border-radius: 6px;
}

.status {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
}

#connection {
    color: #db4437;
    font-weight: bold;
}

#task {
    color: #52a3ff;
    margin-top: 7px;
}

.telemetry {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
}

.metric {
    background: #14191f;
    padding: 12px;
    border-radius: 4px;
    min-width: 0;
}

.metric small {
    color: #6272a4;
}

.metric strong {
    display: block;
    color: white;
    margin-top: 7px;
    overflow-wrap: anywhere;
}

.buttons {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
}

button {
    border: none;
    padding: 15px 10px;
    border-radius: 4px;
    font-family: inherit;
    font-weight: bold;
    cursor: pointer;
}

button:disabled {
    opacity: .4;
    cursor: not-allowed;
}

button:hover:not(:disabled) {
    filter: brightness(1.2);
}

.deposit {
    background: #0f9d58;
    color: white;
}

.withdraw {
    background: #4285f4;
    color: white;
}

.navigate {
    background: #7952b3;
    color: white;
}

.stop {
    background: #db4437;
    color: white;
    grid-column: span 2;
    padding: 19px;
}

.start {
    background: #45556c;
    color: white;
    width: 100%;
    margin-top: 10px;
}

#console {
    background: #050709;
    border: 1px solid #1a222d;
    padding: 15px;
    height: 350px;
    overflow-y: auto;
    border-radius: 5px;
    overflow-wrap: anywhere;
}

.log {
    margin: 4px 0;
    line-height: 1.4;
    font-size: 13px;
    overflow-wrap: anywhere;
}

.sys {
    color: #f4b400;
}

.srv {
    color: #a5acb6;
}

.log.status {
    color: #0f9d58;
}

.err {
    color: #db4437;
}

#input-container {
    display: flex;
    gap: 10px;
    margin-top: 12px;
}

input {
    flex: 1;
    min-width: 0;
    background: #14191f;
    border: 1px solid #2c384c;
    color: white;
    padding: 12px;
    font-family: inherit;
}

#sendBtn {
    background: #52a3ff;
    color: #0c0f12;
}

@media(max-width: 500px) {
    body {
        margin: 10px;
    }

    .buttons {
        grid-template-columns: 1fr;
    }

    .stop {
        grid-column: span 1;
    }

    .telemetry {
        grid-template-columns: 1fr 1fr;
    }
}
</style>
</head>

<body>

<h2>🤖 8b8t DONKEY MANAGER</h2>

<p>Mineflayer Automation | deadly_boxer</p>

<div class="panel status">
    <div>
        <strong>BOT STATUS</strong>
        <div id="task">Disconnected</div>
    </div>

    <div id="connection">DISCONNECTED</div>
</div>

<div class="panel">
    <h3>Bot Telemetry</h3>

    <div class="telemetry">
        <div class="metric">
            <small>Health</small>
            <strong id="health">--</strong>
        </div>

        <div class="metric">
            <small>Hunger</small>
            <strong id="food">--</strong>
        </div>

        <div class="metric">
            <small>Coordinates</small>
            <strong id="position">--</strong>
        </div>
    </div>
</div>

<div class="panel">
    <h3>Donkey Operations</h3>

    <div class="buttons">

        <button class="deposit" id="deposit" disabled>
            ↓ DEPOSIT SHULKERS
        </button>

        <button class="withdraw" id="withdraw" disabled>
            ↑ WITHDRAW SHULKERS
        </button>

        <button class="navigate" id="navigate" disabled>
            ◉ GO NEAR DONKEY
        </button>

        <button class="stop" id="stop" disabled>
            ■ FORCE STOP ALL TASKS
        </button>

    </div>

    <button class="start" id="start">
        RECONNECT BOT
    </button>
</div>

<div class="panel">
    <h3>Live Console</h3>

    <div id="console"></div>

    <div id="input-container">
        <input
            type="text"
            id="cmdInput"
            placeholder="Send chat message or server command..."
            autocomplete="off"
        >

        <button id="sendBtn">EXECUTE</button>
    </div>
</div>

<script src="/socket.io/socket.io.js"></script>

<script>
const socket = io();

const consoleDiv = document.getElementById('console');
const input = document.getElementById('cmdInput');

function addLog(data) {
    const line = document.createElement('div');

    line.className = 'log ' + data.type;
    line.textContent =
        (data.time ? '[' + data.time + '] ' : '') +
        data.text;

    consoleDiv.appendChild(line);

    while (consoleDiv.children.length > 500) {
        consoleDiv.firstChild.remove();
    }

    consoleDiv.scrollTop = consoleDiv.scrollHeight;
}

socket.on('botLog', addLog);

socket.on('botStatus', data => {
    const connection = document.getElementById('connection');

    connection.textContent = data.connected
        ? 'CONNECTED'
        : 'DISCONNECTED';

    connection.style.color = data.connected
        ? '#0f9d58'
        : '#db4437';

    document.getElementById('task').textContent =
        data.task || 'Idle';

    const disabled = !data.connected || data.busy;

    document.getElementById('deposit').disabled = disabled;
    document.getElementById('withdraw').disabled = disabled;
    document.getElementById('navigate').disabled = disabled;

    document.getElementById('stop').disabled =
        !data.connected || !data.busy;
});

socket.on('telemetry', data => {
    document.getElementById('health').textContent =
        data.health ?? '--';

    document.getElementById('food').textContent =
        data.food ?? '--';

    if (data.position) {
        const p = data.position;

        document.getElementById('position').textContent =
            p.x + ', ' + p.y + ', ' + p.z;
    }
});

// Button events

document.getElementById('deposit').onclick = () => {
    socket.emit('deposit');
};

document.getElementById('withdraw').onclick = () => {
    socket.emit('withdraw');
};

document.getElementById('navigate').onclick = () => {
    socket.emit('goNear');
};

document.getElementById('stop').onclick = () => {
    socket.emit('forceStop');
};

document.getElementById('start').onclick = () => {
    socket.emit('startBot');
};

// Chat input

function transmitInput() {
    const value = input.value.trim();

    if (!value) return;

    socket.emit('uiCommand', value);

    input.value = '';
}

document.getElementById('sendBtn').onclick =
    transmitInput;

input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        transmitInput();
    }
});

</script>

</body>
</html>`);
});

// =====================================================
// SOCKET EVENTS
// =====================================================

io.on('connection', socket => {
    socket.emit('botStatus', {
        connected,
        busy,
        task: currentTask
    });

    socket.on('deposit', depositOperation);

    socket.on('withdraw', withdrawOperation);

    socket.on('goNear', goNearDonkey);

    socket.on('forceStop', forceStop);

    socket.on('startBot', () => {
        manualStop = false;

        if (!bot) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;

            createBotInstance();
        }
    });

    socket.on('uiCommand', text => {
        if (
            typeof text !== 'string' ||
            text.length > 256 ||
            !text.trim()
        ) return;

        if (
            bot &&
            connected &&
            bot._client.state === 'play' &&
            !isShiftingServers
        ) {
            bot.chat(text);

            // Do not echo authentication commands into dashboard logs.
            if (!/^\/login(?:\s|$)/i.test(text)) {
                uiLog(`[SENT CHAT] ${text}`, 'sys');
            } else {
                uiLog('[SENT CHAT] Authentication command sent.', 'sys');
            }
        } else {
            uiLog('[CHAT] Bot is not ready.', 'err');
        }
    });

    socket.on('stopBot', async () => {
        manualStop = true;

        clearTimeout(reconnectTimer);
        reconnectTimer = null;

        await forceStop();

        if (bot) {
            bot.quit('Stopped from dashboard');
        }
    });
});

// =====================================================
// START APPLICATION
// =====================================================

server.listen(CONFIG.webPort, '127.0.0.1', () => {
    if (serverStarted) return;

    serverStarted = true;

    console.log('');
    console.log('==========================================');
    console.log('        8b8t DONKEY MANAGER');
    console.log('==========================================');
    console.log(`Dashboard: http://127.0.0.1:${CONFIG.webPort}`);
    console.log('==========================================');
    console.log('');

    createBotInstance();
});

// =====================================================
// PROCESS CLEANUP
// =====================================================

process.on('SIGINT', async () => {
    console.log('\nShutting down...');

    manualStop = true;

    clearTimeout(reconnectTimer);
    clearTimeout(loginTimer);

    await forceStop();

    if (bot) {
        try {
            bot.quit('Application shutdown');
        } catch (_) {}
    }

    server.close(() => process.exit(0));

    setTimeout(() => process.exit(0), 3000).unref();
});