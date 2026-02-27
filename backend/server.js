const Message = require("./models/Message");
const User = require("./models/User");
const CallLog = require("./models/CallLog");
const SecurityEvent = require("./models/SecurityEvent");
const OtpDeliveryEvent = require("./models/OtpDeliveryEvent");
const mongoose = require("mongoose");
const fs = require("fs");
const multer = require("multer");
const path = require("path");
const express = require("express");
const dotenv = require("dotenv");
dotenv.config();
dotenv.config({ path: path.join(__dirname, ".env") });
const connectDB = require("./config/db");
const cors = require("cors");
const { Server } = require("socket.io");
const http = require("http");
const { parseAuthHeader, parseCookieHeader, verifyToken, requireAuth, getJwtSecret } = require("./middleware/auth");
const { makeRateLimiter } = require("./middleware/rateLimit");
const { requireCsrf } = require("./middleware/csrf");
const { requestContext } = require("./middleware/requestContext");
const { createNotification } = require("./utils/notifications");
const { findModerationIssue } = require("./utils/moderation");
const { validateStoredMediaFile } = require("./utils/mediaValidation");
const { sendMail, isSmtpConfigured } = require("./utils/mailer");
const { scheduleBackupValidation } = require("./utils/backupValidation");
const logger = require("./utils/logger");

const app = express();

const PORT = Number(process.env.PORT || 5000);
const CLIENT_ORIGIN = String(process.env.CLIENT_ORIGIN || "").trim() || "http://localhost:5500";
const isProduction = process.env.NODE_ENV === "production";

function parseAllowedOrigins(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const allowedOrigins = parseAllowedOrigins(CLIENT_ORIGIN);
const allowAnyOrigin = allowedOrigins.includes("*");

if (!allowedOrigins.length) {
  throw new Error("CLIENT_ORIGIN is required");
}
if (isProduction && allowAnyOrigin) {
  throw new Error("CLIENT_ORIGIN cannot use '*' in production");
}

function isLocalDevOrigin(origin = "") {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const host = String(url.hostname || "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1";
  } catch (err) {
    return false;
  }
}

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (allowAnyOrigin || allowedOrigins.includes(origin)) return true;
  if (!isProduction && isLocalDevOrigin(origin)) return true;
  return false;
}

const corsOptions = {
  credentials: true,
  origin(origin, callback) {
    if (isOriginAllowed(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed by CORS"));
  }
};

// Fail fast on invalid JWT secret configuration.
getJwtSecret();

const authRateLimit = makeRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: "Too many auth requests. Please try again later.",
  keyGenerator: (req) => {
    const pathKey = String((req && req.path) || "").trim().toLowerCase();
    const forwarded = String((req && req.headers && req.headers["x-forwarded-for"]) || "");
    const firstForwarded = forwarded.split(",")[0].trim();
    const ip = String((req && req.ip) || firstForwarded || (req && req.socket && req.socket.remoteAddress) || "unknown").trim();
    return `${pathKey}:${ip}`;
  }
});

const contactRateLimit = makeRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: "Too many contact form submissions. Please try again later."
});

const reportRateLimit = makeRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: "Too many reports. Please try again later."
});

connectDB(); // connect database

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    credentials: true,
    origin(origin, callback) {
      if (isOriginAllowed(origin)) return callback(null, true);
      return callback(new Error("Origin not allowed by CORS"));
    }
  }
});

io.use((socket, next) => {
  (async () => {
    try {
    const forwarded = String((socket && socket.handshake && socket.handshake.headers && socket.handshake.headers["x-forwarded-for"]) || "");
    const firstForwarded = forwarded.split(",")[0].trim();
    const socketIp = String(firstForwarded || (socket && socket.handshake && socket.handshake.address) || "unknown");
    function rejectUnauthorized(reason = "unauthorized") {
      logger.warn("socket_unauthorized", { authStatus: "unauthorized", ip: socketIp, reason });
      return next(new Error("Unauthorized"));
    }
    const authToken = String((socket.handshake.auth && socket.handshake.auth.token) || "");
    const headerToken = parseAuthHeader(socket.handshake.headers && socket.handshake.headers.authorization);
    const cookieToken = String((parseCookieHeader(socket.handshake.headers && socket.handshake.headers.cookie).auth_token) || "");
    const token = authToken || headerToken || cookieToken;
    if (!token) return rejectUnauthorized("missing_token");
    const decoded = verifyToken(token);
    const sid = String(decoded.sid || "");
    const userId = String(decoded.userId || "");
    const username = String(decoded.username || "");

    if (!userId || !username) return rejectUnauthorized("invalid_token_payload");

    if (sid) {
      const authUser = await User.findById(userId).select("username sessions");
      if (!authUser || String(authUser.username || "") !== username) return rejectUnauthorized("user_not_found");
      const validSession = (authUser.sessions || []).some((entry) => String(entry.sid || "") === sid);
      if (!validSession) return rejectUnauthorized("session_not_found");
    }

    socket.user = {
      userId,
      username,
      sid
    };
    if (!socket.user.userId || !socket.user.username) return rejectUnauthorized("missing_user_context");
    return next();
  } catch (err) {
    logger.warn("socket_unauthorized", { authStatus: "unauthorized", reason: "verify_failed", error: err });
    return next(new Error("Unauthorized"));
  }
  })();
});
let onlineUsers = {};
const pendingCallsByCallee = new Map();
const pendingCallsByCaller = new Map();
const activeCallPeer = new Map();
const activeCallStartAt = new Map();
const activeCallCaller = new Map();
const activeCallReceiver = new Map();
const socketActionRateStore = new Map();
const disconnectGraceTimers = new Map();

