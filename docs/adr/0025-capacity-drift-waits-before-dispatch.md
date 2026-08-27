# Capacity drift waits before dispatch

Reload the exact selected subscription Capacity Pool immediately before each
scheduled start.

If the live usage observation is unavailable, degraded, empty, or effectively
exhausted, keep the approved item pending and persist a typed capacity-wait
reason. Retry observation only inside the original approved sleep window.

Do not:

- dispatch from a cached last-success usage value;
- reinterpret provider-preflight failure as a useful capacity queue;
- substitute a different project, subscription, model, or paid credit source;
- extend the approved wake deadline;
- estimate task feasibility from an undocumented percent-to-hours conversion.

Provider task cost depends on context and workload. A usage percentage is
therefore a start-safety signal, not a completion promise. The existing exact
provider preflight remains authoritative after the capacity gate.

Preserve backward compatibility with M23 ledgers: a legacy waiting reason with
no typed kind represents a workspace wait.

