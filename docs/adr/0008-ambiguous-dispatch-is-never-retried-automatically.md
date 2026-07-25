# Ambiguous dispatch is never retried automatically

A launcher timeout or missing JSON response does not prove that a worker
failed to start.

After Hermes task creation, God of Sessions treats the provider database as
the receipt source. It checks the exact task id, idempotency key, task status,
current run, worker pid, and session id. If that evidence cannot establish a
started Run, the result is uncertain and no automatic retry occurs.

Recovery requires a fresh preflight and operator approval. The stable
idempotency key prevents a second task from being created, while the isolated
board check prevents a retry from dispatching some other ready task.
