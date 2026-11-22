const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// Minecraft Connection Config
const MC_HOST = '8b8t.me';
const MC_PORT = 25565;
const MC_USERNAME = 'deadly_boxer';
const MC_VERSION = '1.21.1';
const LOGIN_PASSWORD = 'reaper_bot_dont_test_me'; // Set this in your environment; do not commit passwords

// Step Delays
const LOGIN_DELAY = 2000;       // Wait 2s to login
const CHECK_DELAY = 2000;       // Wait 2s between inventory scans
const REMAINING_TIME = 5000;    // MODIFIED: Wait exactly 5 seconds in world after throwing before leaving
const RECONNECT_DELAY = 5000;   // Wait 5s before repeating loop
const MAX_INVENTORY_SEARCHES = 10;
const RECOVERY_WAIT = 15000;
const CHEST_POSITION = { x: 10701307, y: 112, z: -297 };
const CHEST_HOME_WAIT = 5000;
const CHEST_LOOKUP_TIMEOUT = 15000;
const POINT_HOME_WAIT = 5000;
const SOUTH_WAIT = 15000;

let bot = null;
let running = false;
let stopRequested = false;      // Delayed graceful stop flag
let cycleRunning = false;
let completedLoops = 0;
let reconnectTimer = null;

let logs = [];
let lastStatus = 'Offline';
let shulkerInfo = 'Waiting...';

function addLog(msg) {
    const entry = { time: new Date().toLocaleTimeString(), text: String(msg) };
    logs.push(entry);
    if (logs.length > 100) logs.shift();
    io.emit('log', entry);
    console.log(`[${entry.time}] ${entry.text}`);
}

