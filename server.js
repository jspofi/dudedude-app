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
});

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "dudedude_admin_2024";

// ========================================
// STATE
// ========================================
const users = new Map();   // socketId -> user object
const waitingQueue = [];   // socketIds waiting for match
const stats = {
  totalConnections: 0,
  totalMatches: 0,
  startedAt: new Date().toISOString(),
};

// ========================================
// SERVE STATIC FILES
// ========================================
app.use(express.static(path.join(__dirname, "public")));
app.use("/admin", express.static(path.join(__dirname, "admin")));

// ========================================
// ADMIN API
// ========================================
app.get("/api/admin/stats", (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const allUsers = Array.from(users.values());
  const chatting = allUsers.filter(u => u.status === "chatting");
  const waiting = allUsers.filter(u => u.status === "waiting");
  const idle = allUsers.filter(u => u.status === "idle");

  // Country breakdown
  const countryMap = {};
  allUsers.forEach(u => {
    const c = u.geo?.country || "Unknown";
    countryMap[c] = (countryMap[c] || 0) + 1;
  });

  // City breakdown
  const cityMap = {};
  allUsers.forEach(u => {
    const c = u.geo?.city || "Unknown";
    cityMap[c] = (cityMap[c] || 0) + 1;
  });

  res.json({
    totalConnected: users.size,
    activeChatting: chatting.length,
    activePairs: Math.floor(chatting.length / 2),
    waiting: waiting.length,
    idle: idle.length,
    totalConnectionsEver: stats.totalConnections,
    totalMatchesEver: stats.totalMatches,
    serverStarted: stats.startedAt,
    countryBreakdown: countryMap,
    cityBreakdown: cityMap,
    users: allUsers.map(u => ({
      id: u.id,
      name: u.name,
      country: u.geo?.country || "Unknown",
      city: u.geo?.city || "Unknown",
      region: u.geo?.region || "",
      status: u.status,
      joinedAt: u.joinedAt,
      ip: u.geo?.ip || "unknown",
    })),
  });
});

// Health check for Railway
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), users: users.size });
});

// ========================================
// GEO LOOKUP
// ========================================
function getGeo(socket) {
  let ip =
    socket.handshake.headers["x-forwarded-for"] ||
    socket.handshake.headers["x-real-ip"] ||
    socket.handshake.address;
  ip = (ip || "").split(",")[0].trim().replace("::ffff:", "");
  if (ip === "::1" || ip === "127.0.0.1") ip = "";

  const geo = ip ? geoip.lookup(ip) : null;
  return {
    ip: ip || "localhost",
    country: geo?.country || "Unknown",
    region: geo?.region || "",
    city: geo?.city || "Unknown",
    ll: geo?.ll || [0, 0],
  };
}

// ========================================
// MATCHMAKING
// ========================================
function findMatch(socketId) {
  // Remove from queue if already there
  const idx = waitingQueue.indexOf(socketId);
  if (idx !== -1) waitingQueue.splice(idx, 1);

  // Try to find a partner
  while (waitingQueue.length > 0) {
    const partnerId = waitingQueue.shift();
    const partner = users.get(partnerId);

    // Make sure partner is still valid
    if (partner && partner.status === "waiting" && partnerId !== socketId) {
      const user = users.get(socketId);
      if (!user) return;

      // Match them
      user.status = "chatting";
      user.partnerId = partnerId;
      partner.status = "chatting";
      partner.partnerId = socketId;
      stats.totalMatches++;

      // Tell both sides
      io.to(socketId).emit("matched", {
        partnerId,
        partnerName: partner.name,
        initiator: true,
      });
      io.to(partnerId).emit("matched", {
        partnerId: socketId,
        partnerName: user.name,
        initiator: false,
      });

      console.log(`[MATCH] ${user.name} (${user.geo.city}) <-> ${partner.name} (${partner.geo.city})`);
      broadcastOnline();
      return;
    }
  }

  // No match found — add to queue
  const user = users.get(socketId);
  if (user) {
    user.status = "waiting";
    user.partnerId = null;
    waitingQueue.push(socketId);
    console.log(`[QUEUE] ${user.name} waiting... (${waitingQueue.length} in queue)`);
  }
}

function disconnectFromPartner(socketId) {
  const user = users.get(socketId);
  if (!user?.partnerId) return;

  const partner = users.get(user.partnerId);
  if (partner) {
    partner.partnerId = null;
    partner.status = "waiting";
    io.to(user.partnerId).emit("partnerDisconnected");
    // Auto-rematch the abandoned partner
    findMatch(user.partnerId);
  }
  user.partnerId = null;
}

function broadcastOnline() {
  io.emit("onlineCount", users.size);
}

// ========================================
// SOCKET.IO
// ========================================
io.on("connection", (socket) => {
  const geo = getGeo(socket);
  const userId = uuidv4().slice(0, 8);
  stats.totalConnections++;

  users.set(socket.id, {
    id: userId,
    name: "Anonymous",
    geo,
    status: "idle",
    partnerId: null,
    joinedAt: new Date().toISOString(),
  });

  console.log(`[+] ${userId} connected from ${geo.city}, ${geo.country} (${users.size} total)`);
  socket.emit("onlineCount", users.size);
  broadcastOnline();

  // --- Start searching ---
  socket.on("startSearch", (data) => {
    const user = users.get(socket.id);
    if (!user) return;
    user.name = (data?.name || "Anonymous").slice(0, 20);
    disconnectFromPartner(socket.id);
    findMatch(socket.id);
  });

  // --- WebRTC signaling ---
  socket.on("signal", (data) => {
    const user = users.get(socket.id);
    if (user?.partnerId) {
      io.to(user.partnerId).emit("signal", data);
    }
  });

  // --- Chat message ---
  socket.on("chatMessage", (msg) => {
    const user = users.get(socket.id);
    if (user?.partnerId && msg?.text) {
      io.to(user.partnerId).emit("chatMessage", {
        text: String(msg.text).slice(0, 500),
        from: user.name,
      });
    }
  });

  // --- Next (skip partner) ---
  socket.on("next", () => {
    disconnectFromPartner(socket.id);
    findMatch(socket.id);
  });

  // --- Stop ---
  socket.on("stop", () => {
    disconnectFromPartner(socket.id);
    const user = users.get(socket.id);
    if (user) {
      user.status = "idle";
      user.partnerId = null;
    }
    broadcastOnline();
  });

  // --- Report ---
  socket.on("report", (data) => {
    const user = users.get(socket.id);
    console.log(`[REPORT] by ${user?.name}: ${data?.reason || "no reason"}`);
  });

  // --- Disconnect ---
  socket.on("disconnect", () => {
    const user = users.get(socket.id);
    console.log(`[-] ${userId} disconnected (${user?.geo?.city || "?"})`);
    disconnectFromPartner(socket.id);
    const idx = waitingQueue.indexOf(socket.id);
    if (idx !== -1) waitingQueue.splice(idx, 1);
    users.delete(socket.id);
    broadcastOnline();
  });
});

// ========================================
// START
// ========================================
server.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("  ╔════════════════════════════════════════╗");
  console.log("  ║   🦦 DudeDude.app Server Running       ║");
  console.log(`  ║   Port: ${PORT}                            ║`);
  console.log(`  ║   Admin: /admin?key=${ADMIN_KEY.slice(0, 8)}...       ║`);
  console.log("  ╚════════════════════════════════════════╝");
  console.log("");
});
