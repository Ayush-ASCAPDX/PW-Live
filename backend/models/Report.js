const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema({
  reporterUsername: {
    type: String,
    required: true,
    index: true
  },
  targetType: {
    type: String,
    required: true,
    enum: ["user", "post", "story", "message"]
  },
  targetId: {
    type: String,
    default: ""
  },
  targetUsername: {
    type: String,
    default: ""
  },
  reason: {
    type: String,
    required: true,
    trim: true,
    maxlength: 400
  },
  details: {
    type: String,
    default: "",
    trim: true,
    maxlength: 1000
  },
  status: {
    type: String,
    enum: ["open", "reviewing", "resolved", "dismissed"],
    default: "open"
  },
  reviewedBy: {
    type: String,
    default: ""
  },
  reviewedAt: {
    type: Date,
    default: null
  },
  moderatorNote: {
    type: String,
    default: "",
    trim: true,
    maxlength: 1000
  }
}, { timestamps: true });

reportSchema.index({ reporterUsername: 1, targetType: 1, targetId: 1, targetUsername: 1, createdAt: -1 });

module.exports = mongoose.model("Report", reportSchema);
