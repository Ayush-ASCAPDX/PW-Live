const express = require("express");
const router = express.Router();
const CallLog = require("../models/CallLog");
const User = require("../models/User");
const { requireAuth } = require("../middleware/auth");

router.get("/history", requireAuth, async (req, res) => {
  try {
    const { username } = req.auth;
    const user = await User.findOne({ username }).select("_id username");
    if (!user) return res.status(404).json({ message: "User not found" });

    const logs = await CallLog.find({
      $or: [{ callerId: user._id }, { receiverId: user._id }]
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("callerId", "username")
      .populate("receiverId", "username");

    const out = logs.map((log) => {
      const caller = log.callerId && log.callerId.username ? log.callerId.username : "";
      const receiver = log.receiverId && log.receiverId.username ? log.receiverId.username : "";
      const direction = caller === username ? "outgoing" : "incoming";
      const peer = direction === "outgoing" ? receiver : caller;
      return {
        _id: log._id,
        caller,
        receiver,
        peer,
        direction,
        status: log.status,
        durationSec: log.durationSec || 0,
        startedAt: log.startedAt || null,
        endedAt: log.endedAt || null,
        endReason: log.endReason || "",
        createdAt: log.createdAt
      };
    });

    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/history", requireAuth, async (req, res) => {
  try {
    const { username } = req.auth;
    const user = await User.findOne({ username }).select("_id");
    if (!user) return res.status(404).json({ message: "User not found" });

    const result = await CallLog.deleteMany({
      $or: [{ callerId: user._id }, { receiverId: user._id }]
    });

    res.json({ message: "Call history cleared", deletedCount: result.deletedCount || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
