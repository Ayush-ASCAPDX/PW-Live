const path = require("path");
const dotenv = require("dotenv");
const { runBackupRestoreValidation } = require("../utils/backupValidation");
const logger = require("../utils/logger");

dotenv.config();
dotenv.config({ path: path.join(__dirname, "..", ".env") });

(async () => {
  const result = await runBackupRestoreValidation();
  if (result && result.ok) logger.info("backup_restore_validation_cli", result);
  else logger.error("backup_restore_validation_cli_failed", result);
  process.exit(result.ok ? 0 : 1);
})().catch((err) => {
  logger.error("backup_restore_validation_cli_error", {
    ok: false,
    error: String((err && err.message) || "backup_restore_validation_failed")
  });
  process.exit(1);
});
