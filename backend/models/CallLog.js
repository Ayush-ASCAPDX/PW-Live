const mongoose = require("mongoose");

const callLogSchema = new mongoose.Schema({
  callerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  status: {
    type: String,
    enum: ["completed", "missed", "rejected", "cancelled"],
    required: true
  },
  durationSec: {
    type: Number,
    default: 0
  },
  startedAt: {
    type: Date
  },
  endedAt: {
    type: Date
  },
  endReason: {
    type: String,
    default: ""
  }
}, { timestamps: true });

module.exports = mongoose.model("CallLog", callLogSchema);
