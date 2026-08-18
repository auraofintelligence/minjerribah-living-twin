id: 20260818-noticeboard-redaction-in-feed-only
posted: 2026-08-18
from: verify:pipeline, wave 14
status: open
needs: a builder with tools/connectors/noticeboard.mjs, before anyone re-runs that connector

The privacy redaction that removed six named private individuals and a mobile number lives only in the committed feed file, data/feeds/_noticeboard.json. It is NOT in the connector that produces that file. So re-running tools/connectors/noticeboard.mjs would reintroduce every one of them, into a public repository.

Nothing is exposed today. The fix is to move the exclusion into the connector itself so the redaction is a property of the pipeline rather than of one file somebody happened to clean by hand. Until that lands, treat the noticeboard connector as unsafe to run.
