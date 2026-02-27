const mongoose = require("mongoose");
const logger = require("../utils/logger");
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/ASCAPDX-COMMUNITY";

const connectDB = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    const dbName = mongoose.connection && mongoose.connection.name ? mongoose.connection.name : "unknown";
    logger.info("mongodb_connected", { dbName });
  } catch (err) {
    logger.error("mongodb_connect_failed", { error: err });
    process.exit(1);
  }
};

module.exports = connectDB;