const SOCKET_MESSAGE_WINDOW_MS = 60 * 1000;
const SOCKET_MESSAGE_MAX = 35;
const MESSAGE_EDIT_WINDOW_MS = Number(process.env.MESSAGE_EDIT_WINDOW_MS || (15 * 60 * 1000));
const MESSAGE_DELETE_WINDOW_MS = Number(process.env.MESSAGE_DELETE_WINDOW_MS || (15 * 60 * 1000));

function isSocketRateLimited(key, windowMs, max) {
  const now = Date.now();
  const entry = socketActionRateStore.get(key);
  if (!entry || entry.resetAt <= now) {
    socketActionRateStore.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count += 1;
  if (entry.count > max) return true;
  return false;
}

async function emitOnlineUsers() {
  try {
    const raw = Object.values(onlineUsers).filter(Boolean);
    const unique = Array.from(new Set(raw));
    if (!unique.length) {
      io.emit("onlineUsers", []);
      return;
    }
    const docs = await User.find({ username: { $in: unique } }).select("username showOnlineStatus");
    const visibleSet = new Set(
      docs
        .filter((u) => u && u.showOnlineStatus !== false)
        .map((u) => String(u.username || ""))
        .filter(Boolean)
    );
    const visible = unique.filter((u) => visibleSet.has(u));
    io.emit("onlineUsers", visible);
  } catch (err) {
    io.emit("onlineUsers", []);
  }
}

function getSocketIdsByUsername(username) {
  const target = String(username || "");
  if (!target) return [];
  return Object.entries(onlineUsers)
    .filter(([, name]) => String(name || "") === target)
    .map(([socketId]) => socketId);
}

function emitToUser(username, eventName, payload) {
  const ids = getSocketIdsByUsername(username);
  ids.forEach((id) => {
    io.to(id).emit(eventName, payload);
  });
  return ids.length;
}

function getBlockedIdSet(userDoc) {
  const ids = Array.isArray(userDoc && userDoc.blockedUsers) ? userDoc.blockedUsers : [];
  return new Set(ids.map((id) => String(id)));
}

function usersBlockingEachOther(a, b) {
  if (!a || !b) return false;
  const aBlocked = getBlockedIdSet(a).has(String(b._id));
  const bBlocked = getBlockedIdSet(b).has(String(a._id));
  return aBlocked || bBlocked;
}

function normalizeRule(value, fallback = "everyone") {
  const v = String(value || "").trim().toLowerCase();
  return ["everyone", "followers", "none"].includes(v) ? v : fallback;
}

async function isAllowedByRule({ rule, senderUser, receiverUser }) {
  const normalized = normalizeRule(rule);
  if (normalized === "everyone") return true;
  if (normalized === "none") return false;
  if (!senderUser || !receiverUser) return false;
  const populatedSender = await User.findById(senderUser._id).select("following");
  const follows = Array.isArray(populatedSender && populatedSender.following)
    && populatedSender.following.some((id) => String(id) === String(receiverUser._id));
  return follows;
}

function isMediaMessageText(message = "") {
  const text = String(message || "").trim().toLowerCase();
  if (!text) return false;
  if (!(text.startsWith("http://") || text.startsWith("https://") || text.startsWith("/uploads/"))) return false;
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif|mp4|webm|ogg|mov|m4v|mkv)(\?|#|$)/.test(text);
}

function isUserBusy(username) {
  return pendingCallsByCallee.has(username) || pendingCallsByCaller.has(username) || activeCallPeer.has(username);
}

function clearPendingForUser(username) {
  const caller = pendingCallsByCallee.get(username);
  if (caller) {
    pendingCallsByCallee.delete(username);
    pendingCallsByCaller.delete(caller);
  }

  const callee = pendingCallsByCaller.get(username);
  if (callee) {
    pendingCallsByCaller.delete(username);
    pendingCallsByCallee.delete(callee);
  }
}

function startActiveCall(a, b) {
  const startedAt = new Date();
  activeCallPeer.set(a, b);
  activeCallPeer.set(b, a);
  activeCallStartAt.set(a, startedAt);
  activeCallStartAt.set(b, startedAt);
  activeCallCaller.set(a, a);
  activeCallCaller.set(b, a);
  activeCallReceiver.set(a, b);
  activeCallReceiver.set(b, b);
}

function endActiveCallForUser(username) {
  const peer = activeCallPeer.get(username);
  const startedAt = activeCallStartAt.get(username) || null;
  const caller = activeCallCaller.get(username) || null;
  const receiver = activeCallReceiver.get(username) || null;
  if (peer) {
    activeCallPeer.delete(peer);
    activeCallStartAt.delete(peer);
    activeCallCaller.delete(peer);
    activeCallReceiver.delete(peer);
  }
  activeCallPeer.delete(username);
  activeCallStartAt.delete(username);
  activeCallCaller.delete(username);
  activeCallReceiver.delete(username);
  return { peer, startedAt, caller, receiver };
}

async function getUserId(username) {
  if (!username) return null;
  const user = await User.findOne({ username }).select("_id");
  return user ? user._id : null;
}

async function createCallLog({ callerUsername, receiverUsername, status, durationSec = 0, startedAt = null, endedAt = null, endReason = "" }) {
  try {
    const callerId = await getUserId(callerUsername);
    const receiverId = await getUserId(receiverUsername);
    if (!callerId || !receiverId) return;

    const payload = {
      callerId,
      receiverId,
      status,
      durationSec: Math.max(0, durationSec | 0),
      endReason
    };

    if (startedAt) payload.startedAt = startedAt;
    if (endedAt) payload.endedAt = endedAt;

    await CallLog.create(payload);
    if (status === "missed" && callerUsername && receiverUsername && callerUsername !== receiverUsername) {
      await createNotification({
        recipientUsername: receiverUsername,
        actorUsername: callerUsername,
        type: "call_missed",
        text: `Missed call from @${callerUsername}`,
        entityType: "call",
        entityId: "",
        link: "voice-call.html"
      });
    }
  } catch (err) {
    logger.warn("call_log_save_error", { error: err });
  }
}


io.on("connection", (socket) => {
  const authUser = socket.user || {};
  const authUsername = authUser.username;
  logger.info("socket_connected", { username: authUsername || "unknown" });
  if (authUsername) {
    const pendingTimer = disconnectGraceTimers.get(authUsername);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      disconnectGraceTimers.delete(authUsername);
    }
    onlineUsers[socket.id] = authUsername;
    User.updateOne(
      { username: authUsername },
      { $set: { isOnline: true, lastSeen: new Date() } }
    ).catch(() => {});
    emitOnlineUsers();
  }
    socket.on("joinRoom", (room) => {
  socket.join(room);
});


  socket.on("userOnline", () => {
    if (!authUsername) return;
    onlineUsers[socket.id] = authUsername;
    emitOnlineUsers();
  });

  socket.on("refreshOnlineUsers", () => {
    if (!authUsername) return;
    onlineUsers[socket.id] = authUsername;
    emitOnlineUsers();
  });

socket.on("sendMessage", async (data, ack) => {
  try {
    if (!authUsername || !data || !data.receiver || !data.message || !data.room) {
      if (typeof ack === "function") ack({ ok: false, error: "Invalid request" });
      return;
    }
    const rateKey = `msg:${authUsername}`;
    if (isSocketRateLimited(rateKey, SOCKET_MESSAGE_WINDOW_MS, SOCKET_MESSAGE_MAX)) {
      if (typeof ack === "function") ack({ ok: false, error: "Too many messages. Please slow down." });
      return;
    }

    // find users by username
    const senderUser = await User.findOne({ username: authUsername }).select("_id username blockedUsers following");
    const receiverUser = await User.findOne({ username: data.receiver }).select("_id username blockedUsers mutedUsers privacySettings");

    if (!senderUser || !receiverUser) {
      if (typeof ack === "function") ack({ ok: false, error: "User not found" });
      return;
    }
    if (usersBlockingEachOther(senderUser, receiverUser)) {
      if (typeof ack === "function") ack({ ok: false, error: "Messaging is blocked with this user" });
      return;
    }
    const messageAllowed = await isAllowedByRule({
      rule: receiverUser && receiverUser.privacySettings ? receiverUser.privacySettings.allowMessagesFrom : "everyone",
      senderUser,
      receiverUser
    });
    if (!messageAllowed) {
      if (typeof ack === "function") ack({ ok: false, error: "This user does not allow messages" });
      return;
    }
    const cleanMessage = String(data.message || "").trim();
    const issue = findModerationIssue(cleanMessage);
    if (issue) {
      if (typeof ack === "function") ack({ ok: false, error: issue.message, code: issue.code });
      return;
    }

    // save message
    const newMessage = new Message({
      senderId: senderUser._id,
      receiverId: receiverUser._id,
      message: cleanMessage
    });

    await newMessage.save();
    const mutedUsers = Array.isArray(receiverUser.mutedUsers) ? receiverUser.mutedUsers.map((u) => String(u || "")) : [];
    if (!mutedUsers.includes(authUsername)) {
      await createNotification({
        recipientUsername: data.receiver,
        actorUsername: authUsername,
        type: "message",
        text: `New message from @${authUsername}`,
        entityType: "message",
        entityId: String(newMessage._id),
        link: "chat.html"
      });
    }

    // emit to others in the room (exclude the sender) to avoid duplicate on sender
    socket.to(data.room).emit("receiveMessage", {
      sender: authUsername,
      receiver: data.receiver,
      message: cleanMessage,
      room: data.room,
      isFile: !!data.isFile,
      _id: newMessage._id
    });

    if (typeof ack === "function") ack({ ok: true, messageId: String(newMessage._id) });

  } catch (err) {
    logger.warn("socket_send_message_error", { error: err });
    if (typeof ack === "function") ack({ ok: false, error: err.message || "Send failed" });
  }
});



socket.on("typing", (data) => {
  if (!data || !data.room || !authUsername) return;
  socket.to(data.room).emit("userTyping", authUsername);
});

socket.on("messageSeen", async (data) => {
  try {
    const messageId = String((data && data.messageId) || "");
    if (messageId) {
      await Message.updateOne(
        { _id: messageId, receiverId: socket.user.userId },
        { $set: { seen: true } }
      );
    }
  } catch (err) {
    // no-op
  }
  if (data && data.room && data.messageId) {
    io.to(data.room).emit("messageSeenUpdate", data.messageId);
  }
});

socket.on("reactMessage", async (data, ack) => {
  try {
    if (!authUsername || !data || !data.messageId || !data.room) {
      if (typeof ack === "function") ack({ ok: false, error: "Invalid request" });
      return;
    }

    const emoji = String((data && data.emoji) || "").trim().slice(0, 16);
    if (!emoji) {
      if (typeof ack === "function") ack({ ok: false, error: "Emoji is required" });
      return;
    }

    const actor = await User.findOne({ username: authUsername }).select("_id username");
    if (!actor) {
      if (typeof ack === "function") ack({ ok: false, error: "User not found" });
      return;
    }

    const msg = await Message.findById(data.messageId).select("senderId receiverId reactions");
    if (!msg) {
      if (typeof ack === "function") ack({ ok: false, error: "Message not found" });
      return;
    }

    const isParticipant = String(msg.senderId || "") === String(actor._id || "")
      || String(msg.receiverId || "") === String(actor._id || "");
    if (!isParticipant) {
      if (typeof ack === "function") ack({ ok: false, error: "Not allowed" });
      return;
    }

    const list = Array.isArray(msg.reactions) ? msg.reactions : [];
    const idx = list.findIndex((r) => String((r && r.username) || "") === authUsername);
    let removed = false;
    if (idx >= 0) {
      const prev = String((list[idx] && list[idx].emoji) || "");
      if (prev === emoji) {
        list.splice(idx, 1);
        removed = true;
      } else {
        list[idx].emoji = emoji;
        list[idx].createdAt = new Date();
      }
    } else {
      list.push({ username: authUsername, emoji, createdAt: new Date() });
    }
    msg.reactions = list;
    await msg.save();

    const normalized = (msg.reactions || []).map((r) => ({
      username: String((r && r.username) || ""),
      emoji: String((r && r.emoji) || ""),
      createdAt: (r && r.createdAt) || null
    }));
    io.to(data.room).emit("messageReactionUpdated", {
      messageId: String(msg._id),
      reactions: normalized
    });
    if (typeof ack === "function") ack({ ok: true, removed, reactions: normalized });
  } catch (err) {
    if (typeof ack === "function") ack({ ok: false, error: err.message || "Reaction failed" });
  }
});

socket.on("editMessage", async (data, ack) => {
  try {
    if (!data || !data.messageId || !data.room || !authUsername) {
      if (typeof ack === "function") ack({ ok: false, error: "Invalid request" });
      return;
    }

    const requesterUser = await User.findOne({ username: authUsername }).select("_id");
    if (!requesterUser) {
      if (typeof ack === "function") ack({ ok: false, error: "User not found" });
      return;
    }

    const msg = await Message.findById(data.messageId);
    if (!msg) {
      if (typeof ack === "function") ack({ ok: false, error: "Message not found" });
      return;
    }
    if (String(msg.senderId) !== String(requesterUser._id)) {
      if (typeof ack === "function") ack({ ok: false, error: "Not allowed" });
      return;
    }
    const createdAtMs = new Date(msg.createdAt || 0).getTime();
    if (!createdAtMs || (Date.now() - createdAtMs) > MESSAGE_EDIT_WINDOW_MS) {
      if (typeof ack === "function") ack({ ok: false, error: "Edit window expired" });
      return;
    }
    if (isMediaMessageText(msg.message)) {
      if (typeof ack === "function") ack({ ok: false, error: "Media messages cannot be edited" });
      return;
    }

    const cleanMessage = String(data.message || "").trim();
    if (!cleanMessage) {
      if (typeof ack === "function") ack({ ok: false, error: "Message is required" });
      return;
    }
    const issue = findModerationIssue(cleanMessage);
    if (issue) {
      if (typeof ack === "function") ack({ ok: false, error: issue.message, code: issue.code });
      return;
    }

    msg.message = cleanMessage;
    await msg.save();
    io.to(data.room).emit("messageEdited", {
      messageId: String(msg._id),
      message: cleanMessage,
      editedAt: msg.updatedAt
    });
    if (typeof ack === "function") ack({ ok: true, messageId: String(msg._id) });
  } catch (err) {
    if (typeof ack === "function") ack({ ok: false, error: err.message || "Edit failed" });
  }
});

socket.on("deleteMessage", async (data, ack) => {
  try {
    if (!data || !data.messageId || !data.room || !authUsername) {
      if (typeof ack === "function") ack({ ok: false, error: "Invalid request" });
      return;
    }

    const requesterUser = await User.findOne({ username: authUsername });
    if (!requesterUser) {
      if (typeof ack === "function") ack({ ok: false, error: "User not found" });
      return;
    }

    const msg = await Message.findById(data.messageId);
    if (!msg) {
      if (typeof ack === "function") ack({ ok: false, error: "Message not found" });
      return;
    }

    if (String(msg.senderId) !== String(requesterUser._id)) {
      if (typeof ack === "function") ack({ ok: false, error: "Not allowed" });
      return;
    }
    const createdAtMs = new Date(msg.createdAt || 0).getTime();
    if (!createdAtMs || (Date.now() - createdAtMs) > MESSAGE_DELETE_WINDOW_MS) {
      if (typeof ack === "function") ack({ ok: false, error: "Delete window expired" });
      return;
    }

    await Message.deleteOne({ _id: msg._id });
    io.to(data.room).emit("messageDeleted", { messageId: String(msg._id) });
    if (typeof ack === "function") ack({ ok: true, messageId: String(msg._id) });
  } catch (err) {
    if (typeof ack === "function") ack({ ok: false, error: err.message || "Delete failed" });
  }
});

socket.on("fileMessage", (data) => {
  io.to(data.to).emit("receiveFile", {
    name: data.name,
    file: data.file,
    from: socket.id
  });
});

socket.on("voice:call-offer", (data) => {
  (async () => {
  try {
  if (!authUsername || !data || !data.to || !data.offer) return;
  const from = authUsername;
  const to = data.to;
  const callType = String((data && data.callType) || "voice").toLowerCase() === "video" ? "video" : "voice";
  const callerUser = await User.findOne({ username: from }).select("_id username following");
  const calleeUser = await User.findOne({ username: to }).select("_id username privacySettings");
  const callAllowed = await isAllowedByRule({
    rule: calleeUser && calleeUser.privacySettings ? calleeUser.privacySettings.allowCallsFrom : "everyone",
    senderUser: callerUser,
    receiverUser: calleeUser
  });
  if (!callAllowed) {
    socket.emit("voice:user-unavailable", { to });
    return;
  }

  const targetSocketIds = getSocketIdsByUsername(to);
  if (!targetSocketIds.length) {
    socket.emit("voice:user-unavailable", { to });
    return;
  }

  if (isUserBusy(from) || isUserBusy(to)) {
    socket.emit("voice:busy", { to });
    return;
  }

  pendingCallsByCallee.set(to, from);
  pendingCallsByCaller.set(from, to);

  targetSocketIds.forEach((id) => {
    io.to(id).emit("voice:call-offer", {
      from,
      offer: data.offer,
      callType
    });
  });
  } catch (err) {
    socket.emit("voice:user-unavailable", { to: data && data.to ? data.to : "" });
  }
  })();
});

socket.on("voice:call-answer", (data) => {
  if (!authUsername || !data || !data.to || !data.answer) return;
  const from = authUsername;
  const to = data.to;
  const expectedCaller = pendingCallsByCallee.get(from);
  if (expectedCaller !== to) return;

  clearPendingForUser(from);
  clearPendingForUser(to);
  startActiveCall(to, from);

  emitToUser(to, "voice:call-answer", {
    from,
    answer: data.answer
  });
});

socket.on("voice:ice-candidate", (data) => {
  if (!authUsername || !data || !data.to || !data.candidate) return;
  const from = authUsername;
  emitToUser(data.to, "voice:ice-candidate", {
    from,
    candidate: data.candidate
  });
});

socket.on("voice:call-reject", (data) => {
  if (!authUsername || !data || !data.to) return;
  const from = authUsername;
  const to = data.to;
  const reason = data.reason || "rejected";

  clearPendingForUser(from);
  clearPendingForUser(to);
  const rejectedStatus = reason === "busy" ? "missed" : "rejected";
  createCallLog({
    callerUsername: to,
    receiverUsername: from,
    status: rejectedStatus,
    durationSec: 0,
    endReason: reason,
    endedAt: new Date()
  });

  emitToUser(to, "voice:call-reject", {
    from,
    reason
  });
});

socket.on("voice:hangup", (data) => {
  if (!authUsername || !data) return;
  const from = authUsername;
  const reason = data.reason || "ended";
  const pendingPeerAsCaller = pendingCallsByCaller.get(from) || null;
  const pendingPeerAsCallee = pendingCallsByCallee.get(from) || null;

  clearPendingForUser(from);
  if (data.to) clearPendingForUser(data.to);
  const active = endActiveCallForUser(from);
  if (data.to) endActiveCallForUser(data.to);

  const target = data.to || active.peer || pendingPeerAsCaller || pendingPeerAsCallee;
  if (!target) return;

  if (active.peer) {
    const endedAt = new Date();
    const durationSec = active.startedAt ? Math.floor((endedAt.getTime() - new Date(active.startedAt).getTime()) / 1000) : 0;
    createCallLog({
      callerUsername: active.caller || from,
      receiverUsername: active.receiver || target,
      status: "completed",
      durationSec,
      startedAt: active.startedAt,
      endedAt,
      endReason: reason
    });
  } else {
    const pendingStatus = reason === "no-answer" ? "missed" : "cancelled";
    createCallLog({
      callerUsername: from,
      receiverUsername: target,
      status: pendingStatus,
      durationSec: 0,
      endedAt: new Date(),
      endReason: reason
    });
  }

  emitToUser(target, "voice:hangup", {
    from,
    reason
  });
});


  socket.on("disconnect", () => {
    const disconnectedUsername = onlineUsers[socket.id];
    delete onlineUsers[socket.id];

    if (disconnectedUsername) {
      const stillOnline = getSocketIdsByUsername(disconnectedUsername).length > 0;
      if (!stillOnline) {
        User.updateOne(
          { username: disconnectedUsername },
          { $set: { isOnline: false, lastSeen: new Date() } }
        ).catch(() => {});
        const existing = disconnectGraceTimers.get(disconnectedUsername);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
          disconnectGraceTimers.delete(disconnectedUsername);
          const reconnected = getSocketIdsByUsername(disconnectedUsername).length > 0;
          if (reconnected) return;

          const pendingCaller = pendingCallsByCallee.get(disconnectedUsername);
          if (pendingCaller) {
            emitToUser(pendingCaller, "voice:call-reject", {
              from: disconnectedUsername,
              reason: "offline"
            });
          }

          clearPendingForUser(disconnectedUsername);

          const peer = endActiveCallForUser(disconnectedUsername);
          if (peer.peer) {
            const endedAt = new Date();
            const durationSec = peer.startedAt ? Math.floor((endedAt.getTime() - new Date(peer.startedAt).getTime()) / 1000) : 0;
            createCallLog({
              callerUsername: peer.caller || disconnectedUsername,
              receiverUsername: peer.receiver || peer.peer,
              status: "completed",
              durationSec,
              startedAt: peer.startedAt,
              endedAt,
              endReason: "offline"
            });

            emitToUser(peer.peer, "voice:hangup", {
              from: disconnectedUsername,
              reason: "offline"
            });
          }
        }, 4000);
        disconnectGraceTimers.set(disconnectedUsername, timer);
      }
    }


    emitOnlineUsers();

    logger.info("socket_disconnected", { username: disconnectedUsername || "unknown" });
  });
});

