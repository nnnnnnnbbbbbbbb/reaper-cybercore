
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

    loginCommand: '',

    reconnectDelay: 15000,
    windowTimeout: 7000,
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

    if (currentDistance > 4) {
        throw new Error('Move closer to donkey first');
    }

    uiLog('[CHEST] Preparing sneak interaction...', 'sys');

    const waiter = waitForWindowOpen(id);

    try {
        bot.setControlState('sneak', true);

        await sleep(300);

        assertTask(id);

        uiLog('[CHEST] Sneak enabled. Right-clicking donkey...', 'sys');

        // Right-click the donkey while sneaking.
        // This avoids mounting it.

        await bot.activateEntity(donkey);

        assertTask(id);

        const window = await waiter.promise;

        assertTask(id);

        if (!window || !Array.isArray(window.slots)) {
            throw new Error('Invalid inventory window');
        }

        activeWindow = window;

        const containerSlots =
            Number.isInteger(window.inventoryStart)
                ? window.inventoryStart
                : window.slots.length - 36;

        if (containerSlots < 15) {
            await closeInventory();

            throw new Error(
                'Unexpected donkey inventory layout'
            );
        }

        uiLog('[CHEST] Donkey inventory opened!', 'status');

        return window;

    } catch (error) {
        waiter.cancel();

        throw error;

    } finally {
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

        if (
            !isShiftingServers &&
            !loginDispatched &&
            (
                clean.includes('/login') ||
                clean.includes('session has been continued')
            )
        ) {
            if (!CONFIG.loginCommand) {
                uiLog(
                    '[LOGIN] Configure loginCommand locally if required.',
                    'sys'
                );
                return;
            }

            loginDispatched = true;

            uiLog('[LOGIN] Authentication requested.', 'sys');

            clearTimeout(loginTimer);

            loginTimer = setTimeout(() => {
                if (
                    bot === thisBot &&
                    thisBot._client.state === 'play' &&
                    !isShiftingServers
                ) {
                    thisBot.chat(CONFIG.loginCommand);
                    uiLog('[LOGIN] Login command sent.', 'sys');
                }
            }, 3500);
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
* {
    box-sizing: border-box;
}

body {
    background: #0c0f12;
    color: #a5acb6;
    font-family: 'Courier New', monospace;