const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Post = require("../models/Post");
const Story = require("../models/Story");
const Message = require("../models/Message");
const Notification = require("../models/Notification");
const Report = require("../models/Report");
const CallLog = require("../models/CallLog");
const SecurityEvent = require("../models/SecurityEvent");
const { requireAuth, getTokenFromRequest, verifyToken } = require("../middleware/auth");
const { createNotification } = require("../utils/notifications");

function cleanUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return "";
}

function cleanThemeColor(value = "") {
  const raw = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  return "#31c0ff";
}

function getBlockedIdSet(userDoc) {
  const ids = Array.isArray(userDoc && userDoc.blockedUsers) ? userDoc.blockedUsers : [];
  return new Set(ids.map((id) => String(id)));
}

function blocksUser(userDoc, otherId) {
  if (!userDoc || !otherId) return false;
  return getBlockedIdSet(userDoc).has(String(otherId));
}

function blockedUsernames(userDoc) {
  const list = Array.isArray(userDoc && userDoc.blockedUsers) ? userDoc.blockedUsers : [];
  return list
    .map((u) => {
      if (!u) return "";
      if (typeof u === "string") return u;
      return String(u.username || "");
    })
    .filter(Boolean);
}

function parseDeviceLabel(userAgent = "") {
  const ua = String(userAgent || "").toLowerCase();
  const isMobile = /mobile|android|iphone|ipad/.test(ua);
  if (ua.includes("edg/")) return isMobile ? "Edge Mobile" : "Edge Browser";
  if (ua.includes("chrome/") && !ua.includes("edg/")) return isMobile ? "Chrome Mobile" : "Chrome Browser";
  if (ua.includes("safari/") && !ua.includes("chrome/")) return isMobile ? "Safari Mobile" : "Safari Browser";
  if (ua.includes("firefox/")) return isMobile ? "Firefox Mobile" : "Firefox Browser";
  return isMobile ? "Mobile Device" : "Desktop Device";
}

function normalizeProfile(userDoc, options = {}) {
  const hideRelations = !!options.hideRelations;
  const privateLocked = !!options.privateLocked;
  const followers = (userDoc.followers || []).map((u) => ({
    username: u.username,
    name: u.displayName || u.username,
    avatarUrl: u.profilePic || "",
    isVerified: !!u.isVerified
  }));

  const following = (userDoc.following || []).map((u) => ({
    username: u.username,
    name: u.displayName || u.username,
    avatarUrl: u.profilePic || "",
    isVerified: !!u.isVerified
  }));

  return {
    username: userDoc.username,
    name: userDoc.displayName || userDoc.username,
    bio: userDoc.bio || "",
    avatarUrl: userDoc.profilePic || "",
    isVerified: !!userDoc.isVerified,
    coverImageUrl: userDoc.coverImageUrl || "",
    websiteUrl: userDoc.websiteUrl || "",
    socialLinks: {
      instagram: (userDoc.socialLinks && userDoc.socialLinks.instagram) || "",
      linkedin: (userDoc.socialLinks && userDoc.socialLinks.linkedin) || "",
      github: (userDoc.socialLinks && userDoc.socialLinks.github) || "",
      x: (userDoc.socialLinks && userDoc.socialLinks.x) || ""
    },
    themeColor: cleanThemeColor(userDoc.themeColor || ""),
    showOnlineStatus: userDoc.showOnlineStatus !== false,
    pinnedPostId: userDoc.pinnedPost ? String(userDoc.pinnedPost) : "",
    followers: hideRelations ? [] : followers,
    following: hideRelations ? [] : following,
    followersCount: hideRelations ? 0 : followers.length,
    followingCount: hideRelations ? 0 : following.length,
    privateLocked
  };
}

function getViewerUsernameFromReq(req) {
  try {
    const token = getTokenFromRequest(req);
    if (!token) return "";
    const decoded = verifyToken(token);
    return String(decoded.username || "");
  } catch (err) {
    return "";
  }
}

