const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const Post = require("../models/Post");
const User = require("../models/User");
const { requireAuth, getTokenFromRequest, verifyToken } = require("../middleware/auth");
const { makeRateLimiter } = require("../middleware/rateLimit");
const { createNotification } = require("../utils/notifications");
const { findModerationIssue } = require("../utils/moderation");
const { validateStoredMediaFile } = require("../utils/mediaValidation");

const uploadsDir = path.join(process.cwd(), "uploads", "posts");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const safeExt = path.extname(file.originalname || "").toLowerCase();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  }
});

const MAX_UPLOAD_MB = Math.min(Math.max(parseInt(process.env.UPLOAD_MAX_MB || "100", 10) || 100, 5), 500);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_UPLOAD_BYTES
  },
  fileFilter: (req, file, cb) => {
    if (!file || !file.mimetype) return cb(new Error("Invalid file"));
    if (file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/")) return cb(null, true);
    return cb(new Error("Only image/video files are allowed"));
  }
});

const commentRateLimit = makeRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: "Too many comments. Please slow down.",
  keyGenerator: (req) => String((req.auth && req.auth.username) || req.ip || "unknown")
});

const replyRateLimit = makeRateLimiter({
  windowMs: 60 * 1000,
  max: 25,
  message: "Too many replies. Please slow down.",
  keyGenerator: (req) => String((req.auth && req.auth.username) || req.ip || "unknown")
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

function normalizePost(post) {
  return {
    id: post._id,
    authorUsername: post.authorUsername,
    authorDisplayName: post.authorDisplayName || post.authorUsername,
    authorAvatarUrl: post.authorAvatarUrl || "",
    authorVerified: !!post.authorVerified,
    caption: post.caption || "",
    mediaUrl: post.mediaUrl,
    mediaType: post.mediaType,
    privacy: post.privacy || "public",
    archived: !!post.archived,
    publishAt: post.publishAt || post.createdAt || null,
    isPublished: !post.publishAt || new Date(post.publishAt).getTime() <= Date.now(),
    likesCount: Array.isArray(post.likes) ? post.likes.length : 0,
    sharesCount: Number(post.sharesCount || 0),
    savesCount: Number(post.savesCount || 0),
    likedBy: Array.isArray(post.likes) ? post.likes : [],
    comments: Array.isArray(post.comments)
      ? post.comments.map((c) => ({
          id: c._id,
          username: c.username,
          text: c.text,
          createdAt: c.createdAt,
          replies: Array.isArray(c.replies)
            ? c.replies.map((r) => ({
                id: r._id,
                username: r.username,
                text: r.text,
                createdAt: r.createdAt
              }))
            : []
        }))
      : [],
    createdAt: post.createdAt
  };
}

function isPostPublished(post, nowTs = Date.now()) {
  const ts = new Date((post && post.publishAt) || (post && post.createdAt) || 0).getTime();
  if (!ts) return true;
  return ts <= nowTs;
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

async function getFollowingSet(username) {
  if (!username) return new Set();
  const viewer = await User.findOne({ username })
    .select("following")
    .populate("following", "username");
  const list = Array.isArray(viewer && viewer.following) ? viewer.following : [];
  return new Set(list.map((u) => String(u.username || "")).filter(Boolean));
}

async function getViewerUser(username) {
  if (!username) return null;
  return User.findOne({ username }).select("_id username blockedUsers");
}

function canViewPost(post, viewerUsername, followingSet) {
  const privacy = String((post && post.privacy) || "public");
  const author = String((post && post.authorUsername) || "");
  if (viewerUsername && author && viewerUsername === author) return true;
  if (privacy === "public") return true;
  if (!viewerUsername) return false;
  if (privacy === "followers") return followingSet.has(author);
  return false;
}

function canInteractWithPost(post, viewerUsername, followingSet) {
  if (!post) return false;
  const author = String(post.authorUsername || "");
  if (viewerUsername && author && viewerUsername === author) return true;
  if (!isPostPublished(post)) return false;
  return canViewPost(post, viewerUsername, followingSet);
}

function canViewAuthorPrivacy(authorUser, authorUsername, viewerUsername, followingSet) {
  if (!authorUser) return true;
  if (viewerUsername && String(viewerUsername) === String(authorUsername || "")) return true;
  const visibility = String(
    authorUser
    && authorUser.privacySettings
    && authorUser.privacySettings.accountVisibility
      ? authorUser.privacySettings.accountVisibility
      : "public"
  ).toLowerCase();
  if (visibility !== "private") return true;
  if (!viewerUsername) return false;
  return followingSet.has(String(authorUsername || ""));
}

function normalizeCommentRule(authorUser) {
  const rule = String(
    authorUser
    && authorUser.privacySettings
    && authorUser.privacySettings.allowCommentsFrom
      ? authorUser.privacySettings.allowCommentsFrom
      : "everyone"
  ).toLowerCase();
  return ["everyone", "followers", "none"].includes(rule) ? rule : "everyone";
}

function extractMentions(text = "") {
  const matches = String(text || "").match(/@([a-zA-Z0-9_]{2,30})/g) || [];
  const usernames = new Set();
  matches.forEach((m) => {
    const uname = String(m || "").slice(1).trim();
    if (uname) usernames.add(uname);
  });
  return Array.from(usernames);
}

async function notifyMentions({ actorUsername, text, entityType, entityId, link, exclude = [] }) {
  const mentions = extractMentions(text);
  if (!mentions.length) return;
  const excluded = new Set((exclude || []).map((u) => String(u || "").toLowerCase()));
  const users = await User.find({ username: { $in: mentions } }).select("username");
  for (const user of users) {
    const uname = String(user.username || "");
    if (!uname) continue;
    if (excluded.has(uname.toLowerCase())) continue;
    await createNotification({
      recipientUsername: uname,
      actorUsername,
      type: "mention",
      text: `@${actorUsername} mentioned you`,
      entityType,
      entityId,
      link
    });
  }
}

router.get("/", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "50", 10), 100);
    const fetchLimit = Math.min(Math.max(limit * 3, limit), 300);
    const viewerUsername = await getViewerFromReq(req);
    const followingSet = await getFollowingSet(viewerUsername);
    const viewerUser = await getViewerUser(viewerUsername);

    const posts = await Post.find({})
      .sort({ createdAt: -1 })
      .limit(fetchLimit);
    const authorUsernames = Array.from(new Set(posts.map((p) => String(p.authorUsername || "")).filter(Boolean)));
    const authorDocs = await User.find({ username: { $in: authorUsernames } }).select("_id username blockedUsers privacySettings");
    const authorMap = new Map(authorDocs.map((u) => [String(u.username), u]));

    const nowTs = Date.now();
    const visible = posts.filter((post) => {
      if (post.archived) return false;
      if (!isPostPublished(post, nowTs)) return false;
      if (!canViewPost(post, viewerUsername, followingSet)) return false;
      const authorUser = authorMap.get(String(post.authorUsername || ""));
      if (!canViewAuthorPrivacy(authorUser, post.authorUsername, viewerUsername, followingSet)) return false;
      if (!viewerUser) return true;
      if (!authorUser) return true;
      return !usersBlockingEachOther(viewerUser, authorUser);
    }).slice(0, limit);

    const visiblePostIds = visible.map((post) => post._id);
    const saveCountMap = new Map();
    if (visiblePostIds.length) {
      const saveCounts = await User.aggregate([
        { $unwind: "$savedPosts" },
        { $match: { savedPosts: { $in: visiblePostIds } } },
        { $group: { _id: "$savedPosts", count: { $sum: 1 } } }
      ]);
      saveCounts.forEach((entry) => {
        saveCountMap.set(String(entry._id), Number(entry.count || 0));
      });
    }

    return res.json(visible.map((post) => {
      const normalized = normalizePost(post);
      normalized.savesCount = saveCountMap.has(String(post._id))
        ? Number(saveCountMap.get(String(post._id)))
        : Number(normalized.savesCount || 0);
      return normalized;
    }));
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch posts", error: err.message });
  }
});

