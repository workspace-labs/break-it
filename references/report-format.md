# Report format

Use the CLI's real output. Save findings outside both the source and temporary
run folder. Stop the app, pass `seal`, then run `cleanup` before `report`, in that
order. Cleanup prints `Receipt:` followed by base64url JSON. Decode it through
Node's `Buffer.from(text, 'base64url')`, parse the JSON, and put that object in
`receipt`. Report requires the run folder to be gone and checks the real project
fingerprint again. A changed fingerprint stops reporting.

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
  "receipt": {}
}
```

The empty receipt above is a schema placeholder, never a valid receipt. Use only
the decoded value printed by your own completed cleanup. `Where` is the actual
relative source file and positive line number from the tested copy; the example
line number is illustrative. Do not put an absolute personal path in a report.

Every finding needs a nonempty id, title, **Tried**, **Saw**, **Where**, **Advice**
and a severity of **CRITICAL** or **SMALL**. Report rejects missing evidence rather
than filling it in. State the observed effect and test boundary without private
values. The counts are nonnegative whole numbers: tried = blocked + gotThrough.
Each got-through logical try has one finding; findings.length = gotThrough.
Skipped or incomplete tries are not counted as blocked. A reported hole can be
associated with a previously reported hole in the review notes without losing its
current observation.

## Output shape

```text
BREAK-IT REPORT shop-app · version 0.1.0
Seal: real project unchanged
Attacks: 2 tried   1 blocked   1 got through

CRITICAL  Other people's orders are open
  Tried Logged in as user A and opened user B's local test order
  Saw The response contained B's invented order details
  Where server.mjs:42
  Advice Show an order only to the user who owns it

Copy deleted. Nothing left behind. Break-it changed no code.
```

CRITICAL findings precede SMALL findings. The footer is emitted only after
cleanup has succeeded. The report is a record of the tries completed, never a
claim that all possible holes have been ruled out.

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
