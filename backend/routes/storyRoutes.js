const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const Story = require("../models/Story");
const User = require("../models/User");
const { requireAuth, getTokenFromRequest, verifyToken } = require("../middleware/auth");
const { createNotification } = require("../utils/notifications");
const { findModerationIssue } = require("../utils/moderation");
const { validateStoredMediaFile } = require("../utils/mediaValidation");

const uploadsDir = path.join(process.cwd(), "uploads", "stories");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safeExt = path.extname(file.originalname || "").toLowerCase();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
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

function detectMediaType(mimeType = "") {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return null;
}

function getBlockedIdSet(userDoc) {
  const ids = Array.isArray(userDoc && userDoc.blockedUsers) ? userDoc.blockedUsers : [];
  return new Set(ids.map((id) => String(id)));
}

function usersBlockingEachOther(a, b) {
  if (!a || !b) return false;
  const aBlocksB = getBlockedIdSet(a).has(String(b._id));
  const bBlocksA = getBlockedIdSet(b).has(String(a._id));
  return aBlocksB || bBlocksA;
}

function summarizeReactions(items = []) {
  const map = new Map();
  items.forEach((entry) => {
    const emoji = normalizeReactionEmoji((entry && entry.emoji) || "");
    if (!emoji) return;
    map.set(emoji, (map.get(emoji) || 0) + 1);
  });
  return Array.from(map.entries()).map(([emoji, count]) => ({ emoji, count }));
}

const REACTION_EMOJIS = {
  HEART: "\u2764\uFE0F",
  FIRE: "\u{1F525}",
  LAUGH: "\u{1F602}",
  CLAP: "\u{1F44F}",
  LOVE: "\u{1F60D}",
  WOW: "\u{1F62E}",
  SAD: "\u{1F622}",
  ANGRY: "\u{1F621}",
  LIKE: "\u{1F44D}"
};

const ALLOWED_REACTIONS = new Set(Object.values(REACTION_EMOJIS));

function normalizeReactionEmoji(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (ALLOWED_REACTIONS.has(raw)) return raw;

  // Repair mojibake values that were stored with a wrong text encoding.
  try {
    const repaired = Buffer.from(raw, "latin1").toString("utf8").trim();
    if (ALLOWED_REACTIONS.has(repaired)) return repaired;
  } catch (err) {
    // Ignore conversion failures and fall back to raw value.
  }

  return raw;
}

async function getViewerFromReq(req) {
  try {
    const token = getTokenFromRequest(req);
    if (!token) return "";
    const decoded = verifyToken(token);
    return String(decoded.username || "");
  } catch (err) {
    return "";
  }
}

function normalizeStory(story, viewerUsername = "") {
  const reactions = Array.isArray(story.reactions) ? story.reactions : [];
  const views = Array.isArray(story.views) ? story.views : [];
  const myReaction = viewerUsername
    ? (reactions.find((entry) => String(entry.username || "") === viewerUsername) || null)
    : null;

  return {
    id: story._id,
    authorUsername: story.authorUsername,
    authorDisplayName: story.authorDisplayName || story.authorUsername,
    authorAvatarUrl: story.authorAvatarUrl || "",
    mediaUrl: story.mediaUrl,
    mediaType: story.mediaType,
    viewsCount: views.length,
    viewedByMe: viewerUsername ? views.some((entry) => String(entry.username || "") === viewerUsername) : false,
    reactionsCount: reactions.length,
    reactionSummary: summarizeReactions(reactions),
    myReaction: myReaction ? { emoji: normalizeReactionEmoji(myReaction.emoji), reactedAt: myReaction.reactedAt } : null,
    repliesCount: Array.isArray(story.replies) ? story.replies.length : 0,
    createdAt: story.createdAt
  };
}

