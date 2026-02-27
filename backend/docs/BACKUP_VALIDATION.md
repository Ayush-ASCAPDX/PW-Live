# Backup/Restore Validation

## Manual run

- Command: `npm run backup:validate`
- Exit code:
  - `0` validation passed
  - `1` validation failed

The validator:

1. Creates a MongoDB archive with `mongodump`
2. Restores it into a temporary database with `mongorestore`
3. Compares document counts for configured collections
4. Drops the temporary database
5. Deletes archive unless `BACKUP_VALIDATION_KEEP_ARCHIVE=true`

## Required tools

- MongoDB Database Tools installed and available in PATH:
  - `mongodump`
  - `mongorestore`

## Scheduled mode (inside API process)

Enable environment variables:

- `BACKUP_VALIDATION_ENABLED=true`
- `BACKUP_VALIDATION_INTERVAL_HOURS=24`
- `BACKUP_VALIDATION_DIR=./backups/validation`
- `BACKUP_VALIDATE_COLLECTIONS=users,posts,messages,emailotps,securityevents,otpdeliveryevents`

When enabled, the backend runs validations on startup and then on interval.
