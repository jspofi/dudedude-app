const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const geoip = require("geoip-lite");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ["websocket", "polling"],
});

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "dudedude_admin_2024";

const users = new Map();       // socketId -> user data
const waitingQueue = [];       // socketIds waiting for a match
const stats = { totalConnections: 0, totalMatches: 0, startedAt: new Date().toISOString() };

app.use(express.static(path.join(__dirname, "public")));
app.use("/admin", express.static(path.join(__dirname, "admin")));

// ================ ADMIN API ================
app.get("/api/admin/stats", (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(401).json({ error: "Unauthorized" });
  const all = Array.from(users.values());
  const countryMap = {}, cityMap = {};
  all.forEach(u => {
    countryMap[u.geo?.country || "Unknown"] = (countryMap[u.geo?.country || "Unknown"] || 0) + 1;
    cityMap[u.geo?.city || "Unknown"] = (cityMap[u.geo?.city || "Unknown"] || 0) + 1;
  });
  res.json({
    totalConnected: users.size,
    activeChatting: all.filter(u => u.status === "chatting").length,
    activePairs: Math.floor(all.filter(u => u.status === "chatting").length / 2),
    waiting: all.filter(u => u.status === "waiting").length,
    idle: all.filter(u => u.status === "idle").length,
    totalConnectionsEver: stats.totalConnections,
    totalMatchesEver: stats.totalMatches,
    serverStarted: stats.startedAt,
    countryBreakdown: countryMap,
    cityBreakdown: cityMap,
    users: all.map(u => ({
      id: u.id, name: u.name, country: u.geo?.country || "Unknown",
      city: u.geo?.city || "Unknown", region: u.geo?.region || "",
      status: u.status, joinedAt: u.joinedAt, ip: u.geo?.ip || "unknown",
    })),
  });
});

app.get("/api/health", (req, res) => res.json({ status: "ok", uptime: process.uptime(), users: users.size }));

// ================ GEO ================
function getGeo(socket) {
  let ip = socket.handshake.headers["x-forwarded-for"] || socket.handshake.headers["x-real-ip"] || socket.handshake.address;
  ip = (ip || "").split(",")[0].trim().replace("::ffff:", "");
  if (ip === "::1" || ip === "127.0.0.1") ip = "";
  const geo = ip ? geoip.lookup(ip) : null;
  return { ip: ip || "localhost", country: geo?.country || "Unknown", region: geo?.region || "", city: geo?.city || "Unknown", ll: geo?.ll || [0, 0] };
}

// ================ QUEUE HELPERS ================
function removeFromQueue(socketId) {
  const idx = waitingQueue.indexOf(socketId);
  if (idx !== -1) waitingQueue.splice(idx, 1);
}

function addToQueue(socketId) {
  // Never add duplicates
  removeFromQueue(socketId);
  const u = users.get(socketId);
  if (u) {
    u.status = "waiting";
    u.partnerId = null;
    waitingQueue.push(socketId);
  }
}

// ================ MATCHMAKING (FIXED) ================
// This ONLY tries to find a match for socketId.
// It does NOT touch anyone who is already "chatting".
function findMatch(socketId) {
  const user = users.get(socketId);
  if (!user) return;

  // If this user is currently chatting, do nothing
  if (user.status === "chatting" && user.partnerId) return;

  // Remove from queue first
  removeFromQueue(socketId);

  // Look through the queue for a valid partner
  for (let i = 0; i < waitingQueue.length; i++) {
    const pid = waitingQueue[i];
    if (pid === socketId) continue; // skip self

    const partner = users.get(pid);

    // Partner must exist, be waiting, and NOT already chatting
    if (!partner) {
      waitingQueue.splice(i, 1); i--; // cleanup stale entry
      continue;
    }
    if (partner.status !== "waiting" || partner.partnerId) {
      waitingQueue.splice(i, 1); i--; // cleanup wrong state
      continue;
    }

    // Valid match found! Remove partner from queue
    waitingQueue.splice(i, 1);

    // Link them
    user.status = "chatting";
    user.partnerId = pid;
    partner.status = "chatting";
    partner.partnerId = socketId;
    stats.totalMatches++;

    // Notify both
    io.to(socketId).emit("matched", { partnerId: pid, partnerName: partner.name, initiator: true });
    io.to(pid).emit("matched", { partnerId: socketId, partnerName: user.name, initiator: false });

    console.log(`[MATCH] ${user.name}(${user.geo.city}) <-> ${partner.name}(${partner.geo.city}) | Queue:${waitingQueue.length}`);
    broadcastOnline();
    return;
  }

  // No match found — add to queue
  addToQueue(socketId);
  console.log(`[QUEUE] ${user.name} waiting | Queue:${waitingQueue.length}`);
}