function normalizeSettings(userDoc) {
  const notificationPrefs = userDoc.notificationPrefs || {};
  const privacySettings = userDoc.privacySettings || {};
  return {
    notificationPrefs: {
      like: notificationPrefs.like !== false,
      comment: notificationPrefs.comment !== false,
      reply: notificationPrefs.reply !== false,
      mention: notificationPrefs.mention !== false,
      follow: notificationPrefs.follow !== false,
      follow_request: notificationPrefs.follow_request !== false,
      message: notificationPrefs.message !== false,
      call_missed: notificationPrefs.call_missed !== false,
      collection_save: notificationPrefs.collection_save !== false
    },
    notificationQuietHours: {
      enabled: !!(userDoc.notificationQuietHours && userDoc.notificationQuietHours.enabled),
      startHour: Number((userDoc.notificationQuietHours && userDoc.notificationQuietHours.startHour) || 22),
      endHour: Number((userDoc.notificationQuietHours && userDoc.notificationQuietHours.endHour) || 7),
      timezone: String((userDoc.notificationQuietHours && userDoc.notificationQuietHours.timezone) || "UTC")
    },
    privacySettings: {
      accountVisibility: ["public", "private"].includes(String(privacySettings.accountVisibility || "")) ? String(privacySettings.accountVisibility) : "public",
      allowMessagesFrom: ["everyone", "followers", "none"].includes(String(privacySettings.allowMessagesFrom || "")) ? String(privacySettings.allowMessagesFrom) : "everyone",
      allowCallsFrom: ["everyone", "followers", "none"].includes(String(privacySettings.allowCallsFrom || "")) ? String(privacySettings.allowCallsFrom) : "everyone",
      allowCommentsFrom: ["everyone", "followers", "none"].includes(String(privacySettings.allowCommentsFrom || "")) ? String(privacySettings.allowCommentsFrom) : "everyone"
    },
    mutedUsers: Array.isArray(userDoc.mutedUsers) ? userDoc.mutedUsers.map((u) => String(u || "")).filter(Boolean) : [],
    onboardingState: {
      completed: !!(userDoc.onboardingState && userDoc.onboardingState.completed),
      dismissedAt: (userDoc.onboardingState && userDoc.onboardingState.dismissedAt) || null
    },
    pinnedChats: (userDoc.pinnedChats && typeof userDoc.pinnedChats === "object") ? userDoc.pinnedChats : {}
  };
}

// GET PROFILE
router.get("/profile/:username", async (req, res) => {
  try {
    const viewerUsername = getViewerUsernameFromReq(req);
    const user = await User.findOne({ username: req.params.username })
      .populate("followers", "username displayName profilePic isVerified")
      .populate("following", "username displayName profilePic isVerified");

    if (!user) return res.status(404).json({ message: "User not found" });
    const isOwner = viewerUsername && String(viewerUsername) === String(user.username || "");
    const visibility = String((user.privacySettings && user.privacySettings.accountVisibility) || "public").toLowerCase();
    if (isOwner || visibility !== "private") return res.json(normalizeProfile(user));

    const viewer = viewerUsername ? await User.findOne({ username: viewerUsername }).select("following") : null;
    const follows = !!(viewer && Array.isArray(viewer.following) && viewer.following.some((id) => String(id) === String(user._id)));
    if (follows) return res.json(normalizeProfile(user));

    return res.json(normalizeProfile(user, { hideRelations: true, privateLocked: true }));
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to fetch profile" });
  }
});

// UPDATE PROFILE
router.put("/profile/:username", requireAuth, async (req, res) => {
  try {
    if (req.auth.username !== req.params.username) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const {
      name,
      bio,
      avatarUrl,
      coverImageUrl,
      websiteUrl,
      socialLinks,
      themeColor,
      showOnlineStatus,
      pinnedPostId
    } = req.body;
    const user = await User.findOne({ username: req.params.username });

    if (!user) return res.status(404).json({ message: "User not found" });

    user.displayName = (typeof name === "string" && name.trim()) ? name.trim() : user.username;
    user.bio = (typeof bio === "string") ? bio.trim() : "";
    user.profilePic = (typeof avatarUrl === "string") ? cleanUrl(avatarUrl) : "";
    user.coverImageUrl = (typeof coverImageUrl === "string") ? cleanUrl(coverImageUrl) : "";
    user.websiteUrl = (typeof websiteUrl === "string") ? cleanUrl(websiteUrl) : "";
    user.themeColor = cleanThemeColor(themeColor);
    user.showOnlineStatus = showOnlineStatus === undefined ? user.showOnlineStatus : !!showOnlineStatus;
    user.socialLinks = {
      instagram: cleanUrl(socialLinks && socialLinks.instagram),
      linkedin: cleanUrl(socialLinks && socialLinks.linkedin),
      github: cleanUrl(socialLinks && socialLinks.github),
      x: cleanUrl(socialLinks && socialLinks.x)
    };

    const pinnedIdRaw = String(pinnedPostId || "").trim();
    if (!pinnedIdRaw) {
      user.pinnedPost = null;
    } else {
      const pinned = await Post.findById(pinnedIdRaw).select("_id authorUsername");
      if (!pinned) return res.status(400).json({ message: "Pinned post not found" });
      if (String(pinned.authorUsername || "") !== String(user.username || "")) {
        return res.status(400).json({ message: "Pinned post must belong to your account" });
      }
      user.pinnedPost = pinned._id;
    }

    await user.save();

    const refreshed = await User.findOne({ username: user.username })
      .populate("followers", "username displayName profilePic isVerified")
      .populate("following", "username displayName profilePic isVerified");

    return res.json({ message: "Profile updated", profile: normalizeProfile(refreshed) });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to update profile" });
  }
});