router.get("/", async (req, res) => {
  try {
    const viewerUsername = await getViewerFromReq(req);
    const viewerUser = viewerUsername
      ? await User.findOne({ username: viewerUsername }).select("_id username blockedUsers")
      : null;
    const limit = Math.min(parseInt(req.query.limit || "200", 10), 300);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const stories = await Story.find({ createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(limit);
    const authorUsernames = Array.from(new Set(stories.map((s) => String(s.authorUsername || "")).filter(Boolean)));
    const authorDocs = await User.find({ username: { $in: authorUsernames } }).select("_id username blockedUsers");
    const authorMap = new Map(authorDocs.map((u) => [String(u.username), u]));
    const visibleStories = stories.filter((story) => {
      if (!viewerUser) return true;
      const authorUser = authorMap.get(String(story.authorUsername || ""));
      if (!authorUser) return true;
      return !usersBlockingEachOther(viewerUser, authorUser);
    });
    return res.json(visibleStories.map((story) => normalizeStory(story, viewerUsername)));
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch stories", error: err.message });
  }
});

router.post("/upload", requireAuth, upload.single("media"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ message: "media file is required" });

    const mediaType = detectMediaType(file.mimetype);
    if (!mediaType) {
      return res.status(400).json({ message: "Only image/video uploads are allowed" });
    }
    const signatureCheck = await validateStoredMediaFile(file.path, file.mimetype);
    if (!signatureCheck.ok || signatureCheck.kind !== mediaType) {
      fs.unlink(file.path, () => {});
      return res.status(400).json({ message: "Invalid or unsupported media file" });
    }

    const user = await User.findById(req.auth.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const mediaUrl = `${baseUrl}/uploads/stories/${file.filename}`;

    const story = await Story.create({
      author: user._id,
      authorUsername: user.username,
      authorDisplayName: user.displayName || user.username,
      authorAvatarUrl: user.profilePic || "",
      mediaUrl,
      mediaType
    });

    return res.status(201).json({
      message: "Story uploaded",
      story: normalizeStory(story)
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to upload story", error: err.message });
  }
});

router.delete("/:storyId", requireAuth, async (req, res) => {
  try {
    const story = await Story.findById(req.params.storyId);
    if (!story) return res.status(404).json({ message: "Story not found" });

    if (story.authorUsername !== req.auth.username) {
      return res.status(403).json({ message: "You can delete only your own story" });
    }

    const mediaUrl = String(story.mediaUrl || "");
    const marker = "/uploads/stories/";
    const idx = mediaUrl.indexOf(marker);
    if (idx >= 0) {
      const filename = mediaUrl.slice(idx + marker.length);
      const filePath = path.join(uploadsDir, filename);
      fs.unlink(filePath, () => {});
    }

    await Story.deleteOne({ _id: story._id });
    return res.json({ message: "Story deleted", storyId: req.params.storyId });
  } catch (err) {
    return res.status(500).json({ message: "Failed to delete story", error: err.message });
  }
});

router.post("/:storyId/view", requireAuth, async (req, res) => {
  try {
    const story = await Story.findById(req.params.storyId);
    if (!story) return res.status(404).json({ message: "Story not found" });
    const viewerUser = await User.findOne({ username: req.auth.username }).select("_id username blockedUsers");
    const authorUser = await User.findOne({ username: story.authorUsername }).select("_id username blockedUsers");
    if (viewerUser && authorUser && usersBlockingEachOther(viewerUser, authorUser)) {
      return res.status(403).json({ message: "Story unavailable" });
    }

    const viewerUsername = req.auth.username;
    const existing = Array.isArray(story.views)
      ? story.views.find((entry) => String(entry.username || "") === viewerUsername)
      : null;

    if (existing) {
      existing.viewedAt = new Date();
    } else {
      story.views.push({ username: viewerUsername, viewedAt: new Date() });
    }
    await story.save();
    return res.json({ message: "Story view recorded", viewsCount: story.views.length });
  } catch (err) {
    return res.status(500).json({ message: "Failed to record story view", error: err.message });
  }
});

router.post("/:storyId/react", requireAuth, async (req, res) => {
  try {
    const story = await Story.findById(req.params.storyId);
    if (!story) return res.status(404).json({ message: "Story not found" });
    const viewerUser = await User.findOne({ username: req.auth.username }).select("_id username blockedUsers");
    const authorUser = await User.findOne({ username: story.authorUsername }).select("_id username blockedUsers");
    if (viewerUser && authorUser && usersBlockingEachOther(viewerUser, authorUser)) {
      return res.status(403).json({ message: "Story unavailable" });
    }

    const actorUsername = req.auth.username;
    const emoji = normalizeReactionEmoji((req.body && req.body.emoji) || "") || REACTION_EMOJIS.HEART;
    if (!ALLOWED_REACTIONS.has(emoji)) {
      return res.status(400).json({ message: "Unsupported reaction emoji" });
    }

    const reactions = Array.isArray(story.reactions) ? story.reactions : [];
    const existing = reactions.find((entry) => String(entry.username || "") === actorUsername);
    if (existing) {
      existing.emoji = emoji;
      existing.reactedAt = new Date();
    } else {
      story.reactions.push({ username: actorUsername, emoji, reactedAt: new Date() });
    }
    await story.save();

    if (story.authorUsername && story.authorUsername !== actorUsername) {
      await createNotification({
        recipientUsername: story.authorUsername,
        actorUsername,
        type: "message",
        text: `@${actorUsername} reacted ${emoji} to your story`,
        entityType: "story",
        entityId: String(story._id),
        link: "index.html"
      });
    }

    return res.json({
      message: "Story reaction updated",
      reactionsCount: story.reactions.length,
      reactionSummary: summarizeReactions(story.reactions)
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to react to story", error: err.message });
  }
});

router.post("/:storyId/reply", requireAuth, async (req, res) => {
  try {
    const story = await Story.findById(req.params.storyId);
    if (!story) return res.status(404).json({ message: "Story not found" });
    const viewerUser = await User.findOne({ username: req.auth.username }).select("_id username blockedUsers");
    const authorUser = await User.findOne({ username: story.authorUsername }).select("_id username blockedUsers");
    if (viewerUser && authorUser && usersBlockingEachOther(viewerUser, authorUser)) {
      return res.status(403).json({ message: "Story unavailable" });
    }

    const fromUsername = req.auth.username;
    const text = String((req.body && req.body.text) || "").trim();
    if (!text) return res.status(400).json({ message: "Reply text is required" });
    const issue = findModerationIssue(text);
    if (issue) return res.status(400).json({ message: issue.message, code: issue.code });

    story.replies.push({ fromUsername, text, createdAt: new Date() });
    await story.save();

    if (story.authorUsername && story.authorUsername !== fromUsername) {
      await createNotification({
        recipientUsername: story.authorUsername,
        actorUsername: fromUsername,
        type: "message",
        text: `@${fromUsername} replied to your story`,
        entityType: "story",
        entityId: String(story._id),
        link: "chat.html"
      });
    }

    return res.status(201).json({
      message: "Story reply sent",
      reply: {
        fromUsername,
        text,
        createdAt: story.replies[story.replies.length - 1].createdAt
      },
      repliesCount: story.replies.length
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to reply to story", error: err.message });
  }
});

router.get("/:storyId/interactions", requireAuth, async (req, res) => {
  try {
    const story = await Story.findById(req.params.storyId);
    if (!story) return res.status(404).json({ message: "Story not found" });
    if (String(story.authorUsername || "") !== req.auth.username) {
      return res.status(403).json({ message: "Only story owner can view interactions" });
    }

    const views = Array.isArray(story.views) ? [...story.views] : [];
    const reactions = Array.isArray(story.reactions) ? [...story.reactions] : [];
    const replies = Array.isArray(story.replies) ? [...story.replies] : [];

    views.sort((a, b) => new Date(b.viewedAt || 0) - new Date(a.viewedAt || 0));
    reactions.sort((a, b) => new Date(b.reactedAt || 0) - new Date(a.reactedAt || 0));
    replies.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    return res.json({
      storyId: String(story._id),
      viewsCount: views.length,
      reactionsCount: reactions.length,
      repliesCount: replies.length,
      reactionSummary: summarizeReactions(reactions),
      views: views.map((entry) => ({
        username: entry.username,
        viewedAt: entry.viewedAt
      })),
      reactions: reactions.map((entry) => ({
        username: entry.username,
        emoji: normalizeReactionEmoji(entry.emoji),
        reactedAt: entry.reactedAt
      })),
      replies: replies.map((entry) => ({
        fromUsername: entry.fromUsername,
        text: entry.text,
        createdAt: entry.createdAt
      }))
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch story interactions", error: err.message });
  }
});

module.exports = router;

