# Privacy-minimized usage metrics

God of Sessions stores allowlisted events in the private Cloudflare D1 database
`god-of-sessions-metrics`.

## Event schema

| Field | D1 column | Meaning |
| --- | --- | --- |
| Event | `event` | Allowlisted event name |
| Source | `source` | `landing` or `desktop` |
| App version | `app_version` | Packaged app version or `unknown` |
| Platform | `platform` | `macos`, `windows`, `linux`, or `unknown` |
| Country | `country` | Edge-derived two-letter country or `XX` |
| Pseudonymous installation | `install_id` | Random UUID for desktop events; empty for landing events |
| Time | `occurred_at` | Edge receipt time as Unix seconds |

The dataset intentionally has no prompt, response, path, repository, branch,
session, provider credential, error message, stack trace, account, or email
field.

## Useful queries

Seven-day event totals:

```sql
SELECT
  event,
  COUNT(*) AS events
FROM product_events
WHERE occurred_at >= unixepoch('now', '-7 days')
GROUP BY event
ORDER BY events DESC
```

Estimated installs and active installations:

```sql
SELECT
  event,
  COUNT(DISTINCT install_id) AS anonymous_installations
FROM product_events
WHERE
  source = 'desktop'
  AND event IN ('app_first_opened', 'app_opened')
  AND occurred_at >= unixepoch('now', '-30 days')
GROUP BY event
```

Release funnel:

```sql
SELECT
  event,
  COUNT(DISTINCT install_id) AS anonymous_installations
FROM product_events
WHERE
  source = 'desktop'
  AND event IN (
    'app_first_opened',
    'onboarding_completed',
    'sessions_indexed'
  )
GROUP BY event
```

Run these from the repository root with the Cloudflare-authenticated CLI:

```sh
npx wrangler d1 execute god-of-sessions-metrics --remote \
  --command "SELECT event, COUNT(*) AS events FROM product_events GROUP BY event"
```

## User controls

- Settings → Privacy → Share anonymous usage data
- `DO_NOT_TRACK=1`
- `GOD_OF_SESSIONS_TELEMETRY_DISABLED=1`

Development builds do not send events.
Skipping onboarding keeps sharing off. Existing users upgrading from a version
without this setting remain opted out unless they enable it. D1 rows are
deleted automatically after 180 days.

## Interpretation limits

The random installation UUID is pseudonymous: it contains no device or account
identifier, but it links events from one installation until local app storage
is cleared. There is no account-based deletion endpoint because the app has no
account system; disabling sharing prevents the next event, and stored rows
expire after 180 days.

Install and active-installation figures are consented product estimates, not
auditable security, billing, or financial records. The public ingestion
endpoint enforces a tiny schema and trusted app origins to prevent accidental
data collection, but it has no user credential. A determined client can submit
synthetic valid events, and reinstalls or cleared local storage can create a
new installation UUID.