app.use(express.json());
app.use(cors(corsOptions));
app.use(requestContext);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
  if (isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdn.socket.io https://fonts.googleapis.com",
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://fonts.googleapis.com https://fonts.gstatic.com",
      "img-src 'self' data: blob: https: http:",
      "media-src 'self' data: blob: https: http:",
      "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",
      "connect-src 'self' https: http: wss: ws:",
      "frame-ancestors 'self'"
    ].join("; ")
  );
  return next();
});
app.use(requireCsrf);
app.use("/uploads", express.static("uploads"));

const userRoutes = require("./routes/userRoutes");
app.use("/api/users", userRoutes);

const authRoutes = require("./routes/authRoutes");
app.use("/api/auth", authRateLimit, authRoutes);

const messageRoutes = require("./routes/messageRoutes");
app.use("/api/messages", messageRoutes);

const contactRoutes = require("./routes/contactRoutes");
app.use("/api/contact", contactRateLimit, contactRoutes);

const postRoutes = require("./routes/postRoutes");
app.use("/api/posts", postRoutes);

const callRoutes = require("./routes/callRoutes");
app.use("/api/calls", callRoutes);

const storyRoutes = require("./routes/storyRoutes");
app.use("/api/stories", storyRoutes);
const notificationRoutes = require("./routes/notificationRoutes");
app.use("/api/notifications", notificationRoutes);
const reportRoutes = require("./routes/reportRoutes");
app.use("/api/reports", reportRateLimit, reportRoutes);
const adminRoutes = require("./routes/adminRoutes");
app.use("/api/admin", adminRoutes);
const searchRoutes = require("./routes/searchRoutes");
app.use("/api/search", searchRoutes);

