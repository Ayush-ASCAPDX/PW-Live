# Health Endpoint

## Route

- `GET /api/health`

## Status codes

- `200 OK`: Application is healthy.
  - MongoDB is `up`
  - Redis is `up` or `not_configured`
- `503 Service Unavailable`: Application is degraded/down.
  - MongoDB is `down`, or
  - Redis is `down`/`degraded`

## Response schema

```json
{
  "status": "ok | degraded | down",
  "now": "ISO-8601 timestamp",
  "uptimeSec": 12345,
  "services": {
    "db": {
      "status": "up | down",
      "readyState": 0
    },
    "redis": {
      "configured": true,
      "status": "up | down | degraded | not_configured",
      "error": "optional message"
    }
  }
}
```

## Alerting behavior

- Health monitor interval: `HEALTH_MONITOR_INTERVAL_SEC` (default `60`)
- Repeated alert cooldown: `HEALTH_ALERT_COOLDOWN_SEC` (default `300`)
- Optional alert email recipients: `HEALTH_ALERT_EMAIL_TO` (comma-separated)

Alerts are emitted when:

- service state degrades (`health_degraded_alert`)
- service recovers (`health_recovered_alert`)

All logs include `requestId` for incoming requests when available.

## Probe guidance

- Kubernetes readiness/liveness: use `/api/health`.
- If Redis is optional in your deployment, keep `REDIS_URL` unset to report `not_configured` instead of failure.
