const mongoose = require("mongoose");

const securityEventSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },
  username: {
    type: String,
    default: "",
    index: true
  },
  email: {
    type: String,
    default: "",
    index: true
  },
  type: {
    type: String,
    required: true,
    index: true
  },
  ip: {
    type: String,
    default: ""
  },
  userAgent: {
    type: String,
    default: ""
  },
  meta: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true });

module.exports = mongoose.model("SecurityEvent", securityEventSchema);
