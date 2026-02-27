const express = require("express");
const router = express.Router();
const Report = require("../models/Report");
const { requireAuth } = require("../middleware/auth");

const ALLOWED_TARGET_TYPES = new Set(["user", "post", "story", "message"]);

router.post("/", requireAuth, async (req, res) => {
  try {
    const reporterUsername = req.auth.username;
    const targetType = String(req.body.targetType || "").trim().toLowerCase();
    const targetId = String(req.body.targetId || "").trim();
    const targetUsername = String(req.body.targetUsername || "").trim();
    const reason = String(req.body.reason || "").trim();
    const details = String(req.body.details || "").trim();

    if (!ALLOWED_TARGET_TYPES.has(targetType)) {
      return res.status(400).json({ message: "Invalid report target type" });
    }
    if (!reason) {
      return res.status(400).json({ message: "Reason is required" });
    }
    if (!targetId && !targetUsername) {
      return res.status(400).json({ message: "Target is required" });
    }
    if (targetType === "user" && !targetUsername) {
      return res.status(400).json({ message: "targetUsername is required for user reports" });
    }
    if (targetType !== "user" && !targetId) {
      return res.status(400).json({ message: "targetId is required for this report type" });
    }
    if (targetUsername && reporterUsername === targetUsername) {
      return res.status(400).json({ message: "You cannot report yourself" });
    }

    const report = await Report.create({
      reporterUsername,
      targetType,
      targetId,
      targetUsername,
      reason,
      details
    });

    return res.status(201).json({
      message: "Report submitted",
      report: {
        id: String(report._id),
        targetType: report.targetType,
        targetId: report.targetId,
        targetUsername: report.targetUsername,
        reason: report.reason,
        status: report.status,
        createdAt: report.createdAt
      }
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to submit report" });
  }
});

router.get("/mine", requireAuth, async (req, res) => {
  try {
    const items = await Report.find({ reporterUsername: req.auth.username })
      .sort({ createdAt: -1 })
      .limit(100)
      .select("targetType targetId targetUsername reason status createdAt");
    return res.json({
      items: items.map((r) => ({
        id: String(r._id),
        targetType: r.targetType,
        targetId: r.targetId,
        targetUsername: r.targetUsername,
        reason: r.reason,
        status: r.status,
        createdAt: r.createdAt
      }))
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to fetch reports" });
  }
});

module.exports = router;
