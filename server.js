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

const users = new Map();
const waitingQueue = [];
const stats = { totalConnections: 0, totalMatches: 0, startedAt: new Date().toISOString() };

app.use(express.static(path.join(__dirname, "public")));
app.use("/admin", express.static(path.join(__dirname, "admin")));

// Admin API
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
    countryBreakdown: countryMap, cityBreakdown: cityMap,
    users: all.map(u => ({ id: u.id, name: u.name, country: u.geo?.country || "Unknown", city: u.geo?.city || "Unknown", region: u.geo?.region || "", status: u.status, joinedAt: u.joinedAt, ip: u.geo?.ip || "unknown" })),
  });
});

app.get("/api/health", (req, res) => res.json({ status: "ok", uptime: process.uptime(), users: users.size }));

function getGeo(socket) {
  let ip = socket.handshake.headers["x-forwarded-for"] || socket.handshake.headers["x-real-ip"] || socket.handshake.address;
  ip = (ip || "").split(",")[0].trim().replace("::ffff:", "");
  if (ip === "::1" || ip === "127.0.0.1") ip = "";
  const geo = ip ? geoip.lookup(ip) : null;
  return { ip: ip || "localhost", country: geo?.country || "Unknown", region: geo?.region || "", city: geo?.city || "Unknown", ll: geo?.ll || [0, 0] };
}

function findMatch(socketId) {
  const idx = waitingQueue.indexOf(socketId);
  if (idx !== -1) waitingQueue.splice(idx, 1);
  while (waitingQueue.length > 0) {
    const pid = waitingQueue.shift();
    const p = users.get(pid);
    if (p && p.status === "waiting" && pid !== socketId) {
      const u = users.get(socketId);
      if (!u) return;
      u.status = "chatting"; u.partnerId = pid;
      p.status = "chatting"; p.partnerId = socketId;
      stats.totalMatches++;
      // Both get matched — initiator creates offer
      io.to(socketId).emit("matched", { partnerId: pid, partnerName: p.name, initiator: true });
      io.to(pid).emit("matched", { partnerId: socketId, partnerName: u.name, initiator: false });
      console.log(`[MATCH] ${u.name}(${u.geo.city}) <-> ${p.name}(${p.geo.city})`);
      broadcastOnline();
      return;
    }
  }
  const u = users.get(socketId);
  if (u) { u.status = "waiting"; u.partnerId = null; waitingQueue.push(socketId); }
}

function disconnectFromPartner(socketId) {
  const u = users.get(socketId);
  if (!u?.partnerId) return;
  const p = users.get(u.partnerId);
  if (p) { p.partnerId = null; p.status = "waiting"; io.to(u.partnerId).emit("partnerDisconnected"); findMatch(u.partnerId); }
  u.partnerId = null;
}

function broadcastOnline() { io.emit("onlineCount", users.size); }

io.on("connection", (socket) => {
  const geo = getGeo(socket);
  const uid = uuidv4().slice(0, 8);
  stats.totalConnections++;
  users.set(socket.id, { id: uid, name: "Anonymous", geo, status: "idle", partnerId: null, joinedAt: new Date().toISOString() });
  console.log(`[+] ${uid} from ${geo.city},${geo.country} (${users.size})`);
  socket.emit("onlineCount", users.size);
  broadcastOnline();

  socket.on("startSearch", (d) => {
    const u = users.get(socket.id);
    if (!u) return;
    u.name = (d?.name || "Anonymous").slice(0, 20);
    disconnectFromPartner(socket.id);
    findMatch(socket.id);
  });

  // Relay all signaling to partner
  socket.on("signal", (d) => { const u = users.get(socket.id); if (u?.partnerId) io.to(u.partnerId).emit("signal", d); });
  socket.on("iceRestart", () => { const u = users.get(socket.id); if (u?.partnerId) io.to(u.partnerId).emit("iceRestart"); });

  // Chat
  socket.on("chatMessage", (m) => { const u = users.get(socket.id); if (u?.partnerId && m?.text) io.to(u.partnerId).emit("chatMessage", { text: String(m.text).slice(0, 500), from: u.name }); });

  socket.on("next", () => { disconnectFromPartner(socket.id); findMatch(socket.id); });
  socket.on("stop", () => { disconnectFromPartner(socket.id); const u = users.get(socket.id); if (u) { u.status = "idle"; u.partnerId = null; } broadcastOnline(); });
  socket.on("report", (d) => console.log(`[REPORT] ${users.get(socket.id)?.name}: ${d?.reason || "?"}`));

  socket.on("disconnect", () => {
    disconnectFromPartner(socket.id);
    const i = waitingQueue.indexOf(socket.id);
    if (i !== -1) waitingQueue.splice(i, 1);
    users.delete(socket.id);
    broadcastOnline();
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`\n  🦦 DudeDude.app on port ${PORT}\n  Admin: /admin?key=${ADMIN_KEY.slice(0, 8)}...\n`));