// DISCOVER USERS
router.get("/discover/:username", async (req, res) => {
  try {
    const actor = await User.findOne({ username: req.params.username }).select("_id blockedUsers following");
    if (!actor) return res.status(404).json({ message: "User not found" });
    const actorId = String(actor._id);
    const actorBlocked = getBlockedIdSet(actor);
    const followingSet = new Set((actor.following || []).map((id) => String(id)));

    const users = await User.find({ username: { $ne: req.params.username } })
      .select("username displayName profilePic blockedUsers isVerified privacySettings")
      .sort({ username: 1 })
      .limit(300);

    const list = users
      .filter((u) => {
        const uid = String(u._id);
        if (actorBlocked.has(uid)) return false;
        const visibility = String((u.privacySettings && u.privacySettings.accountVisibility) || "public").toLowerCase();
        if (visibility === "private" && !followingSet.has(uid)) return false;
        return !blocksUser(u, actorId);
      })
      .map((u) => ({
        username: u.username,
        name: u.displayName || u.username,
        avatarUrl: u.profilePic || "",
        isVerified: !!u.isVerified
      }));

    return res.json(list);
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to fetch users" });
  }
});

// FOLLOW USER
router.post("/follow", requireAuth, async (req, res) => {
  try {
    const actor = req.auth.username;
    const { targetUsername } = req.body;
    if (!targetUsername) {
      return res.status(400).json({ message: "targetUsername is required" });
    }
    if (actor === targetUsername) {
      return res.status(400).json({ message: "You cannot follow yourself" });
    }

    const user = await User.findOne({ username: actor });
    const target = await User.findOne({ username: targetUsername });
    if (!user || !target) {
      return res.status(404).json({ message: "User not found" });
    }
    if (blocksUser(user, target._id)) {
      return res.status(400).json({ message: "Unblock this user before following" });
    }
    if (blocksUser(target, user._id)) {
      return res.status(403).json({ message: "You cannot follow this user" });
    }
    const alreadyFollowing = Array.isArray(user.following)
      && user.following.some((id) => String(id) === String(target._id));
    const visibility = String((target.privacySettings && target.privacySettings.accountVisibility) || "public").toLowerCase();
    const isPrivate = visibility === "private";

    if (isPrivate && !alreadyFollowing) {
      const alreadyRequested = Array.isArray(target.followRequests)
        && target.followRequests.some((id) => String(id) === String(user._id));
      if (!alreadyRequested) {
        await User.updateOne({ _id: target._id }, { $addToSet: { followRequests: user._id } });
        await createNotification({
          recipientUsername: target.username,
          actorUsername: actor,
          type: "follow_request",
          text: `@${actor} requested to follow you`,
          entityType: "user",
          entityId: String(user._id),
          link: "settings.html"
        });
      }
      return res.json({ message: alreadyRequested ? "Follow request already sent" : "Follow request sent", requested: true, followed: false });
    }

    await User.updateOne({ _id: user._id }, { $addToSet: { following: target._id }, $pull: { followRequests: target._id } });
    await User.updateOne({ _id: target._id }, { $addToSet: { followers: user._id }, $pull: { followRequests: user._id } });

    if (!alreadyFollowing) {
      await createNotification({
        recipientUsername: target.username,
        actorUsername: actor,
        type: "follow",
        text: `@${actor} started following you`,
        entityType: "user",
        entityId: String(target._id),
        link: `user-profile.html?u=${encodeURIComponent(actor)}`
      });
    }

    const refreshed = await User.findOne({ username: actor })
      .populate("followers", "username displayName profilePic isVerified")
      .populate("following", "username displayName profilePic isVerified");

    return res.json({ message: "Followed", profile: normalizeProfile(refreshed), requested: false, followed: true });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to follow user" });
  }
});

