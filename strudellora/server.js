// ==========================================
// CENTRAL TELEMETRY & MULTIPLAYER HUB (server.js)
// ==========================================
const { WebSocketServer } = require('ws');

const wss = new WebSocketServer({ port: 8080 });
let entities = {}; 

console.log("Telemetry Broker running on ws://localhost:8080");

// --- HEARTBEAT (Ghost Cleanup) ---
// Each connection gets its own 30s timer that resets every time a pong
// arrives. If 30 seconds pass with no pong, that specific client is
// terminated immediately -- detection latency is a fixed 30s, not the
// up-to-60s latency you get from a single shared sweep interval.
const HEARTBEAT_TIMEOUT_MS = 30000;
const PING_INTERVAL_MS = 15000; // ping more often than the timeout so a missed pong is caught promptly

function removeUnresponsiveClient(ws) {
    if (entities[ws.id]) {
        console.log(`[Sweep] Removing sleeping/unresponsive client: ${entities[ws.id].username}`);
        delete entities[ws.id];
        broadcast({ type: 'despawn', id: ws.id });
    }
    ws.terminate();
}

function armHeartbeat(ws) {
    clearTimeout(ws.pingTimeout);
    ws.pingTimeout = setTimeout(() => removeUnresponsiveClient(ws), HEARTBEAT_TIMEOUT_MS);
}

// Every 15 seconds, ping all clients to provoke a pong (which re-arms their timer).
const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => ws.ping());
}, PING_INTERVAL_MS);

wss.on('close', function close() {
    clearInterval(pingInterval);
});
// -----------------------------------------

wss.on('connection', (ws) => {
    let assignedId = 'entity_' + Math.random().toString(36).substr(2, 9);
    ws.id = assignedId; 
    
    // Start the 30s countdown immediately, and reset it on every pong.
    armHeartbeat(ws);
    ws.on('pong', () => armHeartbeat(ws)); 
    
    ws.on('message', (message) => {
        try {
            const packet = JSON.parse(message);
            
            if (packet.type === 'register') {
                entities[assignedId] = {
                    id: assignedId,
                    role: packet.role,
                    username: packet.username || "Unknown",
                    position: [0, 0, 0],
                    rotation: [0, 0, 0, 1]
                };
                ws.send(JSON.stringify({ type: 'welcome', id: assignedId }));
                broadcast({ type: 'spawn', id: assignedId, role: packet.role, username: entities[assignedId].username });
                console.log(`Registered: ${entities[assignedId].username} [${packet.role}]`);
                
                ws.send(JSON.stringify({ type: 'sync_world', entities }));
            }
            else if (packet.type === 'telemetry' && entities[assignedId]) {
                entities[assignedId].position = packet.position;
                entities[assignedId].rotation = packet.rotation;
                
                broadcastExcept(assignedId, {
                    type: 'update',
                    id: assignedId,
                    position: packet.position,
                    rotation: packet.rotation
                });
            }
            else if (packet.type === 'broadcast_text') {
                broadcast({
                    type: 'text_payload',
                    senderId: assignedId, 
                    text: packet.text,
                    style: packet.style 
                });
            }
        } catch (err) {
            console.error("Malformed network frame:", err);
        }
    });

    ws.on('close', () => {
        clearTimeout(ws.pingTimeout);
        if (entities[assignedId]) {
            console.log(`Disconnected cleanly: ${entities[assignedId].username}`);
            delete entities[assignedId];
            broadcast({ type: 'despawn', id: assignedId });
        }
    });
});

function broadcast(data) {
    const payload = JSON.stringify(data);
    wss.clients.forEach(client => { if (client.readyState === 1) client.send(payload); });
}

function broadcastExcept(excludeId, data) {
    const payload = JSON.stringify(data);
    wss.clients.forEach(client => { 
        if (client.readyState === 1 && client.id !== excludeId) {
            client.send(payload); 
        }
    });
}
