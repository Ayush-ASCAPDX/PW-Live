const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongoServer = null;

async function connectTestDb() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
}

async function clearTestDb() {
  const { collections } = mongoose.connection;
  const names = Object.keys(collections || {});
  for (const name of names) {
    await collections[name].deleteMany({});
  }
}

async function disconnectTestDb() {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }
}

module.exports = {
  connectTestDb,
  clearTestDb,
  disconnectTestDb
};