// UNFOLLOW USER
router.post("/unfollow", requireAuth, async (req, res) => {
  try {
    const actor = req.auth.username;
    const { targetUsername } = req.body;
    if (!targetUsername) {
      return res.status(400).json({ message: "targetUsername is required" });
    }
    if (actor === targetUsername) {
      return res.status(400).json({ message: "You cannot unfollow yourself" });
    }

    const user = await User.findOne({ username: actor });
    const target = await User.findOne({ username: targetUsername });
    if (!user || !target) {
      return res.status(404).json({ message: "User not found" });
    }

    await User.updateOne({ _id: user._id }, { $pull: { following: target._id } });
    await User.updateOne({ _id: target._id }, { $pull: { followers: user._id, followRequests: user._id } });

    const refreshed = await User.findOne({ username: actor })
      .populate("followers", "username displayName profilePic isVerified")
      .populate("following", "username displayName profilePic isVerified");

    return res.json({ message: "Unfollowed", profile: normalizeProfile(refreshed) });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to unfollow user" });
  }
});

router.get("/blocks", requireAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.auth.username })
      .populate("blockedUsers", "username displayName profilePic isVerified");
    if (!user) return res.status(404).json({ message: "User not found" });
    const items = (user.blockedUsers || []).map((u) => ({
      username: u.username,
      name: u.displayName || u.username,
      avatarUrl: u.profilePic || "",
      isVerified: !!u.isVerified
    }));
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to fetch blocked users" });
  }
});

router.post("/block", requireAuth, async (req, res) => {
  try {
    const actor = req.auth.username;
    const { targetUsername } = req.body;
    if (!targetUsername) return res.status(400).json({ message: "targetUsername is required" });
    if (actor === targetUsername) return res.status(400).json({ message: "You cannot block yourself" });

    const user = await User.findOne({ username: actor });
    const target = await User.findOne({ username: targetUsername });
    if (!user || !target) return res.status(404).json({ message: "User not found" });

    await User.updateOne(
      { _id: user._id },
      {
        $addToSet: { blockedUsers: target._id },
        $pull: { followers: target._id, following: target._id, followRequests: target._id }
      }
    );
    await User.updateOne(
      { _id: target._id },
      { $pull: { followers: user._id, following: user._id, followRequests: user._id } }
    );

    const refreshed = await User.findOne({ _id: user._id })
      .populate("followers", "username displayName profilePic isVerified")
      .populate("following", "username displayName profilePic isVerified")
      .populate("blockedUsers", "username displayName profilePic isVerified");

    return res.json({
      message: "User blocked",
      profile: normalizeProfile(refreshed),
      blocks: blockedUsernames(refreshed)
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to block user" });
  }
});

router.post("/unblock", requireAuth, async (req, res) => {
  try {
    const actor = req.auth.username;
    const { targetUsername } = req.body;
    if (!targetUsername) return res.status(400).json({ message: "targetUsername is required" });
    if (actor === targetUsername) return res.status(400).json({ message: "You cannot unblock yourself" });

    const user = await User.findOne({ username: actor });
    const target = await User.findOne({ username: targetUsername });
    if (!user || !target) return res.status(404).json({ message: "User not found" });

    await User.updateOne({ _id: user._id }, { $pull: { blockedUsers: target._id } });

    const refreshed = await User.findOne({ _id: user._id })
      .populate("followers", "username displayName profilePic isVerified")
      .populate("following", "username displayName profilePic isVerified")
      .populate("blockedUsers", "username displayName profilePic isVerified");

    return res.json({
      message: "User unblocked",
      profile: normalizeProfile(refreshed),
      blocks: blockedUsernames(refreshed)
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to unblock user" });
  }
});

router.get("/sessions", requireAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.auth.username }).select("sessions");
    if (!user) return res.status(404).json({ message: "User not found" });

    const sessions = Array.isArray(user.sessions) ? user.sessions : [];
    const items = sessions
      .map((entry) => ({
        id: String(entry.sid || ""),
        label: String(entry.label || ""),
        userAgent: String(entry.userAgent || ""),
        ip: String(entry.ip || ""),
        device: parseDeviceLabel(entry.userAgent || ""),
        createdAt: entry.createdAt || null,
        lastSeenAt: entry.lastSeenAt || entry.createdAt || null,
        isCurrent: String(entry.sid || "") === String(req.auth.sid || "")
      }))
      .filter((entry) => entry.id)
      .sort((a, b) => {
        const at = new Date(a.lastSeenAt || 0).getTime();
        const bt = new Date(b.lastSeenAt || 0).getTime();
        return bt - at;
      });

    return res.json({
      currentSessionId: String(req.auth.sid || ""),
      items
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to fetch sessions" });
  }
});

router.delete("/sessions/:sessionId", requireAuth, async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || "").trim();
    if (!sessionId) return res.status(400).json({ message: "sessionId is required" });

    const user = await User.findOne({ username: req.auth.username }).select("sessions");
    if (!user) return res.status(404).json({ message: "User not found" });

    const exists = (user.sessions || []).some((entry) => String(entry.sid || "") === sessionId);
    if (!exists) return res.status(404).json({ message: "Session not found" });

    await User.updateOne(
      { _id: user._id },
      { $pull: { sessions: { sid: sessionId } } }
    );

    return res.json({
      message: sessionId === String(req.auth.sid || "") ? "Current session revoked" : "Session revoked",
      revokedCurrent: sessionId === String(req.auth.sid || "")
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to revoke session" });
  }
});

router.patch("/sessions/:sessionId/label", requireAuth, async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || "").trim();
    const label = String((req.body && req.body.label) || "").trim().slice(0, 64);
    if (!sessionId) return res.status(400).json({ message: "sessionId is required" });
    if (!label) return res.status(400).json({ message: "label is required" });

    const updated = await User.updateOne(
      { username: req.auth.username, "sessions.sid": sessionId },
      { $set: { "sessions.$.label": label } }
    );
    if (!updated || Number(updated.matchedCount || 0) < 1) {
      return res.status(404).json({ message: "Session not found" });
    }
    return res.json({ message: "Session label updated", sessionId, label });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to update session label" });
  }
});

