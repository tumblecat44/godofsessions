# Privacy-minimized product telemetry is content-blind

God of Sessions collects a deliberately small set of pseudonymous product events
in packaged release builds. The purpose is to distinguish downloads from real
first launches and to measure whether new users reach the local session index.
A private Cloudflare D1 database receives the events, so the launch does not
add another analytics vendor or an application account system. Exact D1 rows
are appropriate for the launch volume and avoid sampled counts.

The desktop client creates one random installation UUID in local WebView
storage. It is not derived from a device identifier, account, network address,
hostname, user name, provider login, or repository. The server stores only:

- one allowlisted event name;
- the random installation UUID;
- application version;
- coarse operating-system family; and
- country code derived at the Cloudflare edge.

The only accepted desktop events are `app_first_opened`, `app_opened`,
`onboarding_completed`, and `sessions_indexed`. The ingestion boundary rejects
unknown fields and unknown event names, so prompts, responses, transcript
content, paths, repository names, branches, session titles, provider-native
identifiers, error text, and stack traces cannot be added accidentally.

Privacy-minimized usage sharing is visible during onboarding and in Settings. Turning
it off takes effect before the next event. Packaged builds also honor
`DO_NOT_TRACK=1` and `GOD_OF_SESSIONS_TELEMETRY_DISABLED=1`. Development builds
never send product events. Skipping onboarding keeps sharing off, and no
desktop event is sent before onboarding completes. Telemetry failure is silent
and cannot block local product behavior. A daily cleanup removes rows older
than 180 days.

The landing Worker separately records page views, download redirects, and
successful full DMG responses. These are traffic counts, not installation
counts: bots, retries, cache behavior, and repeat downloads can affect them.
`app_first_opened` is the closest available measure of an anonymous install.
Because the app has no account credential, valid events can be spoofed; these
counts are product estimates and must not be used for security, billing, or
financial reporting.

Provider-owned sessions and receipts remain authoritative. Telemetry is
aggregate product evidence only and must never become a session source, an
approval input, or a dispatch condition.
