CREATE TABLE IF NOT EXISTS product_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at INTEGER NOT NULL DEFAULT (unixepoch()),
  event TEXT NOT NULL CHECK (
    event IN (
      'page_view',
      'download_clicked',
      'download_served',
      'app_first_opened',
      'app_opened',
      'onboarding_completed',
      'sessions_indexed'
    )
  ),
  source TEXT NOT NULL CHECK (source IN ('landing', 'desktop')),
  install_id TEXT,
  app_version TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (
    platform IN ('macos', 'windows', 'linux', 'unknown')
  ),
  country TEXT NOT NULL CHECK (length(country) = 2)
);

CREATE INDEX IF NOT EXISTS product_events_time
  ON product_events (occurred_at);

CREATE INDEX IF NOT EXISTS product_events_funnel
  ON product_events (source, event, occurred_at);
