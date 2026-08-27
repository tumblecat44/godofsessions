# Prewarm plan evidence without caching dispatch checks

Start the supported read-only subscription observation when the Overnight
screen mounts and share a completed result for at most 60 seconds within the
app process.

Serialize concurrent full observations so the prewarm and an immediate plan
request join one provider query instead of duplicating it. Preserve original
observation timestamps.

Do not apply this cache to exact provider capacity checks at scheduled
dispatch time. Planning responsiveness and dispatch authorization have
different freshness requirements.
