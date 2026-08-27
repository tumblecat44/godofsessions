# Keep Context Briefs ephemeral and bounded

God of Sessions may read recent provider conversations when the operator asks
it to understand today's project intent. It keeps only user and final-response
text, excludes system instructions, tools, and internal reasoning, bounds each
excerpt, and does not persist a second transcript store. Project briefs use
session bookends so the first intent and latest decisions remain visible.

This loses some middle context and makes unsupported provider formats explicit,
but reduces secret exposure, index drift, and the risk of confusing a copied
conversation with the provider-owned source.
