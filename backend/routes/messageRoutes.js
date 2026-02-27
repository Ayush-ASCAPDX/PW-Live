const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Message = require("../models/Message");
const User = require("../models/User");
const { requireAuth } = require("../middleware/auth");
const { makeRateLimiter } = require("../middleware/rateLimit");
const { createNotification } = require("../utils/notifications");
const { findModerationIssue } = require("../utils/moderation");

function getBlockedIdSet(userDoc) {
  const ids = Array.isArray(userDoc && userDoc.blockedUsers) ? userDoc.blockedUsers : [];
  return new Set(ids.map((id) => String(id)));
}

function hasBlocked(userDoc, otherId) {
  if (!userDoc || !otherId) return false;
  return getBlockedIdSet(userDoc).has(String(otherId));
}

function normalizeRule(value, fallback = "everyone") {
  const v = String(value || "").trim().toLowerCase();
  return ["everyone", "followers", "none"].includes(v) ? v : fallback;
}

const sendMessageRateLimit = makeRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many messages. Please slow down.",
  keyGenerator: (req) => String((req.auth && req.auth.username) || req.ip || "unknown")
});

// SEND MESSAGE
router.post("/send", requireAuth, sendMessageRateLimit, async (req, res) => {
  try {
    const { receiverId, message } = req.body;
    const senderId = req.auth.userId;
    const senderUsername = req.auth.username;
    if (!receiverId || !message) {
      return res.status(400).json({ message: "receiverId and message are required" });
    }
    const cleanMessage = String(message || "").trim();
    if (!cleanMessage) return res.status(400).json({ message: "message is required" });
    const issue = findModerationIssue(cleanMessage);
    if (issue) return res.status(400).json({ message: issue.message, code: issue.code });

    const senderUser = await User.findById(senderId).select("username blockedUsers");
    const receiver = await User.findById(receiverId).select("username blockedUsers privacySettings");
    if (!senderUser || !receiver) {
      return res.status(404).json({ message: "User not found" });
    }
    if (hasBlocked(senderUser, receiver._id) || hasBlocked(receiver, senderUser._id)) {
      return res.status(403).json({ message: "Messaging is not allowed with this user" });
    }
    const msgRule = normalizeRule(receiver.privacySettings && receiver.privacySettings.allowMessagesFrom, "everyone");
    if (msgRule === "none") return res.status(403).json({ message: "This user does not allow messages" });
    if (msgRule === "followers") {
      const populatedSender = await User.findById(senderUser._id).select("following");
      const follows = Array.isArray(populatedSender && populatedSender.following)
        && populatedSender.following.some((id) => String(id) === String(receiver._id));
      if (!follows) return res.status(403).json({ message: "Only followers can message this user" });
    }

    const newMessage = new Message({ senderId, receiverId, message: cleanMessage });
    await newMessage.save();

    if (receiver && receiver.username) {
      await createNotification({
        recipientUsername: receiver.username,
        actorUsername: senderUsername,
        type: "message",
        text: `New message from @${senderUsername}`,
        entityType: "message",
        entityId: String(newMessage._id),
        link: "chat.html"
      });
    }

    res.json({ message: "Message sent", newMessage });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET CHAT HISTORY
router.get("/:senderId/:receiverId", requireAuth, async (req, res) => {
  try {
    const actorId = String(req.auth.userId);
    const allowed = actorId === String(req.params.senderId) || actorId === String(req.params.receiverId);
    if (!allowed) return res.status(403).json({ message: "Forbidden" });
    const senderUser = await User.findById(req.params.senderId).select("blockedUsers");
    const receiverUser = await User.findById(req.params.receiverId).select("blockedUsers");
    if (!senderUser || !receiverUser) return res.status(404).json({ message: "User not found" });
    if (hasBlocked(senderUser, receiverUser._id) || hasBlocked(receiverUser, senderUser._id)) {
      return res.status(403).json({ message: "Chat unavailable" });
    }

    const messages = await Message.find({
      $or: [
        { senderId: req.params.senderId, receiverId: req.params.receiverId },
        { senderId: req.params.receiverId, receiverId: req.params.senderId }
      ]
    }).sort({ createdAt: 1 }).populate('senderId', 'username').populate('receiverId', 'username');

    res.json(messages);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// GET CHAT HISTORY BY USERNAMES (convenience endpoint for frontend)
router.get('/history/:senderUsername/:receiverUsername', requireAuth, async (req, res) => {
  try {
    const { receiverUsername } = req.params;
    const senderUsername = req.auth.username;

    const sender = await User.findOne({ username: senderUsername }).select("_id username blockedUsers");
    const receiver = await User.findOne({ username: receiverUsername }).select("_id username blockedUsers");

    if (!sender || !receiver) return res.status(404).json({ message: 'User(s) not found' });
    if (hasBlocked(sender, receiver._id) || hasBlocked(receiver, sender._id)) {
      return res.status(403).json({ message: "Chat unavailable" });
    }
    await Message.updateMany(
      { senderId: receiver._id, receiverId: sender._id, seen: false },
      { $set: { seen: true } }
    );

    const messages = await Message.find({
      $or: [
        { senderId: sender._id, receiverId: receiver._id },
        { senderId: receiver._id, receiverId: sender._id }
      ]
    }).sort({ createdAt: 1 }).populate('senderId', 'username').populate('receiverId', 'username');

    // normalize output to include sender username and isFile flag if needed
    const out = messages.map(m => ({
      _id: m._id,
      sender: m.senderId.username,
      receiver: m.receiverId.username,
      message: m.message,
      createdAt: m.createdAt,
      isFile: m.message && (typeof m.message === 'string') && m.message.startsWith('http'),
      reactions: Array.isArray(m.reactions) ? m.reactions : []
    }));

    res.json(out);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/threads", requireAuth, async (req, res) => {
  try {
    const me = new mongoose.Types.ObjectId(req.auth.userId);
    const meDoc = await User.findById(req.auth.userId).select("_id blockedUsers");
    if (!meDoc) return res.status(404).json({ message: "User not found" });
    const myBlockedSet = getBlockedIdSet(meDoc);

    const grouped = await Message.aggregate([
      {
        $match: {
          $or: [{ senderId: me }, { receiverId: me }]
        }
      },
      { $sort: { createdAt: -1 } },
      {
        $project: {
          senderId: 1,
          receiverId: 1,
          message: 1,
          createdAt: 1,
          peerId: {
            $cond: [{ $eq: ["$senderId", me] }, "$receiverId", "$senderId"]
          },
          unreadIncoming: {
            $cond: [
              {
                $and: [
                  { $eq: ["$receiverId", me] },
                  { $eq: ["$seen", false] }
                ]
              },
              1,
              0
            ]
          }
        }
      },
      {
        $group: {
          _id: "$peerId",
          lastMessage: { $first: "$message" },
          lastMessageAt: { $first: "$createdAt" },
          unreadCount: { $sum: "$unreadIncoming" }
        }
      },
      { $sort: { lastMessageAt: -1 } },
      { $limit: 120 }
    ]);

    const peerIds = grouped.map((item) => item._id).filter(Boolean);
    const peers = await User.find({ _id: { $in: peerIds } }).select("username displayName profilePic blockedUsers");
    const peerById = new Map(peers.map((u) => [String(u._id), u]));

    const items = grouped
      .map((row) => {
        const peer = peerById.get(String(row._id));
        if (!peer) return null;
        const peerId = String(peer._id);
        if (myBlockedSet.has(peerId)) return null;
        if (hasBlocked(peer, meDoc._id)) return null;
        return {
          username: peer.username,
          name: peer.displayName || peer.username,
          avatarUrl: peer.profilePic || "",
          lastMessage: row.lastMessage || "",
          lastMessageAt: row.lastMessageAt || null,
          unreadCount: Number(row.unreadCount || 0)
        };
      })
      .filter(Boolean);

    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch threads", error: err.message });
  }
});

router.delete("/conversation/:targetUsername", requireAuth, async (req, res) => {
  try {
    const actorUsername = req.auth.username;
    const targetUsername = String(req.params.targetUsername || "").trim();
    if (!targetUsername) return res.status(400).json({ message: "targetUsername is required" });
    if (actorUsername === targetUsername) return res.status(400).json({ message: "Invalid target user" });

    const actor = await User.findOne({ username: actorUsername }).select("_id");
    const target = await User.findOne({ username: targetUsername }).select("_id");
    if (!actor || !target) return res.status(404).json({ message: "User not found" });

    const result = await Message.deleteMany({
      $or: [
        { senderId: actor._id, receiverId: target._id },
        { senderId: target._id, receiverId: actor._id }
      ]
    });
    return res.json({
      message: "Conversation deleted",
      deletedCount: Number(result && result.deletedCount ? result.deletedCount : 0)
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to delete conversation" });
  }
});

module.exports = router;
