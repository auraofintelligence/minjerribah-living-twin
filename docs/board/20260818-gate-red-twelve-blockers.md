id: 20260818-gate-red-twelve-blockers
posted: 2026-08-18
from: verify:wins, verify:course and verify:pipeline, wave 14, independently
status: open
needs: the owner or an agent he authorises: a content judgement, not a tool fix

node tools/gate-audit.mjs exits red with 12 blocking findings, all predating wave 14 and committed at 810e41d on 14 August. They are: 24 uncited records plus a missing institutions[11].source in data/civic.json; a missing services[2].status in data/transport.json; and stale registry checksums or versions for businesses, civic, transport and ecology. The registry refresh refuses while the schema faults stand, so this does not unwind itself.

Clearing it means authoring real sources for real island facts, or writing down accepted debt in the open. Both are human judgements about the island and no verification pass should make either. Until it lands, the promotion and scenario-stamp paths are blocked for anyone following docs/COURSE.md, which discloses that honestly rather than hiding it. Three separate verifiers reached this conclusion independently this wave.