router.delete("/sessions", requireAuth, async (req, res) => {
  try {
    const currentSid = String(req.auth.sid || "");
    const user = await User.findOne({ username: req.auth.username }).select("sessions");
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!currentSid) {
      user.sessions = [];
    } else {
      user.sessions = (user.sessions || []).filter((entry) => String(entry.sid || "") === currentSid);
    }
    await user.save();

    return res.json({ message: "Other sessions revoked" });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to revoke sessions" });
  }
});

router.post("/change-password", requireAuth, async (req, res) => {
  try {
    const username = req.auth.username;
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "currentPassword and newPassword are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ message: "New password must be different from current password" });
    }

    const user = await User.findOne({ username }).select("password sessions");
    if (!user) return res.status(404).json({ message: "User not found" });

    const matches = await bcrypt.compare(currentPassword, String(user.password || ""));
    if (!matches) return res.status(400).json({ message: "Current password is incorrect" });

    user.password = newPassword;
    const currentSid = String(req.auth.sid || "");
    if (Array.isArray(user.sessions)) {
      user.sessions = currentSid
        ? user.sessions.filter((entry) => String(entry.sid || "") === currentSid)
        : [];
    }
    await user.save();
    return res.json({ message: "Password updated" });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to change password" });
  }
});

router.get("/settings", requireAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.auth.username }).select("notificationPrefs notificationQuietHours privacySettings mutedUsers onboardingState bookmarkCollections pinnedChats followRequests");
    if (!user) return res.status(404).json({ message: "User not found" });
    const collections = Array.isArray(user.bookmarkCollections) ? user.bookmarkCollections : [];
    const pendingCount = Array.isArray(user.followRequests) ? user.followRequests.length : 0;
    return res.json({
      ...normalizeSettings(user),
      bookmarkCollections: collections.map((c) => ({
        name: String(c.name || ""),
        count: Array.isArray(c.postIds) ? c.postIds.length : 0
      })),
      followRequestsCount: pendingCount
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to load settings" });
  }
});

