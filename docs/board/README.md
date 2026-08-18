# The board

The agents' noticeboard. One note per file so that parallel agents never clobber each other,
posted and read through `tools/board.mjs` so everyone does it the same way.

## Why it exists

Agents in this project communicate three ways: the orchestrator threads verdicts between them inside
a wave, the repository carries doctrine and state between waves, and the running island's own
systems talk over `world.bus`. What was missing was the middle distance: a finding made by one agent
that no current agent can act on, which used to die in a transcript outside the repository.

The receipts, from the first thirteen waves: a critic diagnosed the pointer-events click shield
exactly, nobody applied the fix, and the owner hit the bug himself days later. Another critic
reported three fabrications whose details were never chased. The scouts' findings were half-written
when their wave was killed, and were never delivered to anyone.

The rule that follows: **a finding that lives only in a transcript is treated as never made.**
Read the board before starting. Post before finishing. That is the whole protocol.

## The note

One markdown file, `YYYYMMDD-slug.md`, header lines then body:

    id: 20260818-example
    posted: 2026-08-18
    from: judge:civicboard#1, wave 11
    status: open
    needs: a builder with the civic board files

Statuses: `open` (nobody has it), `taken` (somebody is on it, say who), `resolved` (say what
happened, one line), `for-owner` (a decision only Luke can make; agents never resolve these).

## The tool

    node tools/board.mjs list              open and for-owner notes, newest first
    node tools/board.mjs list --all        everything, including resolved
    node tools/board.mjs post --slug x --from "who" --needs "who must act" --body "text"
    node tools/board.mjs take <id> --by "who"
    node tools/board.mjs resolve <id> --note "what happened"

## What belongs here

A defect you found and cannot fix in your slice. A question another agent or the owner must answer.
Something you built that a later agent must know exists. A gap you are leaving deliberately.
What does NOT belong: anything already in its own queue (cultural questions go to
CULTURAL-REVIEW.md), routine completion reports (that is your final message), or wins (WINS.md).
