# Night workers outlive the GUI

An approved night run must not depend on the God of Sessions window remaining
open.

The desktop process therefore starts a separate copy of its own executable in
night-worker mode and passes the accepted contract through a bounded stdin
payload. The worker starts its own private provider connection, returns one
start receipt, and then monitors the provider turn independently.

On macOS the worker is launched through `caffeinate -i`. This prevents ordinary
idle sleep for the lifetime of the worker without promising to survive a
powered-off machine, forced process termination, or a closed laptop lid.

No prompt or credential is placed in argv. No public daemon or listener is
opened. A worker that receives an invalid contract exits before connecting to a
provider.