let healthRedisClient = null;

async function checkRedisHealth() {
  if (!process.env.REDIS_URL) return { configured: false, status: "not_configured" };
  try {
    if (!healthRedisClient) {
      // eslint-disable-next-line global-require, import/no-extraneous-dependencies
      const Redis = require("ioredis");
      healthRedisClient = new Redis(process.env.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 800
      });
      await healthRedisClient.connect().catch(() => {});
    }
    const pong = await healthRedisClient.ping();
    return { configured: true, status: String(pong || "").toLowerCase() === "pong" ? "up" : "degraded" };
  } catch (err) {
    return { configured: true, status: "down", error: String((err && err.message) || "redis_error") };
  }
}

async function getSystemHealthSnapshot() {
  const dbReadyState = Number((mongoose && mongoose.connection && mongoose.connection.readyState) || 0);
  const dbUp = dbReadyState === 1;
  const redis = await checkRedisHealth();
  const up = dbUp && (redis.status === "up" || redis.status === "not_configured");
  return {
    status: up ? "ok" : "degraded",
    now: new Date().toISOString(),
    uptimeSec: Math.floor(process.uptime()),
    services: {
      db: {
        status: dbUp ? "up" : "down",
        readyState: dbReadyState
      },
      redis
    }
  };
}

app.get("/api/health", async (req, res) => {
  try {
    const health = await getSystemHealthSnapshot();
    return res.status(health.status === "ok" ? 200 : 503).json(health);
  } catch (err) {
    logger.error("health_endpoint_failed", { requestId: req.requestId, error: err });
    return res.status(503).json({ status: "down", message: "health check failed" });
  }
});