router.get("/user/:username", async (req, res) => {
  try {
    const viewerUsername = await getViewerFromReq(req);
    const followingSet = await getFollowingSet(viewerUsername);
    const viewerUser = await getViewerUser(viewerUsername);
    const authorUser = await User.findOne({ username: req.params.username }).select("_id username blockedUsers privacySettings");
    const posts = await Post.find({ authorUsername: req.params.username })
      .sort({ createdAt: -1 })
      .limit(100);
    const nowTs = Date.now();
    const isOwnerView = !!viewerUsername && viewerUsername === String(req.params.username || "");
    const statusFilter = String(req.query.status || "").trim().toLowerCase();
    const visible = posts.filter((post) => {
      if (statusFilter === "archived") {
        if (!isOwnerView) return false;
        if (!post.archived) return false;
      } else if (post.archived && !isOwnerView) {
        return false;
      }
      if (statusFilter === "published" && !isPostPublished(post, nowTs)) return false;
      if (statusFilter === "scheduled" && isPostPublished(post, nowTs)) return false;
      if (!isOwnerView && !isPostPublished(post, nowTs)) return false;
      if (!canViewPost(post, viewerUsername, followingSet)) return false;
      if (!canViewAuthorPrivacy(authorUser, post.authorUsername, viewerUsername, followingSet)) return false;
      if (!viewerUser || !authorUser) return true;
      return !usersBlockingEachOther(viewerUser, authorUser);
    });

    return res.json(visible.map(normalizePost));
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch user posts", error: err.message });
  }
});

