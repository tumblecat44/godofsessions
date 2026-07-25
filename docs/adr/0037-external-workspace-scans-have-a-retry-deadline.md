# External workspace scans have a retry deadline

Do not rebuild every provider session snapshot on every 15-second coordinator
tick while an external session occupies an approved workspace.

Persist a one-minute retry deadline for external-workspace waits and exclude
the item from start consideration until it is due. Keep same-plan workspace
occupancy in memory and check it every tick, because it needs no provider
discovery and can release a successor promptly after terminal evidence.

Capacity and workspace retries share the generic durable retry gate but retain
different cadences and explanations.