const HEALTH_MONITOR_INTERVAL_MS = Math.max(
  10 * 1000,
  (parseInt(process.env.HEALTH_MONITOR_INTERVAL_SEC || "60", 10) || 60) * 1000
);
const HEALTH_ALERT_COOLDOWN_MS = Math.max(
  10 * 1000,
  (parseInt(process.env.HEALTH_ALERT_COOLDOWN_SEC || "300", 10) || 300) * 1000
);
const HEALTH_ALERT_EMAIL_TO = String(process.env.HEALTH_ALERT_EMAIL_TO || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

let lastHealthStatus = null;
let lastHealthAlertAt = 0;
let healthEmailWarned = false;

async function maybeSendHealthAlertEmail(subject, body) {
  if (!HEALTH_ALERT_EMAIL_TO.length) return;
  if (!isSmtpConfigured()) {
    if (!healthEmailWarned) {
      healthEmailWarned = true;
      logger.warn("health_alert_email_not_sent_smtp_unconfigured", {
        recipients: HEALTH_ALERT_EMAIL_TO
      });
    }
    return;
  }
  await sendMail({
    to: HEALTH_ALERT_EMAIL_TO.join(","),
    subject,
    text: body,
    html: `<pre style="font-family:monospace">${body}</pre>`
  });
}

function scheduleHealthMonitoring() {
  async function runHealthCheck() {
    try {
      const health = await getSystemHealthSnapshot();
      const now = Date.now();
      const previous = lastHealthStatus;
      const changed = previous !== health.status;

      if (health.status !== "ok") {
        if (changed || (now - lastHealthAlertAt) >= HEALTH_ALERT_COOLDOWN_MS) {
          logger.error("health_degraded_alert", {
            previousStatus: previous || "unknown",
            currentStatus: health.status,
            services: health.services
          });
          await maybeSendHealthAlertEmail(
            `[ASCAPDX] Health degraded (${health.status})`,
            JSON.stringify(
              {
                previousStatus: previous || "unknown",
                currentStatus: health.status,
                services: health.services,
                now: health.now
              },
              null,
              2
            )
          );
          lastHealthAlertAt = now;
        }
      } else if (previous && previous !== "ok") {
        logger.info("health_recovered_alert", {
          previousStatus: previous,
          currentStatus: health.status,
          services: health.services
        });
        await maybeSendHealthAlertEmail(
          "[ASCAPDX] Health recovered",
          JSON.stringify(
            {
              previousStatus: previous,
              currentStatus: health.status,
              services: health.services,
              now: health.now
            },
            null,
            2
          )
        );
      }

      lastHealthStatus = health.status;
    } catch (err) {
      logger.warn("health_monitor_failed", { error: err });
    }
  }

  runHealthCheck().catch(() => {});
  const timer = setInterval(() => {
    runHealthCheck().catch(() => {});
  }, HEALTH_MONITOR_INTERVAL_MS);
  if (timer && typeof timer.unref === "function") timer.unref();
}

function scheduleRetentionCleanup() {
  const daysSecurity = Math.max(1, parseInt(process.env.SECURITY_EVENT_RETENTION_DAYS || "90", 10) || 90);
  const daysOtp = Math.max(1, parseInt(process.env.OTP_TELEMETRY_RETENTION_DAYS || "30", 10) || 30);

  async function runCleanup() {
    try {
      const securityCutoff = new Date(Date.now() - daysSecurity * 24 * 60 * 60 * 1000);
      const otpCutoff = new Date(Date.now() - daysOtp * 24 * 60 * 60 * 1000);
      const [securityResult, otpResult] = await Promise.all([
        SecurityEvent.deleteMany({ createdAt: { $lt: securityCutoff } }),
        OtpDeliveryEvent.deleteMany({ createdAt: { $lt: otpCutoff } })
      ]);
      logger.info("retention_cleanup_ran", {
        securityDeleted: Number((securityResult && securityResult.deletedCount) || 0),
        otpDeleted: Number((otpResult && otpResult.deletedCount) || 0),
        securityRetentionDays: daysSecurity,
        otpRetentionDays: daysOtp
      });
    } catch (err) {
      logger.warn("retention_cleanup_failed", { error: err });
    }
  }

  runCleanup().catch(() => {});
  const timer = setInterval(runCleanup, 12 * 60 * 60 * 1000);
  if (timer && typeof timer.unref === "function") timer.unref();
}

scheduleRetentionCleanup();
scheduleHealthMonitoring();
scheduleBackupValidation();


const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const MAX_UPLOAD_MB = Math.min(Math.max(parseInt(process.env.UPLOAD_MAX_MB || "100", 10) || 100, 5), 500);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    if (!file || !file.mimetype) return cb(new Error("Invalid file"));
    if (file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/")) return cb(null, true);
    return cb(new Error("Only image/video files are allowed"));
  }
});

app.post("/upload", requireAuth, (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ message: `File exceeds ${MAX_UPLOAD_MB} MB limit` });
      }
      return res.status(400).json({ message: err.message || "Upload failed" });
    }
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }
    const signatureCheck = await validateStoredMediaFile(req.file.path, req.file.mimetype).catch(() => ({ ok: false }));
    if (!signatureCheck.ok) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ message: "Invalid or unsupported media file" });
    }
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    return res.json({
      fileUrl: `${baseUrl}/uploads/${req.file.filename}`,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname
    });
  });
});

app.use((err, req, res, next) => {
  if (!err) return next();
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "File exceeds size limit" });
    }
    return res.status(400).json({ message: err.message || "Upload failed" });
  }
  if (/Only image\/video files are allowed/i.test(String(err.message || ""))) {
    return res.status(400).json({ message: "Only image/video files are allowed" });
  }
  return next(err);
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    logger.error("server_port_in_use", { port: PORT });
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  logger.info("server_started", { port: PORT, nodeEnv: process.env.NODE_ENV || "development" });
});

