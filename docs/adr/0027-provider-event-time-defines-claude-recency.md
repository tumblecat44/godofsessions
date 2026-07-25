# Provider event time defines Claude recency

For a Claude JSONL transcript, derive canonical `created_at` and `updated_at`
from the earliest and latest valid provider event timestamps observed in the
bounded metadata windows.

Use filesystem modification time only when no valid event timestamp exists.

Do not equate a copy, migration, restore, or provider rewrite of the transcript
file with new user activity. Overnight recommendation and 24-hour memory
selection depend on conversational recency, not storage recency.

Keep the metadata pass content-blind. Reading user and assistant text remains
the separate ephemeral context-index responsibility.