router.get("/saved", requireAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.auth.username })
      .select("_id username blockedUsers savedPosts")
      .populate("savedPosts");

    if (!user) return res.status(404).json({ message: "User not found" });

    const posts = Array.isArray(user.savedPosts) ? user.savedPosts : [];
    const followingSet = await getFollowingSet(req.auth.username);
    const authorUsernames = Array.from(new Set(posts.map((p) => String(p.authorUsername || "")).filter(Boolean)));
    const authorDocs = await User.find({ username: { $in: authorUsernames } }).select("_id username blockedUsers");
    const authorMap = new Map(authorDocs.map((u) => [String(u.username), u]));
    posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const nowTs = Date.now();
    const visible = posts.filter((post) => {
      const isOwnPost = String(post.authorUsername || "") === String(req.auth.username || "");
      if (post.archived && !isOwnPost) return false;
      if (!isOwnPost && !isPostPublished(post, nowTs)) return false;
      if (!canViewPost(post, req.auth.username, followingSet)) return false;
      const authorUser = authorMap.get(String(post.authorUsername || ""));
      if (!authorUser) return true;
      return !usersBlockingEachOther(user, authorUser);
    });

    return res.json(visible.map(normalizePost));
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch saved posts", error: err.message });
  }
});

router.get("/insights/me", requireAuth, async (req, res) => {
  try {
    const posts = await Post.find({ authorUsername: req.auth.username }).sort({ createdAt: -1 }).limit(300);
    const totals = posts.reduce((acc, post) => {
      acc.posts += 1;
      acc.likes += Array.isArray(post.likes) ? post.likes.length : 0;
      acc.comments += Array.isArray(post.comments) ? post.comments.length : 0;
      acc.shares += Number(post.sharesCount || 0);
      acc.saves += Number(post.savesCount || 0);
      acc.archived += post.archived ? 1 : 0;
      if (!isPostPublished(post)) acc.scheduled += 1;
      return acc;
    }, { posts: 0, likes: 0, comments: 0, shares: 0, saves: 0, archived: 0, scheduled: 0 });

    return res.json({
      totals,
      items: posts.map((post) => ({
        id: String(post._id),
        caption: String(post.caption || ""),
        createdAt: post.createdAt || null,
        archived: !!post.archived,
        isPublished: isPostPublished(post),
        likesCount: Array.isArray(post.likes) ? post.likes.length : 0,
        commentsCount: Array.isArray(post.comments) ? post.comments.length : 0,
        sharesCount: Number(post.sharesCount || 0),
        savesCount: Number(post.savesCount || 0)
      }))
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to load insights", error: err.message });
  }
});

router.post("/manage/bulk", requireAuth, async (req, res) => {
  try {
    const action = String((req.body && req.body.action) || "").trim().toLowerCase();
    const ids = Array.isArray(req.body && req.body.postIds) ? req.body.postIds.map((id) => String(id || "")).filter(Boolean) : [];
    if (!["archive", "unarchive", "delete"].includes(action)) {
      return res.status(400).json({ message: "Invalid action" });
    }
    if (!ids.length) return res.status(400).json({ message: "postIds are required" });

    const ownedPosts = await Post.find({
      _id: { $in: ids },
      authorUsername: req.auth.username
    }).select("_id");
    const ownedIds = ownedPosts.map((p) => p._id);
    if (!ownedIds.length) return res.status(404).json({ message: "No matching posts found" });

    if (action === "delete") {
      await Post.deleteMany({ _id: { $in: ownedIds } });
      await User.updateMany({}, { $pull: { savedPosts: { $in: ownedIds } } });
      return res.json({ message: "Posts deleted", affected: ownedIds.length });
    }

    await Post.updateMany(
      { _id: { $in: ownedIds } },
      { $set: { archived: action === "archive" } }
    );
    return res.json({
      message: action === "archive" ? "Posts archived" : "Posts unarchived",
      affected: ownedIds.length
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to manage posts", error: err.message });
  }
});

router.post("/upload", requireAuth, upload.single("media"), async (req, res) => {
  try {
    const { caption = "", privacy = "public", publishAt = "" } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: "media file is required" });
    }

    const mediaType = detectMediaType(file.mimetype);
    if (!mediaType) {
      return res.status(400).json({ message: "Only image/video uploads are allowed" });
    }
    const signatureCheck = await validateStoredMediaFile(file.path, file.mimetype);
    if (!signatureCheck.ok || signatureCheck.kind !== mediaType) {
      fs.unlink(file.path, () => {});
      return res.status(400).json({ message: "Invalid or unsupported media file" });
    }
    const captionText = String(caption || "").trim();
    const captionIssue = findModerationIssue(captionText);
    if (captionIssue) {
      return res.status(400).json({ message: captionIssue.message, code: captionIssue.code });
    }

    const user = await User.findById(req.auth.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const mediaUrl = `${baseUrl}/uploads/posts/${file.filename}`;
    const normalizedPrivacy = ["public", "followers", "private"].includes(String(privacy))
      ? String(privacy)
      : "public";
    const parsedPublishAt = new Date(String(publishAt || "").trim());
    const normalizedPublishAt = Number.isNaN(parsedPublishAt.getTime()) ? new Date() : parsedPublishAt;

    const newPost = await Post.create({
      author: user._id,
      authorUsername: user.username,
      authorDisplayName: user.displayName || user.username,
      authorAvatarUrl: user.profilePic || "",
      authorVerified: !!user.isVerified,
      caption: captionText,
      mediaUrl,
      mediaType,
      privacy: normalizedPrivacy,
      publishAt: normalizedPublishAt
    });

    return res.status(201).json({
      message: "Post uploaded",
      post: normalizePost(newPost)
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to upload post", error: err.message });
  }
});

router.post("/:postId/like", requireAuth, async (req, res) => {
  try {
    const username = req.auth.username;
    const viewerUser = await User.findOne({ username }).select("_id username blockedUsers");
    if (!viewerUser) return res.status(404).json({ message: "User not found" });

    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ message: "Post not found" });
    const authorUser = await User.findOne({ username: post.authorUsername }).select("_id username blockedUsers");
    if (authorUser && usersBlockingEachOther(viewerUser, authorUser)) {
      return res.status(403).json({ message: "You cannot like this post" });
    }
    const followingSet = await getFollowingSet(username);
    if (!canInteractWithPost(post, username, followingSet)) {
      return res.status(403).json({ message: "You cannot like this post" });
    }

    const likeSet = new Set(post.likes || []);
    let liked = false;

    if (likeSet.has(username)) {
      likeSet.delete(username);
      liked = false;
    } else {
      likeSet.add(username);
      liked = true;
    }

    post.likes = Array.from(likeSet);
    await post.save();

    if (liked && post.authorUsername && post.authorUsername !== username) {
      await createNotification({
        recipientUsername: post.authorUsername,
        actorUsername: username,
        type: "like",
        text: `@${username} liked your post`,
        entityType: "post",
        entityId: String(post._id),
        link: `posts.html#post-${encodeURIComponent(String(post._id))}`
      });
    }

    return res.json({
      message: liked ? "Post liked" : "Post unliked",
      liked,
      likesCount: post.likes.length
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to update like", error: err.message });
  }
});

router.post("/:postId/save", requireAuth, async (req, res) => {
  try {
    const username = req.auth.username;

    const user = await User.findOne({ username }).select("_id username blockedUsers savedPosts");
    if (!user) return res.status(404).json({ message: "User not found" });

    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ message: "Post not found" });
    const authorUser = await User.findOne({ username: post.authorUsername }).select("_id username blockedUsers");
    if (authorUser && usersBlockingEachOther(user, authorUser)) {
      return res.status(403).json({ message: "You cannot save this post" });
    }
    const followingSet = await getFollowingSet(username);
    if (!canInteractWithPost(post, username, followingSet)) {
      return res.status(403).json({ message: "You cannot save this post" });
    }

    const postId = post._id.toString();
    const current = Array.isArray(user.savedPosts) ? user.savedPosts.map((id) => id.toString()) : [];
    const alreadySaved = current.includes(postId);

    if (alreadySaved) {
      user.savedPosts = user.savedPosts.filter((id) => id.toString() !== postId);
      post.savesCount = Math.max(0, Number(post.savesCount || 0) - 1);
    } else {
      user.savedPosts.push(post._id);
      post.savesCount = Math.max(0, Number(post.savesCount || 0) + 1);
    }

    await user.save();
    await post.save();

    return res.json({
      message: alreadySaved ? "Post unsaved" : "Post saved",
      saved: !alreadySaved,
      savesCount: Number(post.savesCount || 0)
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to update saved post", error: err.message });
  }
});

router.post("/:postId/share", requireAuth, async (req, res) => {
  try {
    const username = req.auth.username;
    const viewerUser = await User.findOne({ username }).select("_id username blockedUsers");
    if (!viewerUser) return res.status(404).json({ message: "User not found" });

    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ message: "Post not found" });

    const authorUser = await User.findOne({ username: post.authorUsername }).select("_id username blockedUsers");
    if (authorUser && usersBlockingEachOther(viewerUser, authorUser)) {
      return res.status(403).json({ message: "You cannot share this post" });
    }

    const followingSet = await getFollowingSet(username);
    if (!canInteractWithPost(post, username, followingSet)) {
      return res.status(403).json({ message: "You cannot share this post" });
    }

    post.sharesCount = Math.max(0, Number(post.sharesCount || 0) + 1);
    await post.save();

    return res.json({
      message: "Post shared",
      sharesCount: Number(post.sharesCount || 0)
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to share post", error: err.message });
  }
});

router.post("/:postId/comment", requireAuth, commentRateLimit, async (req, res) => {
  try {
    const username = req.auth.username;
    const viewerUser = await User.findOne({ username }).select("_id username blockedUsers");
    if (!viewerUser) return res.status(404).json({ message: "User not found" });
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ message: "comment text is required" });
    }
    const cleanText = String(text || "").trim();
    const issue = findModerationIssue(cleanText);
    if (issue) return res.status(400).json({ message: issue.message, code: issue.code });

    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ message: "Post not found" });
    const authorUser = await User.findOne({ username: post.authorUsername }).select("_id username blockedUsers");
    if (authorUser && usersBlockingEachOther(viewerUser, authorUser)) {
      return res.status(403).json({ message: "You cannot comment on this post" });
    }
    const followingSet = await getFollowingSet(username);
    if (!canInteractWithPost(post, username, followingSet)) {
      return res.status(403).json({ message: "You cannot comment on this post" });
    }
    const authorWithPrivacy = await User.findOne({ username: post.authorUsername }).select("username privacySettings");
    const commentRule = normalizeCommentRule(authorWithPrivacy);
    if (String(post.authorUsername || "") !== username) {
      if (commentRule === "none") return res.status(403).json({ message: "Comments are disabled for this user" });
      if (commentRule === "followers" && !followingSet.has(String(post.authorUsername || ""))) {
        return res.status(403).json({ message: "Only followers can comment on this user's posts" });
      }
    }

    post.comments.push({
      username,
      text: cleanText
    });
    await post.save();

    const lastComment = post.comments[post.comments.length - 1];

    if (post.authorUsername && post.authorUsername !== username) {
      await createNotification({
        recipientUsername: post.authorUsername,
        actorUsername: username,
        type: "comment",
        text: `@${username} commented on your post`,
        entityType: "post",
        entityId: String(post._id),
        link: `posts.html#post-${encodeURIComponent(String(post._id))}`
      });
    }
    await notifyMentions({
      actorUsername: username,
      text: cleanText,
      entityType: "post_comment",
      entityId: String(lastComment._id),
      link: `posts.html#post-${encodeURIComponent(String(post._id))}`,
      exclude: [username, String(post.authorUsername || "")]
    });

    return res.status(201).json({
      message: "Comment added",
      comment: {
        id: lastComment._id,
        username: lastComment.username,
        text: lastComment.text,
        createdAt: lastComment.createdAt
      },
      commentsCount: post.comments.length
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to add comment", error: err.message });
  }
});

router.post("/:postId/comment/:commentId/reply", requireAuth, replyRateLimit, async (req, res) => {
  try {
    const username = req.auth.username;
    const viewerUser = await User.findOne({ username }).select("_id username blockedUsers");
    if (!viewerUser) return res.status(404).json({ message: "User not found" });
    const text = String((req.body && req.body.text) || "").trim();
    if (!text) return res.status(400).json({ message: "reply text is required" });
    const issue = findModerationIssue(text);
    if (issue) return res.status(400).json({ message: issue.message, code: issue.code });

    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ message: "Post not found" });
    const authorUser = await User.findOne({ username: post.authorUsername }).select("_id username blockedUsers");
    if (authorUser && usersBlockingEachOther(viewerUser, authorUser)) {
      return res.status(403).json({ message: "You cannot reply on this post" });
    }
    const followingSet = await getFollowingSet(username);
    if (!canInteractWithPost(post, username, followingSet)) {
      return res.status(403).json({ message: "You cannot reply on this post" });
    }
    const authorWithPrivacy = await User.findOne({ username: post.authorUsername }).select("username privacySettings");
    const commentRule = normalizeCommentRule(authorWithPrivacy);
    if (String(post.authorUsername || "") !== username) {
      if (commentRule === "none") return res.status(403).json({ message: "Comments are disabled for this user" });
      if (commentRule === "followers" && !followingSet.has(String(post.authorUsername || ""))) {
        return res.status(403).json({ message: "Only followers can comment on this user's posts" });
      }
    }

    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ message: "Comment not found" });
    comment.replies = Array.isArray(comment.replies) ? comment.replies : [];
    comment.replies.push({ username, text });
    await post.save();
    const reply = comment.replies[comment.replies.length - 1];
    const commentAuthor = String(comment.username || "");
    if (commentAuthor && commentAuthor !== username) {
      await createNotification({
        recipientUsername: commentAuthor,
        actorUsername: username,
        type: "reply",
        text: `@${username} replied to your comment`,
        entityType: "post",
        entityId: String(post._id),
        link: `posts.html#post-${encodeURIComponent(String(post._id))}`
      });
    }
    await notifyMentions({
      actorUsername: username,
      text,
      entityType: "post_reply",
      entityId: String(reply._id),
      link: `posts.html#post-${encodeURIComponent(String(post._id))}`,
      exclude: [username, commentAuthor]
    });

    return res.status(201).json({
      message: "Reply added",
      reply: {
        id: reply._id,
        username: reply.username,
        text: reply.text,
        createdAt: reply.createdAt
      },
      postId: req.params.postId,
      commentId: req.params.commentId
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to add reply", error: err.message });
  }
});