router.put("/settings", requireAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.auth.username });
    if (!user) return res.status(404).json({ message: "User not found" });

    if (req.body && req.body.notificationPrefs && typeof req.body.notificationPrefs === "object") {
      const next = req.body.notificationPrefs;
      user.notificationPrefs = {
        like: next.like !== false,
        comment: next.comment !== false,
        reply: next.reply !== false,
        mention: next.mention !== false,
        follow: next.follow !== false,
        follow_request: next.follow_request !== false,
        message: next.message !== false,
        call_missed: next.call_missed !== false,
        collection_save: next.collection_save !== false
      };
    }
    if (req.body && req.body.notificationQuietHours && typeof req.body.notificationQuietHours === "object") {
      const nextQuiet = req.body.notificationQuietHours;
      const startHour = Number(nextQuiet.startHour);
      const endHour = Number(nextQuiet.endHour);
      user.notificationQuietHours = {
        enabled: !!nextQuiet.enabled,
        startHour: Number.isFinite(startHour) ? Math.min(23, Math.max(0, startHour)) : 22,
        endHour: Number.isFinite(endHour) ? Math.min(23, Math.max(0, endHour)) : 7,
        timezone: String(nextQuiet.timezone || "UTC").slice(0, 64)
      };
    }
    if (req.body && req.body.privacySettings && typeof req.body.privacySettings === "object") {
      const next = req.body.privacySettings;
      user.privacySettings = {
        accountVisibility: ["public", "private"].includes(String(next.accountVisibility || "")) ? String(next.accountVisibility) : "public",
        allowMessagesFrom: ["everyone", "followers", "none"].includes(String(next.allowMessagesFrom || "")) ? String(next.allowMessagesFrom) : "everyone",
        allowCallsFrom: ["everyone", "followers", "none"].includes(String(next.allowCallsFrom || "")) ? String(next.allowCallsFrom) : "everyone",
        allowCommentsFrom: ["everyone", "followers", "none"].includes(String(next.allowCommentsFrom || "")) ? String(next.allowCommentsFrom) : "everyone"
      };
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "mutedUsers")) {
      const nextMuted = Array.isArray(req.body.mutedUsers) ? req.body.mutedUsers : [];
      user.mutedUsers = nextMuted.map((u) => String(u || "").trim()).filter(Boolean).slice(0, 300);
    }
    if (req.body && req.body.onboardingState && typeof req.body.onboardingState === "object") {
      const nextState = req.body.onboardingState;
      user.onboardingState = {
        completed: !!nextState.completed,
        dismissedAt: nextState.dismissedAt ? new Date(nextState.dismissedAt) : (nextState.completed ? new Date() : null)
      };
    }
    if (req.body && req.body.pinnedChats && typeof req.body.pinnedChats === "object") {
      const entries = Object.entries(req.body.pinnedChats).slice(0, 300);
      const nextPinned = {};
      entries.forEach(([k, v]) => {
        const key = String(k || "").slice(0, 160);
        if (!key || !v || typeof v !== "object") return;
        const messageId = String(v.messageId || "").slice(0, 120);
        const preview = String(v.preview || "").slice(0, 160);
        if (!messageId) return;
        nextPinned[key] = { messageId, preview };
      });
      user.pinnedChats = nextPinned;
    }
    await user.save();
    return res.json({ message: "Settings updated", settings: normalizeSettings(user) });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to update settings" });
  }
});

router.get("/security-events", requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || "100", 10) || 100, 1), 300);
    const items = await SecurityEvent.find({
      $or: [
        { username: req.auth.username },
        { userId: req.auth.userId }
      ]
    })
      .sort({ createdAt: -1 })
      .limit(limit);
    return res.json({
      items: items.map((e) => ({
        id: String(e._id),
        type: String(e.type || ""),
        ip: String(e.ip || ""),
        userAgent: String(e.userAgent || ""),
        meta: (e.meta && typeof e.meta === "object") ? e.meta : {},
        createdAt: e.createdAt
      }))
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to fetch security events" });
  }
});

router.get("/bookmarks/collections", requireAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.auth.username }).select("bookmarkCollections");
    if (!user) return res.status(404).json({ message: "User not found" });
    const collections = Array.isArray(user.bookmarkCollections) ? user.bookmarkCollections : [];
    return res.json({
      items: collections.map((c) => ({
        name: String(c.name || ""),
        postIds: Array.isArray(c.postIds) ? c.postIds.map((id) => String(id)) : [],
        count: Array.isArray(c.postIds) ? c.postIds.length : 0
      }))
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to fetch collections" });
  }
});

router.post("/bookmarks/collections", requireAuth, async (req, res) => {
  try {
    const name = String((req.body && req.body.name) || "").trim();
    if (!name) return res.status(400).json({ message: "Collection name is required" });
    const user = await User.findOne({ username: req.auth.username }).select("bookmarkCollections");
    if (!user) return res.status(404).json({ message: "User not found" });
    const list = Array.isArray(user.bookmarkCollections) ? user.bookmarkCollections : [];
    const exists = list.some((c) => String(c.name || "").toLowerCase() === name.toLowerCase());
    if (exists) return res.status(400).json({ message: "Collection already exists" });
    list.push({ name: name.slice(0, 48), postIds: [] });
    user.bookmarkCollections = list.slice(0, 30);
    await user.save();
    return res.status(201).json({ message: "Collection created" });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to create collection" });
  }
});

