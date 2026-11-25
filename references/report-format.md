# Report format

## Contents

- [Findings JSON contract](#findings-json-contract)
- [Output shape](#output-shape)
- [After the builder's fix](#after-the-builders-fix)

Use the CLI's real output. Save findings outside both the source and temporary
run folder. Stop the app, pass `seal`, then run `cleanup` before `report`, in that
order. Cleanup prints a short `Receipt file:` path, never the receipt body. The
CLI stores that JSON at `break-it/receipts/<run-id>.json` under the guarded OS
temporary base, outside the deleted run. Report reads it by run id; do not add a
`receipt` field to findings or decode anything. Report requires the run folder
to be gone, checks the real fingerprint again, and deletes the receipt after
successful validation. A changed fingerprint stops reporting. Failed reports
keep the receipt so corrected findings can be retried.

## Findings JSON contract

```json
{
  "project": "shop-app",
  "round": 1,
  "attacks": { "tried": 2, "blocked": 1, "gotThrough": 1 },
  "findings": [
    {
      "id": "B01",
      "severity": "CRITICAL",
      "title": "Other people's orders are open",
      "Tried": "Logged in as user A and opened user B's local test order",
      "Saw": "The response contained B's invented order details",
      "Where": "server.mjs:42",
      "Advice": "Show an order only to the user who owns it"
    }
  ],
  "skipped": [
    { "id": "A07", "reason": "No create or update route to submit twice" }
  ],
  "inconclusive": [
    { "id": "T04", "reason": "The response was incomplete" }
  ]
}
```

`Where` is the actual relative source file and positive line number from the
tested copy; the example line number is illustrative. Do not put an absolute
personal path in a report.

For C02 history, use `<file>:<line> -> commit <7-char hash>` with the actual
historical line. The relative file and positive line keep the existing location
contract; the commit identifies the inspected version. Never paste raw history.

Family E uses E01 (too big), E02 (claimed type), E03 (dangerous names), E04
(inline script content), E05 (unbounded archive extraction), E06 (broken files),
E07 (another user's private upload) and E08 (reading outside the upload folder).
Keep the same Tried/Saw/Where/Advice
contract and real `file:line` in the tested copy. Describe generated kind,
bounded size, sent-name preset and the actual storage/read outcome, including
response-header evidence for E04 and relative traversal-marker locations for
E03. Use a unique descriptive suffix for distinct cases, such as `E03-arabic`,
when several findings share a family id. For E08, use a known harmless file one
level above the upload folder but inside the copy; quote only the status and
file name, never the returned content. A safe image that works for its owner
is blocked against the attempted failure, never a finding.
If upload storage is outside the copy, record the affected E ids as skipped
with that reason. E05 is skipped when the app does not unpack archives; skips
and inconclusive tries never inflate completed counts.

Family F uses F01 (cut off halfway), F02 (slow headers), F03 (leaves before
reply), F04 (promises more body bytes than it sends), and one distinct id for
each F05 broken-request shape: `F05-garbage`, `F05-bad-header`,
`F05-huge-header`, `F05-two-lengths`. Use the exact `F05-<kind>` suffix rule;
do not merge four logical tries under a duplicate F05 id. Keep the same
Tried/Saw/Where/Advice contract and actual relative `file:line`. Record the
fixed kind, chosen bounds, sent/total bytes, app reaction, during/after probe
results and any verified storage effect. Describe incomplete evidence honestly.
`still open at our limit` alone is never a finding; SMALL F02/F04 evidence needs
confirmed disabled app time limits in the copy's code. Keep a shared F02/F04
cause clear using the same real source location when appropriate, as with
D01/D04. The normal before/after `send` safe control is never a finding when it
works. Stop on an observed outage; never repeat it just to fill a report.

Family G uses G01 (logout reuse), G02 (forged login), G03 (guessable values),
G04 (no lifetime), G05 (old session after password change), G06 (unsafe cookie
or query-string login), and G07 (user-revealing login errors). Keep the same
relative file:line and Tried/Saw/Where/Advice contract. Unknown lifetimes and
cut headers are inconclusive; skip missing routes with a reason. Secure needs
production-code evidence, never a localhost HTTP inference; timing is outside G07.
The before/after correct-login control is blocked when it works.

Login values have a stricter rule than general secrets: no characters at all,
only name, length, flags and patterns. Never save a bearer, cookie or sampled
value in findings, including skipped or inconclusive text or project labels. The
guard refuses known in-memory values and values matching the run's salted
fingerprints from jar cookies, explicitly kept bearers or sessions samples,
retained in the cleanup receipt without raw samples.
It refuses the report without printing that value or consuming the receipt.
Never work around this by encoding a value. No pattern found is not proof of
randomness, and rough strength is an upper bound, not an entropy measurement.

Every finding needs a nonempty id, title, **Tried**, **Saw**, **Where**, **Advice**
and a severity of **CRITICAL** or **SMALL**. Report rejects missing evidence rather
than filling it in. State the observed effect and test boundary without private
values. The counts are nonnegative whole numbers: tried = blocked + gotThrough.
At least one completed logical try is required; a zero-try report is refused.
Each got-through logical try has one finding; findings.length = gotThrough.
The optional `skipped` list records inapplicable or unrun tries as `{ "id": "A07",
"reason": "No create or update route to submit twice" }`. The optional
`inconclusive` list records attempted tries that need more evidence as
`{ "id": "T04", "reason": "The response was incomplete" }`. Both fields in each
entry must be nonempty, single-line strings. Ids must be unique within each list
and across `findings`, `skipped` and `inconclusive`. Absent or empty lists are
valid. Skipped and inconclusive tries do not change any attack count and are
never counted as blocked.

A whole secret is never saved in findings JSON, even temporarily. Use first
3 characters + `…` + last 4 and its length, for example `sk-…a91f (51 chars)`;
values of 8 characters or fewer use `•••• (N chars)`. Describe sensitive response
fields without their values. The shared [pattern list](leak-patterns.md) guards
all finding, skipped and inconclusive text; a matching unmasked value is refused
with `Refused: finding <id> contains an unmasked secret; use the masked form.`
Fix the evidence by using its masked form before retrying; a refused report must
not emit secret-bearing evidence or consume its cleanup receipt.

## Output shape

```text
BREAK-IT REPORT shop-app · version 0.7.0
Seal: real project unchanged
Attacks: 2 tried   1 blocked   1 got through

CRITICAL  Other people's orders are open
  Tried  Logged in as user A and opened user B's local test order
  Saw    The response contained B's invented order details
  Where  server.mjs:42
  Advice Show an order only to the user who owns it

Skipped (not counted)
  A07    No create or update route to submit twice

Inconclusive (not counted)
  T04    The response was incomplete

Copy deleted. Nothing left behind. Break-it changed no code.
```

CRITICAL findings precede SMALL findings. The labels occupy six characters, with
one separating space, so every value begins at the same column. The footer is
emitted only after cleanup succeeded and report removed its receipt. The report
is a record of the tries completed, never a claim that all possible holes have
been ruled out.

When two or more findings share a `Where` file and line, report adds one line
per shared location after all findings. It ignores any ` -> anchor text` when
grouping, but keeps every finding, its original evidence and all counts. One
blank line separates the first `Same cause` line from the findings:

```text
Same cause: A01, A03, A08 point to server.mjs:57; one fix may close all three.
```

No shared location means no `Same cause` line. This is a possible common repair,
not proof that the observations have identical root causes. If `skipped` is
present, its `Skipped (not counted)` block follows the findings and any same-cause
lines, before the footer; an empty list produces just that block's heading. A
nonempty `inconclusive` list adds `Inconclusive (not counted)` after the skipped
section and before the footer. An omitted or empty inconclusive list adds no
heading, preserving the established output.

## After the builder's fix

Use a fresh copy and the same tries, including safe controls. Set `round` to 2;
do not relabel the old run. For a clean retest, output has this shape:

```text
ROUND 2 shop-app
Seal: real project unchanged
Attacks: 2 tried   2 blocked   0 got through
Critical holes: 0   ->   Ready for the owner's look

Copy deleted. Nothing left behind. Break-it changed no code.
```

Any remaining findings retain Tried/Saw/Where/Advice and their real severity and
still produce `Holes remain; send advice to the builder`. With zero findings and
one or more inconclusive entries, the result line is instead:

```text
Critical holes: 0   ->   Incomplete evidence; inconclusive tries need more evidence
```

Readiness requires no remaining findings, including SMALL ones, and no
inconclusive entries. Give the report to the reviewer's **Break-tries** notes.
Only the owner decides Accept or Reject.
