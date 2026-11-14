# Family F: Bad network connections (user side)

## Contents

- [F01: Cut off halfway](#f01-cut-off-halfway)
- [F02: Sends very slowly](#f02-sends-very-slowly)
- [F03: Leaves before the answer](#f03-leaves-before-the-answer)
- [F04: Promises more than it sends](#f04-promises-more-than-it-sends)
- [F05: Broken requests](#f05-broken-requests)
- [Safe control](#safe-control-normal-requests-before-and-after)

First use one normal `send` to the same route and establish that it answers.
Test only the owner's own throwaway copy, on its localhost port, with invented
local data. One command is one logical try. Stop on an observed crash or outage;
never repeat the damaging try. This family covers the user's connection only.

```text
node scripts/break-it.mjs send POST http://localhost:4000/items --json '{"text":"local control"}'
node scripts/break-it.mjs net <run-id> cut POST http://localhost:4000/items --probe http://localhost:4000/health --json '{"text":"local control"}'
```

`net` requires the existing run id and `--probe URL`, a GET health check on the
same host and port. Both URLs must use `http://`; HTTPS is refused. The eight
fixed kinds are `cut`, `slow`, `leave`, `short`, `garbage`, `bad-header`,
`huge-header` and `two-lengths`. No raw-byte input, repeat loop or concurrency
option is available. Each command opens one bad TCP connection, pinned to a
literal loopback address with no DNS, proxy, TLS, redirects or retries.

Use `--json` for at most 64 KiB of UTF-8 body, including its JSON envelope, or
`--file` with a bare file name made by `make` in this run, only for `cut`.
The file uses upload's existing multipart builder and 51 MiB whole-body cap;
paths, `..`, missing files and symbolic-link substitutes are refused. Before
cutting an upload, establish that the app's resolved storage is inside the copy,
as required for Family E. `--jar` reads matching cookies or a kept bearer from
the run, including on probes, without applying reply cookies. `--token` is
only a fixed test key supplied by the owner, as with `send`.
`garbage`, `bad-header`, `huge-header` and `two-lengths` take neither body option.

Only `slow` and `short` accept `--seconds N`: whole integers 1–30, default 10.
They make one probe while the bad connection is held; every kind makes one
probe afterward. These use `send`'s five-second deadline. Probe failures are
measurements, never command refusals. The bad connection and any during probe
stop within 30 seconds; the final probe gets its own additional five seconds.
Nothing is written to disk or left open when the command returns. An app reply
is displayed through the same masking and 2 KiB body cap as `send`. A running
try exits successfully whatever the app does; only refusals have a nonzero exit.

`still open at our limit` is break-it's own cap and is NEVER evidence of a hole
on its own. For slow or short requests, default or unknown app time limits make
that observation inconclusive. Only confirmed disabled time limits in the copy's
code support the SMALL finding described below. Do not turn our cap into an app
failure. A probe status proves an answer, not necessarily a healthy status;
inspect unexpected error replies and establish their cause before reporting.

Count each completed logical try once and keep incomplete cases honest. Use
F01–F04 or the exact F05 suffix below, with Tried, Saw, Where and Advice; Where
is a real relative `file:line` in the copy. Describe body size, fixed shape,
duration, during/after probes and the observed storage or app behavior. Keep
secrets masked and findings outside the run. If F02 and F04 share a cause, keep
that connection clear rather than inventing two causes, as with D01/D04.

## F01: Cut off halfway

- **Send:** `cut` to an upload or create/save route that answered the baseline.
  Headers declare the true body length, then exactly `floor(body bytes / 2)`
  bytes are sent and the socket is closed. For an upload use a made file the app
  would accept when complete; first confirm its normal upload works. Use the
  harmless 100 KiB `medium-png`: the cut must reach file content, so a tiny
  file whose half-body ends inside the multipart header cannot show half-saved data.

  ```text
  node scripts/break-it.mjs make <run-id> medium-png
  node scripts/break-it.mjs upload <run-id> POST http://localhost:4000/upload --file medium.png --jar <run-id>
  node scripts/break-it.mjs net <run-id> cut POST http://localhost:4000/upload --probe http://localhost:4000/health --file medium.png --jar <run-id>
  ```

- **BLOCKED:** Nothing is half-saved and the app answers the after probe.
- **HOLE:** The app crashes or stops answering; or half the data is kept, listed
  or served as though complete. Check the copy's storage folder or read the
  result back with `send`, without touching anything outside the copy.
- **Severity:** CRITICAL for an observed crash/outage; SMALL for half-saved data.

## F02: Sends very slowly

- **Send:** `slow` to the same route. The request line and headers drip one byte
  every 500 ms, at a fixed rate, until the app answers/closes or the limit ends.

  ```text
  node scripts/break-it.mjs net <run-id> slow GET http://localhost:4000/items --probe http://localhost:4000/health --seconds 2
  ```

  A stopped during-probe is break-it's own limit, never evidence; if its answer
  is needed, run again with a larger `--seconds`.

- **BLOCKED:** The app closes the slow connection, or keeps it while the
  probe-during answers normally.
- **HOLE:** The probe DURING fails or hangs and observation establishes that one
  slow user blocks everyone; or the connection is still open at our limit AND
  reading the copy's code confirms time limits are switched off, for example
  `headersTimeout`, `requestTimeout` or `timeout` set to 0. Still open with
  default or unknown limits is inconclusive, never a finding on its own.
- **Severity:** CRITICAL for the established whole-app outage; SMALL for the
  confirmed disabled-limits case.

## F03: Leaves before the answer

- **Send:** `leave` to a create/save route. Send the complete request, then close
  our side immediately without reading its reply. The app line is exactly
  `app: not observed (we left first)`. Judge the app through the probes and a
  normal `send` readback.

  ```text
  node scripts/break-it.mjs net <run-id> leave POST http://localhost:4000/items --probe http://localhost:4000/health --json '{"text":"local control"}'
  ```

- **BLOCKED:** The app keeps answering; the action happened once or not at all.
- **HOLE:** The app crashes; or the action was applied twice or left half-done.
  Establish the storage/action outcome with a normal `send` afterward.
- **Severity:** CRITICAL for a crash/outage; SMALL for duplicate or half-done work.

## F04: Promises more than it sends

- **Send:** `short` with a `--json` body of more than 10 UTF-8 bytes. Headers
  declare the true body length, exactly the first 10 body bytes are sent, then
  the connection goes silent until the app reacts or the limit ends.

  ```text
  node scripts/break-it.mjs net <run-id> short POST http://localhost:4000/items --probe http://localhost:4000/health --json '{"text":"local control"}' --seconds 2
  ```

  A stopped during-probe is break-it's own limit, never evidence; if its answer
  is needed, run again with a larger `--seconds`.

- **BLOCKED:** The app closes the incomplete connection, or keeps it while the
  probe-during answers normally.
- **HOLE:** The probe DURING fails or hangs and observation establishes that one
  incomplete request blocks everyone; or the connection remains open at our
  limit AND the copy's code confirms its relevant time limits are set to 0.
  Default or unknown limits make an open-at-our-limit result inconclusive.
  Keep a shared F02/F04 cause clear in both findings.
- **Severity:** CRITICAL for the established whole-app outage; SMALL for the
  confirmed disabled-limits case.

## F05: Broken requests

- **Send:** One command for each applicable fixed shape; each is one logical try.
  `garbage` sends 64 fixed non-HTTP bytes; `bad-header` sends a valid request
  line and one header line without a colon; `huge-header` sends one fixed 32 KiB
  header value; `two-lengths` sends conflicting Content-Length headers and a tiny
  body. Wait at most five seconds for a reply. Supply neither `--json` nor `--file`.

  ```text
  node scripts/break-it.mjs net <run-id> garbage GET http://localhost:4000/items --probe http://localhost:4000/health
  node scripts/break-it.mjs net <run-id> bad-header GET http://localhost:4000/items --probe http://localhost:4000/health
  node scripts/break-it.mjs net <run-id> huge-header GET http://localhost:4000/items --probe http://localhost:4000/health
  node scripts/break-it.mjs net <run-id> two-lengths POST http://localhost:4000/items --probe http://localhost:4000/health
  ```

- **BLOCKED:** A 4xx or closed connection, and the after probe answers normally.
- **HOLE:** The app crashes or stops answering; a 5xx exposes internal details
  (cross-reference C04 with a separate `send`); or `two-lengths` is accepted with
  2xx, although servers must refuse conflicting lengths. An arbitrary 5xx or an
  open connection alone does not establish any of these causes.
- **Severity:** CRITICAL for an observed crash/outage; SMALL for internal details
  or conflicting lengths accepted with 2xx. Use the exact ids `F05-garbage`,
  `F05-bad-header`, `F05-huge-header` and `F05-two-lengths` so distinct tries do
  not share an id.

## Safe control: Normal requests before and after

- **Send:** A normal `send` to the same tested route before and after the family,
  with valid local data and the same disposable session when needed.
- **BLOCKED:** Both requests answer normally and the expected action works.
- **HOLE:** None when the behavior holds. Never report an ordinary successful
  request as a bad-connection hole. Stop if an observed outage prevents a safe
  after control; disclose that incomplete observation instead of repeating it.
- **Severity:** None for the passing control; count it as blocked against the
  attempted failure, never as a finding.