router.delete("/bookmarks/collections/:name", requireAuth, async (req, res) => {
  try {
    const name = String(req.params.name || "").trim().toLowerCase();
    const user = await User.findOne({ username: req.auth.username }).select("bookmarkCollections");
    if (!user) return res.status(404).json({ message: "User not found" });
    user.bookmarkCollections = (user.bookmarkCollections || []).filter((c) => String(c.name || "").trim().toLowerCase() !== name);
    await user.save();
    return res.json({ message: "Collection deleted" });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to delete collection" });
  }
});

router.post("/bookmarks/collections/:name/posts", requireAuth, async (req, res) => {
  try {
    const name = String(req.params.name || "").trim();
    const postId = String((req.body && req.body.postId) || "").trim();
    if (!name || !postId) return res.status(400).json({ message: "name and postId are required" });
    const user = await User.findOne({ username: req.auth.username }).select("bookmarkCollections");
    if (!user) return res.status(404).json({ message: "User not found" });
    const collection = (user.bookmarkCollections || []).find((c) => String(c.name || "").toLowerCase() === name.toLowerCase());
    if (!collection) return res.status(404).json({ message: "Collection not found" });
    const ids = new Set((collection.postIds || []).map((id) => String(id)));
    ids.add(postId);
    collection.postIds = Array.from(ids);
    await user.save();
    const post = await Post.findById(postId).select("authorUsername _id");
    if (post && String(post.authorUsername || "") && String(post.authorUsername || "") !== String(req.auth.username || "")) {
      await createNotification({
        recipientUsername: String(post.authorUsername || ""),
        actorUsername: req.auth.username,
        type: "collection_save",
        text: `@${req.auth.username} saved your post to a collection`,
        entityType: "post",
        entityId: String(post._id),
        link: `index.html#post-${encodeURIComponent(String(post._id))}`
      });
    }
    return res.json({ message: "Post added to collection" });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to update collection" });
  }
});

router.get("/follow-requests", requireAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.auth.username }).populate("followRequests", "username displayName profilePic isVerified");
    if (!user) return res.status(404).json({ message: "User not found" });
    const items = (user.followRequests || []).map((u) => ({
      username: u.username,
      name: u.displayName || u.username,
      avatarUrl: u.profilePic || "",
      isVerified: !!u.isVerified
    }));
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to fetch follow requests" });
  }
});

router.post("/follow-requests/:username/accept", requireAuth, async (req, res) => {
  try {
    const owner = await User.findOne({ username: req.auth.username });
    const requester = await User.findOne({ username: req.params.username });
    if (!owner || !requester) return res.status(404).json({ message: "User not found" });
    const pending = Array.isArray(owner.followRequests) && owner.followRequests.some((id) => String(id) === String(requester._id));
    if (!pending) return res.status(404).json({ message: "Follow request not found" });

    await User.updateOne({ _id: owner._id }, { $pull: { followRequests: requester._id }, $addToSet: { followers: requester._id } });
    await User.updateOne({ _id: requester._id }, { $addToSet: { following: owner._id } });

    await createNotification({
      recipientUsername: requester.username,
      actorUsername: owner.username,
      type: "follow",
      text: `@${owner.username} accepted your follow request`,
      entityType: "user",
      entityId: String(owner._id),
      link: `user-profile.html?u=${encodeURIComponent(owner.username)}`
    });
    return res.json({ message: "Follow request accepted" });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to accept request" });
  }
});

router.post("/follow-requests/:username/reject", requireAuth, async (req, res) => {
  try {
    const owner = await User.findOne({ username: req.auth.username });
    const requester = await User.findOne({ username: req.params.username });
    if (!owner || !requester) return res.status(404).json({ message: "User not found" });
    await User.updateOne({ _id: owner._id }, { $pull: { followRequests: requester._id } });
    return res.json({ message: "Follow request rejected" });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to reject request" });
  }
});

