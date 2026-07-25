# Schedule wait reasons are typed contract data

Represent a delayed start's determining gates as typed values on the schedule
slot. Preserve them in the portfolio approval item and its fingerprint.

Do not reconstruct the reason from a positive offset in the GUI. An offset
alone cannot distinguish quota reset, shared subscription, and shared
worktree waits.

Record only gates equal to the final not-before offset, while preserving all
ties. Treat the reason as an explanation of the accepted plan, not as runtime
authorization; every live guard is still revalidated before dispatch.
