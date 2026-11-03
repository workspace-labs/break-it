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
  ]
}
```

`Where` is the actual relative source file and positive line number from the
tested copy; the example line number is illustrative. Do not put an absolute
personal path in a report.

For C02 history, use `<file>:<line> -> commit <7-char hash>` with the actual
historical line. The relative file and positive line keep the existing location
contract; the commit identifies the inspected version. Never paste raw history.

Every finding needs a nonempty id, title, **Tried**, **Saw**, **Where**, **Advice**
and a severity of **CRITICAL** or **SMALL**. Report rejects missing evidence rather
than filling it in. State the observed effect and test boundary without private
values. The counts are nonnegative whole numbers: tried = blocked + gotThrough.
At least one completed logical try is required; a zero-try report is refused.
Each got-through logical try has one finding; findings.length = gotThrough.
The optional `skipped` list records inapplicable tries as `{ "id": "A07",
"reason": "No create or update route to submit twice" }`. Both fields must be
nonempty, single-line strings. Skip ids must be unique and must not also appear
in `findings`. An absent or empty list is valid. Skipped or incomplete tries do
not change any attack count and are never counted as blocked.

A whole secret is never saved in findings JSON, even temporarily. Use first
3 characters + `…` + last 4 and its length, for example `sk-…a91f (51 chars)`;
values of 8 characters or fewer use `•••• (N chars)`. Describe sensitive response
fields without their values. The shared [pattern list](leak-patterns.md) guards
all finding text and skipped text; a matching unmasked value is refused with
`Refused: finding <id> contains an unmasked secret; use the masked form.`
Fix the evidence by using its masked form before retrying; a refused report must
not emit secret-bearing evidence or consume its cleanup receipt.

## Output shape

```text
BREAK-IT REPORT shop-app · version 0.3.1
Seal: real project unchanged
Attacks: 2 tried   1 blocked   1 got through

CRITICAL  Other people's orders are open
  Tried  Logged in as user A and opened user B's local test order
  Saw    The response contained B's invented order details
  Where  server.mjs:42
  Advice Show an order only to the user who owns it

Skipped (not counted)
  A07    No create or update route to submit twice

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
lines, before the footer; an empty list produces just that block's heading.

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

Any remaining findings retain Tried/Saw/Where/Advice and their real severity.
Readiness requires no remaining findings, including SMALL ones. Give the report
to the reviewer's **Break-tries** notes. Only the owner decides Accept or Reject.