router.patch("/:postId", requireAuth, async (req, res) => {
  try {
    const username = req.auth.username;
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ message: "Post not found" });
    if (String(post.authorUsername || "") !== username) {
      return res.status(403).json({ message: "You can edit only your own posts" });
    }

    const hasCaption = Object.prototype.hasOwnProperty.call(req.body || {}, "caption");
    const hasPrivacy = Object.prototype.hasOwnProperty.call(req.body || {}, "privacy");
    const hasPublishAt = Object.prototype.hasOwnProperty.call(req.body || {}, "publishAt");
    if (!hasCaption && !hasPrivacy && !hasPublishAt) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    if (hasCaption) {
      const nextCaption = String((req.body && req.body.caption) || "").trim();
      const issue = findModerationIssue(nextCaption);
      if (issue) return res.status(400).json({ message: issue.message, code: issue.code });
      post.caption = nextCaption;
    }
    if (hasPrivacy) {
      const candidate = String((req.body && req.body.privacy) || "").trim();
      post.privacy = ["public", "followers", "private"].includes(candidate) ? candidate : post.privacy;
    }
    if (hasPublishAt) {
      const rawPublishAt = String((req.body && req.body.publishAt) || "").trim();
      const parsed = new Date(rawPublishAt);
      if (!Number.isNaN(parsed.getTime())) {
        post.publishAt = parsed;
      }
    }

    await post.save();
    return res.json({ message: "Post updated", post: normalizePost(post) });
  } catch (err) {
    return res.status(500).json({ message: "Failed to edit post", error: err.message });
  }
});

