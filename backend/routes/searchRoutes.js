const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Post = require("../models/Post");

function escapeRegex(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

router.get("/", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10) || 20, 1), 50);
    if (!q) return res.json({ users: [], posts: [], hashtags: [] });

    const regex = new RegExp(escapeRegex(q), "i");
    const users = await User.find({
      $or: [
        { username: { $regex: regex } },
        { displayName: { $regex: regex } }
      ]
    })
      .select("username displayName profilePic isVerified")
      .limit(limit);

    const posts = await Post.find({
      caption: { $regex: regex },
      archived: false,
      $or: [{ publishAt: { $exists: false } }, { publishAt: { $lte: new Date() } }]
    })
      .select("_id authorUsername authorDisplayName authorAvatarUrl authorVerified caption mediaUrl mediaType createdAt likes")
      .sort({ createdAt: -1 })
      .limit(limit);

    const hashMatches = await Post.find({
      caption: /#[A-Za-z0-9_]{2,40}/,
      archived: false
    })
      .select("caption")
      .sort({ createdAt: -1 })
      .limit(400);

    const hashtagMap = new Map();
    hashMatches.forEach((p) => {
      const tags = String(p.caption || "").match(/#[A-Za-z0-9_]{2,40}/g) || [];
      tags.forEach((tag) => {
        const normalized = String(tag || "").toLowerCase();
        if (!normalized.includes(String(q || "").toLowerCase())) return;
        hashtagMap.set(normalized, (hashtagMap.get(normalized) || 0) + 1);
      });
    });

    const hashtags = Array.from(hashtagMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([tag, count]) => ({ tag, count }));

    return res.json({
      users: users.map((u) => ({
        username: String(u.username || ""),
        name: String(u.displayName || u.username || ""),
        avatarUrl: String(u.profilePic || ""),
        isVerified: !!u.isVerified
      })),
      posts: posts.map((p) => ({
        id: String(p._id),
        authorUsername: String(p.authorUsername || ""),
        authorDisplayName: String(p.authorDisplayName || p.authorUsername || ""),
        authorAvatarUrl: String(p.authorAvatarUrl || ""),
        authorVerified: !!p.authorVerified,
        caption: String(p.caption || ""),
        mediaUrl: String(p.mediaUrl || ""),
        mediaType: String(p.mediaType || ""),
        likesCount: Array.isArray(p.likes) ? p.likes.length : 0,
        createdAt: p.createdAt
      })),
      hashtags
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to search" });
  }
});

module.exports = router;
