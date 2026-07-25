# Keep provider state authoritative

God of Sessions projects sessions, work items, runs, and capacity into one
control plane but does not silently copy them into a second execution system.
Provider databases and explicit task stores remain authoritative; the app
keeps source identifiers and records only its own plans, approvals, and
dispatch receipts. This costs adapter work, but avoids drift and makes every
cross-provider judgment auditable.
