const express = require("express");
const router = express.Router();
const Notification = require("../models/Notification");
const { requireAuth } = require("../middleware/auth");

function normalizeNotification(item) {
  return {
    id: item._id,
    recipientUsername: item.recipientUsername,
    actorUsername: item.actorUsername || "",
    type: item.type,
    text: item.text,
    entityType: item.entityType || "",
    entityId: item.entityId || "",
    link: item.link || "",
    read: !!item.readAt,
    readAt: item.readAt || null,
    createdAt: item.createdAt
  };
}

function groupNotifications(items = []) {
  const map = new Map();
  items.forEach((item) => {
    const key = `${String(item.type || "")}::${String(item.entityType || "")}::${String(item.entityId || "")}`;
    if (!map.has(key)) {
      map.set(key, {
        id: String(item._id),
        type: String(item.type || ""),
        entityType: String(item.entityType || ""),
        entityId: String(item.entityId || ""),
        actorUsernames: [],
        count: 0,
        latestAt: item.createdAt || null,
        read: true,
        link: String(item.link || "")
      });
    }
    const grouped = map.get(key);
    const actor = String(item.actorUsername || "").trim();
    if (actor && !grouped.actorUsernames.includes(actor)) grouped.actorUsernames.push(actor);
    grouped.count += 1;
    grouped.read = grouped.read && !!item.readAt;
    if (item.createdAt && new Date(item.createdAt).getTime() > new Date(grouped.latestAt || 0).getTime()) {
      grouped.latestAt = item.createdAt;
      grouped.link = String(item.link || grouped.link || "");
    }
  });
  return Array.from(map.values())
    .sort((a, b) => new Date(b.latestAt || 0).getTime() - new Date(a.latestAt || 0).getTime())
    .map((g) => {
      const actors = g.actorUsernames.slice(0, 3);
      const actorText = actors.length ? actors.map((u) => `@${u}`).join(", ") : "Someone";
      const actionText = g.type === "like"
        ? "liked your post"
        : g.type === "comment"
          ? "commented on your post"
          : g.type === "reply"
            ? "replied to your comment"
            : g.type === "mention"
              ? "mentioned you"
            : g.type === "follow"
              ? "started following you"
              : g.type === "follow_request"
                ? "requested to follow you"
              : g.type === "message"
                ? "sent you a message"
                : g.type === "collection_save"
                  ? "saved your post to a collection"
                  : "interacted with you";
      return {
        id: g.id,
        type: g.type,
        text: g.count > 1 ? `${actorText} and ${g.count - actors.length} others ${actionText}` : `${actorText} ${actionText}`,
        count: g.count,
        read: g.read,
        link: g.link,
        createdAt: g.latestAt,
        grouped: true
      };
    });
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const username = req.auth.username;
    const limitRaw = parseInt(req.query.limit || "30", 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 30;

    const query = { recipientUsername: username };
    if (req.query.before) {
      const before = new Date(req.query.before);
      if (!Number.isNaN(before.getTime())) query.createdAt = { $lt: before };
    }

    const [items, unreadCount] = await Promise.all([
      Notification.find(query).sort({ createdAt: -1 }).limit(limit),
      Notification.countDocuments({ recipientUsername: username, readAt: null })
    ]);
    const grouped = String(req.query.grouped || "").toLowerCase() === "1" || String(req.query.grouped || "").toLowerCase() === "true";

    return res.json({
      unreadCount,
      items: grouped ? groupNotifications(items) : items.map(normalizeNotification)
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch notifications", error: err.message });
  }
});

router.patch("/:notificationId/read", requireAuth, async (req, res) => {
  try {
    const username = req.auth.username;
    const item = await Notification.findOneAndUpdate(
      { _id: req.params.notificationId, recipientUsername: username, readAt: null },
      { $set: { readAt: new Date() } },
      { new: true }
    );

    if (!item) {
      const stillThere = await Notification.findOne({ _id: req.params.notificationId, recipientUsername: username });
      if (!stillThere) return res.status(404).json({ message: "Notification not found" });
      return res.json({ message: "Already read", notification: normalizeNotification(stillThere) });
    }

    return res.json({ message: "Notification marked as read", notification: normalizeNotification(item) });
  } catch (err) {
    return res.status(500).json({ message: "Failed to update notification", error: err.message });
  }
});

router.patch("/read-all", requireAuth, async (req, res) => {
  try {
    const username = req.auth.username;
    const result = await Notification.updateMany(
      { recipientUsername: username, readAt: null },
      { $set: { readAt: new Date() } }
    );
    return res.json({
      message: "All notifications marked as read",
      updatedCount: result.modifiedCount || 0
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to update notifications", error: err.message });
  }
});

module.exports = router;