router.delete("/:postId", requireAuth, async (req, res) => {
  try {
    const username = req.auth.username;

    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ message: "Post not found" });

    if (post.authorUsername !== username) {
      return res.status(403).json({ message: "You can delete only your own posts" });
    }

    await Post.deleteOne({ _id: post._id });
    await User.updateMany({}, { $pull: { savedPosts: post._id } });
    return res.json({ message: "Post deleted", postId: req.params.postId });
  } catch (err) {
    return res.status(500).json({ message: "Failed to delete post", error: err.message });
  }
});

router.delete("/:postId/comment/:commentId", requireAuth, async (req, res) => {
  try {
    const username = req.auth.username;

    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ message: "Post not found" });

    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ message: "Comment not found" });

    const canDelete = username === comment.username || username === post.authorUsername;
    if (!canDelete) {
      return res.status(403).json({ message: "You can delete only your own comment" });
    }

    post.comments = post.comments.filter((c) => c._id.toString() !== req.params.commentId);
    await post.save();

    return res.json({
      message: "Comment deleted",
      postId: req.params.postId,
      commentId: req.params.commentId,
      commentsCount: post.comments.length
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to delete comment", error: err.message });
  }
});

router.delete("/:postId/comment/:commentId/reply/:replyId", requireAuth, async (req, res) => {
  try {
    const username = req.auth.username;
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ message: "Post not found" });

    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ message: "Comment not found" });
    const reply = Array.isArray(comment.replies)
      ? comment.replies.find((r) => String(r._id) === String(req.params.replyId))
      : null;
    if (!reply) return res.status(404).json({ message: "Reply not found" });

    const canDelete = username === reply.username || username === comment.username || username === post.authorUsername;
    if (!canDelete) {
      return res.status(403).json({ message: "You can delete only your own reply" });
    }

    comment.replies = (comment.replies || []).filter((r) => String(r._id) !== String(req.params.replyId));
    await post.save();

    return res.json({
      message: "Reply deleted",
      postId: req.params.postId,
      commentId: req.params.commentId,
      replyId: req.params.replyId
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to delete reply", error: err.message });
  }
});

module.exports = router;
