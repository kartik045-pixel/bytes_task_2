import express from "express";
import cors from "cors";
import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const db = new Database(path.join(__dirname, "gym.sqlite"));
const PORT = process.env.PORT || 4000;
const CAPACITY = 20;

app.use(cors());
app.use(express.json());

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    starts_at TEXT NOT NULL UNIQUE,
    capacity INTEGER NOT NULL DEFAULT 20 CHECK(capacity = 20)
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    member_name TEXT NOT NULL,
    member_email TEXT NOT NULL,
    code TEXT UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('confirmed','waitlisted','cancelled','checked_in')),
    queue_number INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    checked_in_at TEXT
  );
  CREATE INDEX IF NOT EXISTS bookings_session_status ON bookings(session_id, status, created_at);
  CREATE INDEX IF NOT EXISTS bookings_email ON bookings(member_email);
`);

function localHourStart(date = new Date()) {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  return d;
}
function makeSessions() {
  const start = localHourStart();
  const insert = db.prepare("INSERT OR IGNORE INTO sessions (id, starts_at, capacity) VALUES (?, ?, ?)");
  const rows = [];
  for (let i = 0; i < 12; i++) {
    const at = new Date(start.getTime() + i * 60 * 60 * 1000);
    const iso = at.toISOString();
    const id = iso;
    insert.run(id, iso, CAPACITY);
    rows.push({ id, starts_at: iso, capacity: CAPACITY });
  }
  return rows;
}
function getSession(sessionId) {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
}
function confirmedCount(sessionId) {
  return db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE session_id = ? AND status IN ('confirmed','checked_in')").get(sessionId).n;
}
function waitlistCount(sessionId) {
  return db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE session_id = ? AND status = 'waitlisted'").get(sessionId).n;
}
function sessionSnapshot(session) {
  const bookings = db.prepare(`
    SELECT id, session_id, member_name, member_email, code, status, queue_number, created_at, checked_in_at
    FROM bookings WHERE session_id = ? AND status IN ('confirmed','waitlisted','checked_in')
    ORDER BY CASE status WHEN 'confirmed' THEN 0 WHEN 'checked_in' THEN 1 ELSE 2 END, created_at ASC
  `).all(session.id);
  let queue = 0;
  const normalized = bookings.map((b) => {
    if (b.status === "waitlisted") queue += 1;
    return { ...b, queue_position: b.status === "waitlisted" ? queue : null };
  });
  return {
    ...session,
    booked: confirmedCount(session.id),
    remaining: Math.max(0, CAPACITY - confirmedCount(session.id)),
    waitlist_count: waitlistCount(session.id),
    bookings: normalized
  };
}
function publishSession(sessionId) {
  const session = getSession(sessionId);
  if (session) io.emit("session:update", sessionSnapshot(session));
}
function newCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}
function nextCode() {
  for (let i = 0; i < 10; i++) {
    const code = newCode();
    if (!db.prepare("SELECT 1 FROM bookings WHERE code = ?").get(code)) return code;
  }
  throw new Error("Could not create a unique booking code");
}

// Every cancellation/promotion happens inside the same SQLite transaction.
const promoteNext = db.transaction((sessionId) => {
  const occupied = confirmedCount(sessionId);
  if (occupied >= CAPACITY) return null;
  const next = db.prepare(`
    SELECT id FROM bookings
    WHERE session_id = ? AND status = 'waitlisted'
    ORDER BY created_at ASC, rowid ASC LIMIT 1
  `).get(sessionId);
  if (!next) return null;
  db.prepare("UPDATE bookings SET status = 'confirmed', code = ?, queue_number = NULL WHERE id = ?")
    .run(nextCode(), next.id);
  return next.id;
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/sessions", (_req, res) => {
  const sessions = makeSessions().map(sessionSnapshot);
  res.json(sessions);
});
app.get("/api/members/:email/bookings", (req, res) => {
  const email = String(req.params.email || "").trim().toLowerCase();
  const rows = db.prepare(`
    SELECT b.*, s.starts_at FROM bookings b JOIN sessions s ON s.id = b.session_id
    WHERE b.member_email = ? AND b.status IN ('confirmed','waitlisted','checked_in')
    ORDER BY s.starts_at ASC
  `).all(email);
  res.json(rows);
});

app.post("/api/bookings", (req, res) => {
  const sessionId = String(req.body.sessionId || "");
  const memberName = String(req.body.memberName || "").trim();
  const memberEmail = String(req.body.memberEmail || "").trim().toLowerCase();
  if (!sessionId || memberName.length < 2 || memberName.length > 80 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(memberEmail)) {
    return res.status(400).json({ error: "Enter your name, a valid email, and a session." });
  }
  const session = getSession(sessionId);
  if (!session) return res.status(404).json({ error: "Session not found. Refresh the session list." });

  try {
    const result = db.transaction(() => {
      const duplicate = db.prepare(`
        SELECT id, status FROM bookings WHERE session_id = ? AND member_email = ?
        AND status IN ('confirmed','waitlisted','checked_in')
      `).get(sessionId, memberEmail);
      if (duplicate) return { duplicate: true, booking: duplicate };
      const full = confirmedCount(sessionId) >= CAPACITY;
      const id = crypto.randomUUID();
      const code = full ? null : nextCode();
      db.prepare(`
        INSERT INTO bookings (id, session_id, member_name, member_email, code, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, sessionId, memberName, memberEmail, code, full ? "waitlisted" : "confirmed");
      return { booking: db.prepare("SELECT * FROM bookings WHERE id = ?").get(id) };
    })();
    publishSession(sessionId);
    if (result.duplicate) return res.status(409).json({ error: "You already have an active booking or waitlist spot for this session." });
    res.status(201).json({ ...result.booking, queue_position: result.booking.status === "waitlisted" ? waitlistCount(sessionId) : null });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Booking could not be completed. Please try again." });
  }
});

app.post("/api/bookings/:id/cancel", (req, res) => {
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(req.params.id);
  if (!booking || !["confirmed", "waitlisted"].includes(booking.status)) {
    return res.status(404).json({ error: "Active booking not found." });
  }
  try {
    db.transaction(() => {
      db.prepare("UPDATE bookings SET status = 'cancelled', code = NULL WHERE id = ?").run(booking.id);
      if (booking.status === "confirmed") promoteNext(booking.session_id);
    })();
    publishSession(booking.session_id);
    res.json({ ok: true, message: "Booking cancelled." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Cancellation failed. Please try again." });
  }
});

app.post("/api/check-in", (req, res) => {
  const code = String(req.body.code || "").trim().toUpperCase();
  if (!/^[A-F0-9]{8}$/.test(code)) return res.status(400).json({ error: "Enter a valid 8-character booking code." });
  const booking = db.prepare("SELECT * FROM bookings WHERE code = ?").get(code);
  if (!booking || booking.status !== "confirmed") {
    return res.status(404).json({ error: "No valid, unused booking found for this code." });
  }
  db.prepare("UPDATE bookings SET status = 'checked_in', checked_in_at = datetime('now') WHERE id = ? AND status = 'confirmed'").run(booking.id);
  publishSession(booking.session_id);
  res.json({ ok: true, memberName: booking.member_name, sessionId: booking.session_id, message: "Member checked in successfully." });
});

app.get("/api/staff/sessions/:id", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found." });
  res.json(sessionSnapshot(session));
});

const clientDist = path.resolve(__dirname, "../dist");
import fs from "node:fs";
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

io.on("connection", (socket) => {
  socket.emit("connected", { ok: true });
});

server.listen(PORT, () => {
  console.log(`Gym booking API listening at http://localhost:${PORT}`);
});
