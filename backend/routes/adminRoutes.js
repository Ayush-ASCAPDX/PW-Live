const express = require("express");
const router = express.Router();
const Report = require("../models/Report");
const User = require("../models/User");
const Post = require("../models/Post");
const Story = require("../models/Story");
const Message = require("../models/Message");
const CallLog = require("../models/CallLog");
const SecurityEvent = require("../models/SecurityEvent");
const OtpDeliveryEvent = require("../models/OtpDeliveryEvent");
const { requireAdmin } = require("../middleware/admin");

const ALLOWED_STATUS = new Set(["open", "reviewing", "resolved", "dismissed"]);

router.get("/reports", requireAdmin, async (req, res) => {
  try {
    const status = String(req.query.status || "").trim().toLowerCase();
    const limit = Math.min(parseInt(req.query.limit || "100", 10), 300);
    const query = {};
    if (status && ALLOWED_STATUS.has(status)) query.status = status;

    const items = await Report.find(query).sort({ createdAt: -1 }).limit(limit);
    return res.json({
      items: items.map((r) => ({
        id: String(r._id),
        reporterUsername: r.reporterUsername,
        targetType: r.targetType,
        targetId: r.targetId || "",
        targetUsername: r.targetUsername || "",
        reason: r.reason,
        details: r.details || "",
        status: r.status,
        reviewedBy: r.reviewedBy || "",
        reviewedAt: r.reviewedAt || null,
        moderatorNote: r.moderatorNote || "",
        createdAt: r.createdAt
      }))
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to fetch reports" });
  }
});

router.get("/reports/stats", requireAdmin, async (req, res) => {
  try {
    const grouped = await Report.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);
    const stats = { open: 0, reviewing: 0, resolved: 0, dismissed: 0, total: 0 };
    grouped.forEach((row) => {
      const key = String(row._id || "");
      const count = Number(row.count || 0);
      if (Object.prototype.hasOwnProperty.call(stats, key)) stats[key] = count;
      stats.total += count;
    });
    return res.json(stats);
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to fetch report stats" });
  }
});

router.patch("/reports/:reportId/status", requireAdmin, async (req, res) => {
  try {
    const status = String(req.body.status || "").trim().toLowerCase();
    const moderatorNote = String(req.body.moderatorNote || "").trim();
    if (!ALLOWED_STATUS.has(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const report = await Report.findById(req.params.reportId);
    if (!report) return res.status(404).json({ message: "Report not found" });

    report.status = status;
    report.reviewedBy = req.auth.username;
    report.reviewedAt = new Date();
    report.moderatorNote = moderatorNote;
    await report.save();

    return res.json({
      message: "Report updated",
      report: {
        id: String(report._id),
        status: report.status,
        reviewedBy: report.reviewedBy,
        reviewedAt: report.reviewedAt,
        moderatorNote: report.moderatorNote || ""
      }
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to update report" });
  }
});

router.patch("/users/:username/verify", requireAdmin, async (req, res) => {
  try {
    const targetUsername = String(req.params.username || "").trim();
    const verified = !!req.body.verified;
    if (!targetUsername) return res.status(400).json({ message: "username is required" });

    const user = await User.findOne({ username: targetUsername });
    if (!user) return res.status(404).json({ message: "User not found" });
    user.isVerified = verified;
    await user.save();

    await Post.updateMany(
      { authorUsername: targetUsername },
      { $set: { authorVerified: verified } }
    );

    return res.json({
      message: verified ? "User verified" : "User unverified",
      user: {
        username: user.username,
        isVerified: !!user.isVerified
      }
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to update verification" });
  }
});

router.patch("/users/:username/role", requireAdmin, async (req, res) => {
  try {
    const targetUsername = String(req.params.username || "").trim();
    const role = String(req.body.role || "").trim().toLowerCase();
    if (!targetUsername) return res.status(400).json({ message: "username is required" });
    if (!["user", "admin"].includes(role)) {
      return res.status(400).json({ message: "role must be 'user' or 'admin'" });
    }

    const user = await User.findOne({ username: targetUsername });
    if (!user) return res.status(404).json({ message: "User not found" });

    if (String(user.username) === String(req.auth.username) && role !== "admin") {
      return res.status(400).json({ message: "You cannot remove your own admin role" });
    }

    user.role = role;
    await user.save();

    return res.json({
      message: "User role updated",
      user: {
        username: user.username,
        role: user.role
      }
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to update role" });
  }
});

router.get("/analytics/summary", requireAdmin, async (req, res) => {
  try {
    const [users, posts, stories, messages, calls, reportsOpen, reportsTotal] = await Promise.all([
      User.countDocuments({}),
      Post.countDocuments({}),
      Story.countDocuments({}),
      Message.countDocuments({}),
      CallLog.countDocuments({}),
      Report.countDocuments({ status: "open" }),
      Report.countDocuments({})
    ]);
    return res.json({
      users,
      posts,
      stories,
      messages,
      calls,
      reports: {
        open: reportsOpen,
        total: reportsTotal
      }
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to load analytics summary" });
  }
});

router.get("/users/:username/risk", requireAdmin, async (req, res) => {
  try {
    const username = String(req.params.username || "").trim();
    if (!username) return res.status(400).json({ message: "username is required" });

    const user = await User.findOne({ username }).select("_id username failedLoginCount loginLockedUntil blockedUsers followers followRequests");
    if (!user) return res.status(404).json({ message: "User not found" });

    const [reportsAsTarget, reportsAsReporter, postsCount, storiesCount] = await Promise.all([
      Report.countDocuments({ targetUsername: username }),
      Report.countDocuments({ reporterUsername: username }),
      Post.countDocuments({ authorUsername: username }),
      Story.countDocuments({ authorUsername: username })
    ]);

    let score = 0;
    score += Math.min(40, reportsAsTarget * 4);
    score += user.loginLockedUntil && new Date(user.loginLockedUntil).getTime() > Date.now() ? 25 : 0;
    score += Number(user.failedLoginCount || 0) * 2;
    score += Math.min(15, Math.floor((Array.isArray(user.blockedUsers) ? user.blockedUsers.length : 0) / 3));
    score -= Math.min(20, reportsAsReporter * 2);
    score = Math.max(0, Math.min(100, score));

    const level = score >= 70 ? "high" : score >= 35 ? "medium" : "low";
    return res.json({
      username: user.username,
      risk: {
        score,
        level
      },
      signals: {
        reportsAsTarget,
        reportsAsReporter,
        postsCount,
        storiesCount,
        failedLoginCount: Number(user.failedLoginCount || 0),
        currentlyLocked: !!(user.loginLockedUntil && new Date(user.loginLockedUntil).getTime() > Date.now())
      }
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to calculate risk" });
  }
});

router.get("/security-events", requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || "150", 10) || 150, 1), 500);
    const username = String(req.query.username || "").trim();
    const type = String(req.query.type || "").trim();
    const query = {};
    if (username) query.username = username;
    if (type) query.type = type;
    const items = await SecurityEvent.find(query).sort({ createdAt: -1 }).limit(limit);
    return res.json({
      items: items.map((e) => ({
        id: String(e._id),
        username: String(e.username || ""),
        email: String(e.email || ""),
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

router.get("/lockouts", requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const [activeUsers, recentEvents] = await Promise.all([
      User.find({ loginLockedUntil: { $gt: now } })
        .select("username email loginLockedUntil failedLoginCount")
        .sort({ loginLockedUntil: -1 })
        .limit(200),
      SecurityEvent.find({ type: { $in: ["login_locked", "login_locked_attempt"] } })
        .sort({ createdAt: -1 })
        .limit(200)
    ]);

    return res.json({
      active: activeUsers.map((u) => ({
        username: String(u.username || ""),
        email: String(u.email || ""),
        failedLoginCount: Number(u.failedLoginCount || 0),
        loginLockedUntil: u.loginLockedUntil || null
      })),
      recent: recentEvents.map((e) => ({
        id: String(e._id),
        username: String(e.username || ""),
        type: String(e.type || ""),
        ip: String(e.ip || ""),
        createdAt: e.createdAt
      }))
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to fetch lockouts" });
  }
});

router.get("/otp-telemetry", requireAdmin, async (req, res) => {
  try {
    const hours = Math.min(Math.max(parseInt(req.query.hours || "24", 10) || 24, 1), 24 * 14);
    const since = new Date(Date.now() - (hours * 60 * 60 * 1000));
    const [items, grouped] = await Promise.all([
      OtpDeliveryEvent.find({ createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(300),
      OtpDeliveryEvent.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { purpose: "$purpose", delivered: "$delivered" },
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    const summary = {
      total: 0,
      delivered: 0,
      failed: 0,
      byPurpose: {
        register: { delivered: 0, failed: 0 },
        login: { delivered: 0, failed: 0 },
        password_reset: { delivered: 0, failed: 0 }
      }
    };

    grouped.forEach((row) => {
      const purpose = String((row._id && row._id.purpose) || "register");
      const delivered = !!(row._id && row._id.delivered);
      const count = Number(row.count || 0);
      summary.total += count;
      if (delivered) summary.delivered += count;
      else summary.failed += count;
      if (summary.byPurpose[purpose]) {
        if (delivered) summary.byPurpose[purpose].delivered += count;
        else summary.byPurpose[purpose].failed += count;
      }
    });

    return res.json({
      hours,
      since,
      summary,
      items: items.map((e) => ({
        id: String(e._id),
        email: String(e.email || ""),
        purpose: String(e.purpose || ""),
        delivered: !!e.delivered,
        provider: String(e.provider || "smtp"),
        messageId: String(e.messageId || ""),
        errorCode: String(e.errorCode || ""),
        errorMessage: String(e.errorMessage || ""),
        createdAt: e.createdAt
      }))
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to fetch OTP telemetry" });
  }
});

module.exports = router;
