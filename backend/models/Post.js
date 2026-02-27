const mongoose = require("mongoose");

const postSchema = new mongoose.Schema({
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  authorUsername: {
    type: String,
    required: true
  },
  authorDisplayName: {
    type: String,
    default: ""
  },
  authorAvatarUrl: {
    type: String,
    default: ""
  },
  authorVerified: {
    type: Boolean,
    default: false
  },
  caption: {
    type: String,
    default: "",
    trim: true,
    maxlength: 500
  },
  mediaUrl: {
    type: String,
    required: true
  },
  mediaType: {
    type: String,
    enum: ["image", "video"],
    required: true
  },
  privacy: {
    type: String,
    enum: ["public", "followers", "private"],
    default: "public"
  },
  publishAt: {
    type: Date,
    default: Date.now
  },
  archived: {
    type: Boolean,
    default: false
  },
  likes: [{
    type: String
  }],
  sharesCount: {
    type: Number,
    default: 0
  },
  savesCount: {
    type: Number,
    default: 0
  },
  comments: [{
    username: {
      type: String,
      required: true
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 400
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    replies: [{
      username: {
        type: String,
        required: true
      },
      text: {
        type: String,
        required: true,
        trim: true,
        maxlength: 240
      },
      createdAt: {
        type: Date,
        default: Date.now
      }
    }]
  }]
}, { timestamps: true });

module.exports = mongoose.model("Post", postSchema);