function updateState(status) {
    if (status) lastStatus = status;
    io.emit('dashboard', {
        status: lastStatus,
        loops: completedLoops,
        shulker: shulkerInfo,
        running: running,
        stopRequested: stopRequested
    });
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function returnToPointAndFaceSouth(activeBot) {
    if (!running || bot !== activeBot) return false;

    addLog(` Returning to /home point...`);
    activeBot.chat('/home point');
    await sleep(POINT_HOME_WAIT);
    if (!running || bot !== activeBot) return false;

    // Mineflayer yaw: 0 faces South (+Z); pitch 0 is level.
    await activeBot.look(0, 0, true);
    addLog(` Facing South (+Z). Waiting 15 seconds before resuming...`);
    await sleep(SOUTH_WAIT);
    return running && bot === activeBot;
}

async function retrieveShulkerFromChest(activeBot) {
    if (!running || bot !== activeBot) return false;

    addLog(` No shulker after 10 inventory searches. Going to /home chest...`);
    activeBot.chat('/home chest');
    await sleep(CHEST_HOME_WAIT);
    if (!running || bot !== activeBot) return false;

    const target = new Vec3(CHEST_POSITION.x, CHEST_POSITION.y, CHEST_POSITION.z);
    const deadline = Date.now() + CHEST_LOOKUP_TIMEOUT;
    let chestBlock = null;

    while (Date.now() < deadline && running && bot === activeBot) {
        const block = activeBot.blockAt(target);
        if (block && (block.name === 'chest' || block.name === 'trapped_chest')) {
            chestBlock = block;
            break;
        }
        await sleep(1000);
    }

    if (!running || bot !== activeBot) return false;
    if (!chestBlock) {
        addLog(`[WARNING] No chest found at X:${target.x} Y:${target.y} Z:${target.z}.`);
        await returnToPointAndFaceSouth(activeBot);
        return false;
    }

    let container;
    try {
        addLog(` Opening chest at X:${target.x} Y:${target.y} Z:${target.z}...`);
        container = await activeBot.openContainer(chestBlock);
        const shulker = container.items().find(item =>
            item && typeof item.name === 'string' && item.name.includes('shulker_box')
        );

        if (!shulker) {
            addLog(` No shulker found in the chest. Returning to point.`);
            container.close();
            await returnToPointAndFaceSouth(activeBot);
            return false;
        }

        addLog(` Found ${shulker.name} in chest slot ${shulker.slot}. Retrieving...`);
        await container.withdraw(shulker.type, shulker.metadata ?? null, shulker.count);
        addLog(` Retrieved ${shulker.count} shulker item(s) from chest.`);
        shulkerInfo = 'Retrieved from chest';
        updateState();
        container.close();
        await returnToPointAndFaceSouth(activeBot);
        return true;
    } catch (err) {
        addLog(`[CHEST RECOVERY ERROR] ${err.message}`);
        try {
            if (container) container.close();
        } catch (_) {}
        await returnToPointAndFaceSouth(activeBot);
        return false;
    }
}

async function runCycle(activeBot) {
    if (!running || cycleRunning || bot !== activeBot) return;
    cycleRunning = true;

    addLog(`========== STARTING LOOP #${completedLoops + 1} ==========`);
    if (stopRequested) {
        addLog(` Notice: Stop requested, but finishing this loop first.`);
    }

    try {
        await sleep(LOGIN_DELAY);
        if (bot !== activeBot) return;

        if (LOGIN_PASSWORD) {
            activeBot.chat(`/login ${LOGIN_PASSWORD}`);
            addLog(`Sent chat login command.`);
        } else {
            addLog(`[WARNING] MC_LOGIN_PASSWORD is not set; skipped /login command.`);
        }

        // Search inventory; after each 10 misses, wait 15 seconds and try chest recovery.
        let failedSearches = 0;
        while (true) {
            await sleep(CHECK_DELAY);
            if (!running || bot !== activeBot) return;

            const items = activeBot.inventory.items();
            const shulker = items.find(i => i && typeof i.name === 'string' && i.name.includes('shulker_box'));

            if (shulker) {
                shulkerInfo = `Slot ${shulker.slot}`;
                addLog(` Shulker located in container slot ${shulker.slot}. Equipping...`);
                updateState();

                try {
                    // Force the bot to put it in its hands first to ensure it tosses successfully
                    await activeBot.equip(shulker, 'hand');
                    await sleep(500); // Small delay to let server register equipment update

                    addLog(` Tossing shulker out of hand...`);
                    await activeBot.tossStack(shulker);
                    addLog(` Shulker dropped successfully.`);
                    shulkerInfo = 'Tossed out successfully';
                    updateState();
                    break; // Exit the loop safely since shulker was dropped!
                } catch (tossError) {
                    addLog(`[WARNING] Hand toss failed (${tossError.message}), attempting fallback standard toss...`);
                    try {
                        activeBot.closeWindow(activeBot.inventory);
                        await activeBot.tossStack(shulker);
                        addLog(` Fallback toss successful.`);
                        break;
                    } catch (fallbackError) {
                        addLog(`[ERROR] Both toss methods failed: ${fallbackError.message}. Retrying cycle...`);
                    }
                }
            } else {
                failedSearches++;
                shulkerInfo = `Searching... (${failedSearches}/${MAX_INVENTORY_SEARCHES})`;
                addLog(` Shulker not found (${failedSearches}/${MAX_INVENTORY_SEARCHES}).`);
                updateState();

                if (failedSearches >= MAX_INVENTORY_SEARCHES) {
                    addLog(` 10 searches failed. Waiting 15 seconds before chest recovery...`);
                    await sleep(RECOVERY_WAIT);
                    if (!running || bot !== activeBot) return;
                    await retrieveShulkerFromChest(activeBot);
                    if (!running || bot !== activeBot) return;
                    failedSearches = 0;
                }
            }
        }
        // --- END PROCEED LOCK ---

        addLog(` Shulker processed. Waiting out the 5-second survival window...`);
        await sleep(REMAINING_TIME);

        if (!running || bot !== activeBot) return;

        addLog(` 5 seconds met. Disconnecting to reset loops.`);
        completedLoops++;
        updateState();

        activeBot.quit('Loop finished');
    } catch (err) {
        addLog(`[ERROR] Cycle fault: ${err.message}`);
    } finally {
        cycleRunning = false;
        updateState();
    }
}

function createBot() {
    if (!running || bot) return;

    updateState('Connecting');
    addLog(`Targeting server: ${MC_HOST}`);

    bot = mineflayer.createBot({
        host: MC_HOST,
        port: MC_PORT,
        username: MC_USERNAME,
        version: MC_VERSION,
        auth: 'offline'
    });

    bot.once('login', () => {
        updateState('Connected');
        addLog(`Authentication handshake complete.`);
    });

    bot.once('spawn', () => {
        updateState('Online');
        addLog(`Bot spawned successfully.`);
        runCycle(bot);
    });

    bot.on('kicked', (reason) => addLog(`[KICKED] ${reason}`));
    bot.on('error', (err) => addLog(`[ENGINE ERROR] ${err.message}`));

    bot.once('end', () => {
        bot = null;
        cycleRunning = false;
        updateState('Offline');
        addLog(`Disengaged connection layout.`);

        if (stopRequested) {
            running = false;
            stopRequested = false;
            addLog(` Graceful stop active. Sequence suspended cleanly at loop boundary.`);
            updateState();
            return;
        }

        if (running) {
            addLog(`Preparing queue. Retrying in ${RECONNECT_DELAY/1000}s...`);
            reconnectTimer = setTimeout(createBot, RECONNECT_DELAY);
        } else {
            addLog(`Sequence suspended.`);
        }
    });
}

function startEngine() {
    if (running) return;
    running = true;
    stopRequested = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    createBot();
}

function forceStopEngine() {
    addLog(` FORCE STOP requested. Stopping immediately...`);
    running = false;
    stopRequested = false;

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    if (bot) {
        const activeBot = bot;
        bot = null;
        try {
            activeBot.quit('Force stopped by dashboard');
        } catch (err) {
            addLog(`[WARNING] Error while force-stopping bot: ${err.message}`);
        }
    }

    cycleRunning = false;
    shulkerInfo = 'Stopped';
    updateState('Offline');
}

function stopEngineGracefully() {
    if (!running) return;

    if (cycleRunning || (bot && lastStatus === 'Online')) {
        stopRequested = true;
        addLog(` Stop requested! Bot will exit cleanly once the current loop completes.`);
        updateState();
    } else {
        running = false;
        stopRequested = false;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (bot) bot.quit('Terminated');
        addLog(`Sequence suspended immediately.`);
        updateState('Offline');
    }
}

// Serve UI dashboard direct via inline base route
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Dashboard</title>
        <style>
            body { font-family: monospace; background: #111; color: #eee; padding: 20px; }
            .box { background: #222; padding: 15px; border-radius: 5px; margin-bottom: 15px; border: 1px solid #333; }
            .btn { padding: 10px 20px; font-weight: bold; cursor: pointer; border: none; border-radius: 4px; }
            #start { background: #00b37e; color: white; margin-right: 10px; }
            #stop { background: #f75a68; color: white; }
            #force-stop { background: #a80000; color: white; margin-left: 10px; }
            #log-window { background: #000; padding: 10px; height: 300px; overflow-y: scroll; border: 1px solid #333; border-radius: 4px; }
            span.time { color: #666; margin-right: 10px; }
            #lbl-stop-notice { color: #f75a68; font-weight: bold; margin-left: 15px; display: none; }
        </style>
        <script src="/socket.io/socket.io.js"></script>
    </head>
    <body>
        <h2>8b8t Cycle Automation</h2>
        <div class="box">
            <button id="start" class="btn" onclick="socket.emit('start')">START</button>
            <button id="stop" class="btn" onclick="socket.emit('stop')">GRACEFUL STOP</button>
            <button id="force-stop" class="btn" onclick="socket.emit('forceStop')">FORCE STOP</button>
            <span id="lbl-stop-notice"> Stopping after this loop...</span>
        </div>
        <div class="box" style="display:flex; gap: 40px;">
            <div>STATUS: <b id="lbl-status">-</b></div>
            <div>LOOPS COMPLETED: <b id="lbl-loops" style="color:#00b37e">0</b></div>
            <div>SHULKER: <b id="lbl-shulker" style="color:#ffb800">-</b></div>
        </div>
        <h3>Console Output</h3>
        <div id="log-window"></div>
        <script>
            const socket = io();
            socket.on('dashboard', (data) => {
                document.getElementById('lbl-status').innerText = data.status;
                document.getElementById('lbl-loops').innerText = data.loops;
                document.getElementById('lbl-shulker').innerText = data.shulker;
                document.getElementById('lbl-stop-notice').style.display = data.stopRequested ? 'inline' : 'none';
            });
            socket.on('log', (entry) => {
                const el = document.getElementById('log-window');
                el.innerHTML += '<div><span class="time">['+entry.time+']</span>'+entry.text+'</div>';
                el.scrollTop = el.scrollHeight;
            });
        </script>
    </body>
    </html>
    `);
});

io.on('connection', (socket) => {
    updateState();
    logs.forEach(l => socket.emit('log', l));
    socket.on('start', startEngine);
    socket.on('stop', stopEngineGracefully);
    socket.on('forceStop', forceStopEngine);
});

server.listen(PORT, () => {
    console.log(`\n==============================================`);
    console.log(` Live UI Ready: http://localhost:${PORT}`);
    console.log(`==============================================\n`);
    startEngine();
});
