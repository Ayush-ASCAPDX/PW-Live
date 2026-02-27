const mongoose = require("mongoose");

const emailOtpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  purpose: {
    type: String,
    enum: ["register", "login", "password_reset"],
    default: "register"
  },
  codeHash: {
    type: String,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  verifiedAt: {
    type: Date,
    default: null
  },
  attempts: {
    type: Number,
    default: 0
  },
  requestDayStart: {
    type: Date,
    default: null
  },
  requestCountDay: {
    type: Number,
    default: 0
  },
  lastSentAt: {
    type: Date,
    default: null
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  }
}, { timestamps: true });

emailOtpSchema.index({ email: 1, purpose: 1 }, { unique: true });

module.exports = mongoose.model("EmailOtp", emailOtpSchema);
