const fs = require("fs/promises");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const mongoose = require("mongoose");
const logger = require("./logger");

const execFileAsync = promisify(execFile);

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function replaceDbInUri(uri, dbName) {
  const raw = String(uri || "").trim();
  if (!raw) return raw;
  const qIndex = raw.indexOf("?");
  const base = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const query = qIndex === -1 ? "" : raw.slice(qIndex);
  const slashIndex = base.lastIndexOf("/");
  if (slashIndex === -1) return `${raw}/${dbName}`;
  return `${base.slice(0, slashIndex + 1)}${dbName}${query}`;
}

function parseBaseDbName(uri) {
  const raw = String(uri || "").trim();
  if (!raw) return "ascapdx";
  const qIndex = raw.indexOf("?");
  const base = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const slashIndex = base.lastIndexOf("/");
  const dbName = slashIndex >= 0 ? base.slice(slashIndex + 1).trim() : "";
  return dbName || "ascapdx";
}

function parseCollections(value) {
  return String(value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

async function runBinary(bin, args, timeoutMs = 10 * 60 * 1000) {
  const out = await execFileAsync(bin, args, { timeout: timeoutMs, windowsHide: true });
  return {
    stdout: String((out && out.stdout) || ""),
    stderr: String((out && out.stderr) || "")
  };
}

async function runBackupRestoreValidation(options = {}) {
  const mongoUri = String(options.mongoUri || process.env.MONGO_URI || "").trim();
  if (!mongoUri) {
    return { ok: false, reason: "missing_mongo_uri" };
  }

  const dumpBin = String(options.dumpBin || process.env.MONGODUMP_BIN || "mongodump").trim();
  const restoreBin = String(options.restoreBin || process.env.MONGORESTORE_BIN || "mongorestore").trim();
  const keepArchive = parseBool(
    options.keepArchive !== undefined ? options.keepArchive : process.env.BACKUP_VALIDATION_KEEP_ARCHIVE,
    false
  );
  const backupDir = String(
    options.backupDir || process.env.BACKUP_VALIDATION_DIR || path.join(process.cwd(), "backups", "validation")
  ).trim();
  const baseDb = String(options.baseDb || parseBaseDbName(mongoUri)).trim();
  const now = Date.now();
  const restoreDb = `${baseDb}_restore_validate_${now}`;
  const archivePath = path.join(backupDir, `backup-${now}.archive.gz`);
  const collections = parseCollections(
    options.collections || process.env.BACKUP_VALIDATE_COLLECTIONS || "users,posts,messages,emailotps,securityevents,otpdeliveryevents"
  );

  let sourceConn = null;
  let restoreConn = null;
  const startedAt = Date.now();
  const warnings = [];

  try {
    await fs.mkdir(backupDir, { recursive: true });

    await runBinary(dumpBin, [`--uri=${mongoUri}`, `--archive=${archivePath}`, "--gzip"]);
    await runBinary(restoreBin, [
      `--uri=${mongoUri}`,
      `--archive=${archivePath}`,
      "--gzip",
      "--drop",
      `--nsFrom=${baseDb}.*`,
      `--nsTo=${restoreDb}.*`
    ]);

    sourceConn = await mongoose.createConnection(mongoUri).asPromise();
    restoreConn = await mongoose.createConnection(replaceDbInUri(mongoUri, restoreDb)).asPromise();

    const mismatches = [];
    for (const name of collections) {
      const sourceCount = await sourceConn.db.collection(name).estimatedDocumentCount();
      const restoreCount = await restoreConn.db.collection(name).estimatedDocumentCount();
      if (sourceCount !== restoreCount) {
        mismatches.push({ collection: name, sourceCount, restoreCount });
      }
    }

    return {
      ok: mismatches.length === 0,
      backupDir,
      archivePath,
      restoreDb,
      checkedCollections: collections,
      mismatches,
      durationMs: Date.now() - startedAt,
      warnings
    };
  } catch (err) {
    if (
      String((err && err.message) || "").toLowerCase().includes("not recognized")
      || String((err && err.code) || "").toUpperCase() === "ENOENT"
    ) {
      warnings.push("Install MongoDB Database Tools and ensure mongodump/mongorestore are in PATH.");
    }
    return {
      ok: false,
      backupDir,
      archivePath,
      restoreDb,
      checkedCollections: collections,
      mismatches: [],
      durationMs: Date.now() - startedAt,
      warnings,
      error: {
        message: String((err && err.message) || "backup_restore_validation_failed"),
        code: String((err && err.code) || "")
      }
    };
  } finally {
    if (restoreConn) {
      await restoreConn.close().catch(() => {});
    }
    if (sourceConn) {
      await sourceConn.client.db(restoreDb).dropDatabase().catch(() => {});
      await sourceConn.close().catch(() => {});
    }
    if (!keepArchive) {
      await fs.unlink(archivePath).catch(() => {});
    }
  }
}

function isBackupValidationEnabled() {
  return parseBool(process.env.BACKUP_VALIDATION_ENABLED, false);
}

function getBackupValidationIntervalMs() {
  const hours = Math.max(1, parseInt(process.env.BACKUP_VALIDATION_INTERVAL_HOURS || "24", 10) || 24);
  return hours * 60 * 60 * 1000;
}

function scheduleBackupValidation() {
  if (!isBackupValidationEnabled()) return null;

  async function run() {
    const result = await runBackupRestoreValidation();
    if (result.ok) {
      logger.info("backup_restore_validation_ok", {
        durationMs: result.durationMs,
        checkedCollections: result.checkedCollections,
        backupDir: result.backupDir
      });
      return;
    }
    logger.error("backup_restore_validation_failed", {
      durationMs: result.durationMs,
      checkedCollections: result.checkedCollections,
      mismatches: result.mismatches,
      warnings: result.warnings,
      error: result.error
    });
  }

  run().catch(() => {});
  const timer = setInterval(() => {
    run().catch(() => {});
  }, getBackupValidationIntervalMs());
  if (timer && typeof timer.unref === "function") timer.unref();
  return timer;
}

module.exports = {
  runBackupRestoreValidation,
  scheduleBackupValidation
};
