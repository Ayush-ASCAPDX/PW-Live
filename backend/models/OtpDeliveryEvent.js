const mongoose = require("mongoose");

const otpDeliveryEventSchema = new mongoose.Schema({
  email: {
    type: String,
    default: "",
    lowercase: true,
    trim: true,
    index: true
  },
  purpose: {
    type: String,
    enum: ["register", "login", "password_reset"],
    default: "register",
    index: true
  },
  channel: {
    type: String,
    enum: ["email"],
    default: "email"
  },
  delivered: {
    type: Boolean,
    default: false,
    index: true
  },
  provider: {
    type: String,
    default: "smtp"
  },
  messageId: {
    type: String,
    default: ""
  },
  errorCode: {
    type: String,
    default: ""
  },
  errorMessage: {
    type: String,
    default: ""
  }
}, { timestamps: true });

otpDeliveryEventSchema.index({ createdAt: -1 });

module.exports = mongoose.model("OtpDeliveryEvent", otpDeliveryEventSchema);