router.delete("/bookmarks/collections/:name/posts/:postId", requireAuth, async (req, res) => {
  try {
    const name = String(req.params.name || "").trim();
    const postId = String(req.params.postId || "").trim();
    const user = await User.findOne({ username: req.auth.username }).select("bookmarkCollections");
    if (!user) return res.status(404).json({ message: "User not found" });
    const collection = (user.bookmarkCollections || []).find((c) => String(c.name || "").toLowerCase() === name.toLowerCase());
    if (!collection) return res.status(404).json({ message: "Collection not found" });
    collection.postIds = (collection.postIds || []).filter((id) => String(id) !== postId);
    await user.save();
    return res.json({ message: "Post removed from collection" });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to update collection" });
  }
});

router.post("/delete-account", requireAuth, async (req, res) => {
  try {
    const username = req.auth.username;
    const password = String(req.body.password || "");
    if (!password) {
      return res.status(400).json({ message: "Password is required" });
    }

    const user = await User.findOne({ username }).select("_id username password");
    if (!user) return res.status(404).json({ message: "User not found" });

    const valid = await bcrypt.compare(password, String(user.password || ""));
    if (!valid) return res.status(400).json({ message: "Password is incorrect" });

    const myId = user._id;

    const myPosts = await Post.find({ authorUsername: username }).select("_id");
    const myPostIds = myPosts.map((p) => p._id);

    await Post.deleteMany({ authorUsername: username });
    await Story.deleteMany({ authorUsername: username });

    const foreignPosts = await Post.find({
      $or: [
        { likes: username },
        { "comments.username": username },
        { "comments.replies.username": username }
      ]
    });
    for (const post of foreignPosts) {
      post.likes = (post.likes || []).filter((u) => String(u || "") !== username);
      const nextComments = (post.comments || [])
        .filter((c) => String(c.username || "") !== username)
        .map((c) => {
          c.replies = (c.replies || []).filter((r) => String(r.username || "") !== username);
          return c;
        });
      post.comments = nextComments;
      await post.save();
    }

    const foreignStories = await Story.find({
      $or: [
        { "views.username": username },
        { "reactions.username": username },
        { "replies.fromUsername": username }
      ]
    });
    for (const story of foreignStories) {
      story.views = (story.views || []).filter((v) => String(v.username || "") !== username);
      story.reactions = (story.reactions || []).filter((r) => String(r.username || "") !== username);
      story.replies = (story.replies || []).filter((r) => String(r.fromUsername || "") !== username);
      await story.save();
    }

    await Message.deleteMany({ $or: [{ senderId: myId }, { receiverId: myId }] });
    await Notification.deleteMany({
      $or: [
        { recipientUsername: username },
        { actorUsername: username }
      ]
    });
    await Report.deleteMany({
      $or: [
        { reporterUsername: username },
        { targetUsername: username }
      ]
    });
    await CallLog.deleteMany({ $or: [{ callerId: myId }, { receiverId: myId }] });

    const pullUpdate = {
      $pull: {
        followers: myId,
        following: myId,
        blockedUsers: myId
      }
    };
    await User.updateMany({ _id: { $ne: myId } }, pullUpdate);
    if (myPostIds.length) {
      await User.updateMany({}, { $pull: { savedPosts: { $in: myPostIds } } });
      await User.updateMany(
        { pinnedPost: { $in: myPostIds } },
        { $set: { pinnedPost: null } }
      );
    }
    await User.deleteOne({ _id: myId });

    return res.json({ message: "Account deleted" });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to delete account" });
  }
});

router.get("/export-data", requireAuth, async (req, res) => {
  try {
    const username = req.auth.username;
    const user = await User.findOne({ username })
      .populate("followers", "username displayName profilePic isVerified")
      .populate("following", "username displayName profilePic isVerified")
      .populate("blockedUsers", "username displayName profilePic isVerified");
    if (!user) return res.status(404).json({ message: "User not found" });

    const posts = await Post.find({ authorUsername: username }).sort({ createdAt: -1 }).lean();
    const stories = await Story.find({ authorUsername: username }).sort({ createdAt: -1 }).lean();
    const messages = await Message.find({
      $or: [{ senderId: user._id }, { receiverId: user._id }]
    }).sort({ createdAt: -1 }).lean();
    const reports = await Report.find({ reporterUsername: username }).sort({ createdAt: -1 }).lean();
    const callLogs = await CallLog.find({
      $or: [{ callerId: user._id }, { receiverId: user._id }]
    }).sort({ createdAt: -1 }).lean();

    const payload = {
      exportedAt: new Date().toISOString(),
      username,
      profile: normalizeProfile(user),
      posts,
      stories,
      messages,
      reports,
      callLogs
    };

    return res.json(payload);
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to export data" });
  }
});

module.exports = router;
