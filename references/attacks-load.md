# Family D: Load (many users at once)

Check whether the owner's own app survives many users at once, safely, on a
throwaway localhost copy. This is a bounded resilience check, not performance
benchmarking or a live load test. Read the intended route behavior first and use
only disposable local data, invented users and local sessions.

Start the app only from the copy folder. First use one `send` to establish that
the route answers, then use `load` against that copy's localhost port. Start at
the small end, such as 20 requests with concurrency 2; do not escalate after an
outage. Hard ceilings are 2,000 burst requests, concurrency 50 and duration 30
seconds; the 30-second stop also applies without `--duration`. Out-of-range and
malformed options are refused. Each request keeps `send`'s 5-second deadline,
localhost URL check and no-redirect/no-retry rules. The final health probe makes
one additional request to the same route after the burst, with its own deadline
of at most 5 seconds. In-flight burst requests are cancelled at the duration cap;
the probe runs afterward, outside that burst cap and request budget.

```text
node scripts/break-it.mjs send GET http://localhost:4000/health
node scripts/break-it.mjs load GET http://localhost:4000/health --requests 20 --concurrency 2 --duration 1
```

Use `--json` and `--token` for a disposable request body/session when applicable;
the same body and bearer are reused for every request, including the probe. The
whole UTF-8 body must fit within 64 KiB. `load` prints only counts, status totals,
latency for completed requests and the after-burst result. It prints no response
bodies, starts no app, edits no file and saves no output. Observe the app you
started too; a timeout alone is inconclusive until its cause is established.

Count each logical try once, including safe controls. Record findings with the
Dxx id, Tried, Saw, Where and Advice; Where is a real relative `file:line` in the
copy. Describe the bounds, summary and recovery observation without private data.
If D01 and D04 share a cause, keep their connection clear rather than inventing
two causes. Stop on a crash/outage and keep cleanup/seal steps unchanged.

## D01: Crash under load

- **Send:** A small `load` burst to an ordinary route that answered the baseline
  `send`, using the copy's port and harmless local data.
- **BLOCKED:** The app stays responsive, rejects excess work cleanly if needed,
  and answers its after-burst probe.
- **HOLE:** The bounded burst makes the app exit or stop responding: the
  after-burst probe fails or a wave of `other/none` accompanies an observed app
  outage. Establish that the burst caused the failure; do not call an unrelated
  connection error a crash.
- **Severity:** CRITICAL for the observed whole-app exit or outage.

## D02: No limit on a sensitive route

- **Send:** One small, fast `load` burst to a costly or authentication route,
  such as login with invented credentials. Reuse only disposable local data.
- **BLOCKED:** Excess attempts are throttled, rate-limited or locked out while
  the app remains healthy; record the actual behavior.
- **HOLE:** The sensitive route accepts the entire fast burst without any limit
  (all 2xx or consistent authentication responses), and inspection confirms no
  throttle, rate limit or lockout. Ordinary success on a cheap public route is
  not this hole. Consistent status codes alone cannot prove an absent limit.
- **Severity:** SMALL. Note that unlimited login attempts enable brute-force
  guessing; the builder decides the appropriate fix.

## D03: Errors only under load

- **Send:** After a successful single `send`, one bounded `load` burst to the
  same route with the same body and disposable bearer, if needed.
- **BLOCKED:** Expected replies or clean overload rejection, no unexpected 5xx,
  and the after-burst probe answers.
- **HOLE:** Concurrency triggers 5xx or internal failures absent from the single
  request, for example a shared-state race or exhausted connection pool/handle.
  Locate the cause in the copy; a failed request without an established cause
  may remain inconclusive. If a 5xx body leaks internal details, cross-reference
  C04 using a separate `send`; `load` never displays bodies.
- **Severity:** SMALL for request-only errors; use D01/D04 for an observed
  whole-app crash or failure to recover.

## D04: Does not recover

- **Send:** Observe the one final health probe from the bounded burst, comparing
  it with the baseline `send` that answered before the burst. Do not send a
  second damaging burst merely to check recovery.
- **BLOCKED:** The after-burst probe has a status and the app is responsive again,
  including when it cleanly limited excess work during the burst.
- **HOLE:** The app answered before the burst, but afterward the final probe
  cannot obtain a status and observation confirms the app has not recovered
  from that burst. An error status is still an answer; inspect it under D03.
- **Severity:** CRITICAL for the established failure to recover.

## Safe control: A normal route absorbs the burst

- **Send:** One small bounded `load` burst to a plain normal route expected to
  succeed under these conditions, with an answering baseline `send`.
- **BLOCKED:** The route stays 2xx, has no failed requests or unexpected 5xx, and
  its after-burst probe answers normally.
- **HOLE:** None when that behavior holds. Never report a healthy route merely
  because it accepted many users at once or its latency changed.
- **Severity:** None for the passing control; record it as blocked against the
  attempted failure, not as a finding.
