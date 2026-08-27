# Overnight M41 — explain a no-run answer where it is given

M40 correctly moves projects without a writable route into the explained
exclusions. The no-candidate card, however, still said only that projects
might be running or waiting for a person. The actual per-project explanations
appeared much later, below host, quota, and route diagnostics.

That made the safest outcome—run nothing—harder to trust precisely when a
route adapter was missing or unhealthy.

## Answer-first exclusions

When no candidate survives, the empty recommendation card now shows:

- the first three excluded projects;
- each project's exact planner-produced reason; and
- a count pointing to the complete list when more projects were considered.

The lower complete exclusion list remains the durable methodology detail. The
top card is a concise answer, not a second inference layer: it renders the
same typed exclusion records produced by the planner.

The layout collapses each project and reason into one column on narrow
windows, and the list has an accessible label.

## Verification

- the production TypeScript and Vite build passes;
- the normal non-empty M41 recommendation screen was inspected in the running
  app after hot reload;
- existing candidate, portfolio, quota, and route sections remain unchanged.