// ================ UNPAIR (FIXED) ================
// Cleanly unpair two users. Does NOT auto-rematch anyone.
function unpair(socketId) {
  const user = users.get(socketId);
  if (!user || !user.partnerId) return;

  const partnerId = user.partnerId;
  const partner = users.get(partnerId);

  // Clear both sides
  user.partnerId = null;
  user.status = "idle";

  if (partner) {
    partner.partnerId = null;
    partner.status = "idle";
  }

  return partnerId;
}

function broadcastOnline() { io.emit("onlineCount", users.size); }

// ================ SOCKET.IO ================
io.on("connection", (socket) => {
  const geo = getGeo(socket);
  const uid = uuidv4().slice(0, 8);
  stats.totalConnections++;

  users.set(socket.id, {
    id: uid, name: "Anonymous", geo, status: "idle",
    partnerId: null, joinedAt: new Date().toISOString(),
  });

  console.log(`[+] ${uid} from ${geo.city},${geo.country} (${users.size} total)`);
  socket.emit("onlineCount", users.size);
  broadcastOnline();

  // ---- Start searching ----
  socket.on("startSearch", (d) => {
    const u = users.get(socket.id);
    if (!u) return;
    u.name = (d?.name || "Anonymous").slice(0, 20);

    // If currently paired, unpair first and notify partner
    const oldPartnerId = unpair(socket.id);
    if (oldPartnerId) {
      io.to(oldPartnerId).emit("partnerDisconnected");
      // DON'T auto-rematch old partner — they'll handle it client-side
    }

    findMatch(socket.id);
  });

  // ---- Signaling ----
  socket.on("signal", (d) => {
    const u = users.get(socket.id);
    if (u?.partnerId) io.to(u.partnerId).emit("signal", d);
  });

  socket.on("iceRestart", () => {
    const u = users.get(socket.id);
    if (u?.partnerId) io.to(u.partnerId).emit("iceRestart");
  });

  // ---- Chat ----
  socket.on("chatMessage", (m) => {
    const u = users.get(socket.id);
    if (u?.partnerId && m?.text) {
      io.to(u.partnerId).emit("chatMessage", { text: String(m.text).slice(0, 500), from: u.name });
    }
  });

  // ---- Next (user clicks Next) ----
  socket.on("next", () => {
    const oldPartnerId = unpair(socket.id);
    if (oldPartnerId) {
      io.to(oldPartnerId).emit("partnerDisconnected");
    }
    findMatch(socket.id);
    broadcastOnline();
  });

  // ---- Stop ----
  socket.on("stop", () => {
    const oldPartnerId = unpair(socket.id);
    if (oldPartnerId) {
      io.to(oldPartnerId).emit("partnerDisconnected");
    }
    removeFromQueue(socket.id);
    const u = users.get(socket.id);
    if (u) { u.status = "idle"; u.partnerId = null; }
    broadcastOnline();
  });

  // ---- Re-enter queue (client explicitly asks to search again) ----
  socket.on("searchAgain", () => {
    const u = users.get(socket.id);
    if (!u) return;
    // Only if not currently chatting
    if (u.status !== "chatting") {
      findMatch(socket.id);
    }
  });

  // ---- Report ----
  socket.on("report", (d) => console.log(`[REPORT] ${users.get(socket.id)?.name}: ${d?.reason || "?"}`));

  // ---- Disconnect ----
  socket.on("disconnect", () => {
    console.log(`[-] ${uid} disconnected`);
    const oldPartnerId = unpair(socket.id);
    if (oldPartnerId) {
      io.to(oldPartnerId).emit("partnerDisconnected");
    }
    removeFromQueue(socket.id);
    users.delete(socket.id);
    broadcastOnline();
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`\n  🦦 DudeDude.app on port ${PORT}\n  Admin: /admin?key=${ADMIN_KEY.slice(0, 8)}...\n`));
