---
name: break-it
description: "Use when an independent reviewer asks to break, attack, or stress-test their own project before release, on a throwaway localhost copy. Tests bad input, access control, bad file uploads, resilience under bounded load, bad network connections, and leaks: secrets in files/history, over-sharing replies, error details and logs. Reports holes. Never for the builder testing their own delivery, live sites, other people's systems, code fixes or performance benchmarking."
---

# Break-it 0.6.0

Find holes in the owner's own project before release. Only the independent reviewer
(scanner) uses this skill. It reports evidence in plain words; it never fixes code.

Read [the safety walls](references/safety-walls.md) before starting. Use Node 18+
and its standard library only. Run CLI commands from this skill's folder; resolve
the app's working folder separately. Do not install tools or dependencies.

## Part 1: Start safely

1. Confirm from the owner's request that the project belongs to them and that you
   did not build the code being reviewed. If either is unclear, stop and ask.
2. Check the project and proposed local URL:

   ```text
   node scripts/break-it.mjs check <owned-project> --url http://localhost:4000
   node scripts/break-it.mjs copy <owned-project>
   ```

   These commands only inspect and copy the source. Never start, attack, or edit
   the real project. Keep the printed run id. The copy is at
   `path.join(os.tmpdir(), 'break-it', runId, 'copy')`; obtain the OS temp directory
   through Node, never assume a platform-specific path.
3. Copy includes all files by default. Use `node scripts/break-it.mjs copy <owned-project> --skip` only when
   the owner chooses to omit dependency/build folders. The seal still covers every
   real file and records each symbolic link's text without following it. The copy
   recreates a link with the same relative text only if its resolved target stays
   inside the project. Absolute, escaping, and unresolvable links are refused by
   name; special files are also refused. Links inside skipped folders are sealed
   but never copied or validated for copying. If Windows cannot create a link,
   the refusal explains its permissions/Developer Mode requirement and suggests
   `--skip`. Stop on a refusal; do not bypass it or copy the link's target instead.

## Part 2: Attack the copy

1. Read what the delivered change was meant to do, from the card or the owner's
   words. Read [bad user & crashes](references/attacks-bad-user.md),
   [other people's data](references/attacks-other-data.md),
   [leaks](references/attacks-leaks.md),
   [load: many users at once](references/attacks-load.md),
   [bad files: uploads](references/attacks-files.md), and
   [bad network connections](references/attacks-network.md). Pick applicable tries;
   record each inapplicable try in the optional findings JSON `skipped` list,
   for example `{"id":"A07","reason":"No create or update route to submit twice"}`.
   Use unique ids that do not also appear in findings. Skips never change counts.
2. Before startup, run `node scripts/break-it.mjs scan <run-id>` on the copy.
   Read [the pattern list and limits](references/leak-patterns.md); a clean result
   means only those patterns were not found in the files inspected. Record size
   skips and other incomplete coverage. Check history through C02's direct
   `git log` → `mask` pipe; never display or save raw history or secret-bearing
   source lines. Missing git or a copy without `.git` is a skipped C02 with a reason.
   Read every masked “Check by eye” list too; settings-like inner keys can still hold real secrets.
   Inspect the copy's startup code and configuration through secret-safe views.
   Use isolated local test data and disposable users A, B, and a normal user. Disable every
   external integration through existing local test settings. Do not use production
   accounts or shared data. If local-only operation cannot be established, stop.
3. Start the app **only from the copy folder**, bound to a free localhost port.
   Use its documented offline test launch. Every request must target that copy's
   localhost port; do not follow redirects or contact other services. Keep the
   process handle so you stop only the app you started.
   Use `send` for ordinary per-request tries and control requests:

   ```text
   node scripts/break-it.mjs send POST http://localhost:4000/login --json '{"user":"A","password":"invented"}'
   node scripts/break-it.mjs send GET http://localhost:4000/orders/6 --token LOCAL_TEST_SESSION
   ```

4. Try one case at a time, using one `send` command per request and the bounded
   cases from the references. `send` makes one local-only request with a 5-second
   deadline, no redirects or retries, a 64 KiB request-body cap, and a 2 KiB
   response-body display cap with `(cut)` when truncated. Detected secret values
   are masked before CLI display. Include JSON envelope
   bytes in the request limit. A cut response or timeout may leave a try
   inconclusive; never invent evidence from the unseen part of a response.
   Observe the response and whether the app stays healthy. Count each completed
   logical try as blocked or got through. Expected valid input is blocked against
   the attempted failure when it behaves correctly; ordinary success is not a hole.
   After the per-request tries, use `load` for applicable Family D bursts against
   the same copy's localhost port. First establish with `send` that the route
   answers. Start small; a burst is one logical try, not one try per request:

   ```text
   node scripts/break-it.mjs load GET http://localhost:4000/health --requests 20 --concurrency 2 --duration 1
   ```

   A `cancelled at deadline` count is break-it's own limit and is NEVER evidence
   of a hole; if you need those requests to finish, raise `--duration` (up to 30)
   and run again.

   `load` reuses `send` and prints four bounded lines with requests sent,
   completed, failed and cancelled-at-deadline counts; status totals for 2xx,
   3xx, 4xx, 5xx, other and no status; completed-request latency; and one final
   after-burst health probe, never response bodies. All fields appear, including
   zeros. Cancelled requests are excluded from every status total; no status
   counts only genuine failures, including `send`'s own 5-second timeout. The
   burst stops at the request budget or duration limit, whichever comes first.
   Hard ceilings are 2,000 burst requests, 50 in flight and 30 seconds, including
   an implicit 30-second stop when `--duration` is omitted. Defaults are 200
   requests and 10 in flight. In-flight burst requests are cancelled at the
   duration cap; each also retains `send`'s 5-second deadline. The single final
   health probe is additional to the burst request budget and runs afterward
   with its own deadline of at most 5 seconds.
   Observe the summary and whether the app still answers. A healthy normal route
   absorbing a burst is a safe control, never a hole. Stop on an observed outage;
   do not repeat damaging bursts or use this as a performance benchmark.

   For Family E, first find the copy's actual upload storage and any extraction
   folder, resolving configuration and links. If either is outside the copy
   (an outside absolute path, cloud bucket or shared folder), STOP the family and
   record the affected E ids as skipped with a reason. Never let these tries
   write outside the copy. Make every test file through the fixed built-in list;
   never download, hand-build or supply your own file:

   ```text
   node scripts/break-it.mjs make <run-id> normal-png
   node scripts/break-it.mjs upload <run-id> POST http://localhost:4000/upload --file normal.png --token LOCAL_TEST_SESSION
   node scripts/break-it.mjs send GET http://localhost:4000/uploads/normal.png --token LOCAL_TEST_SESSION
   ```

   `make` writes only inside the run's `files/`. `big` defaults to 20 MiB, accepts
   `--mb N` up to 50 MiB and is streamed. The fixed `zip-bomb` has one 100 MiB
   zeros entry, stays under 1 MiB compressed, and is never nested; skip E05 if
   the app does not unpack archives. `upload` accepts POST or PUT and one bare
   made filename, never a path or symlink substitute. Its multipart body is
   capped at 51 MiB; it retains localhost/literal-loopback, no-redirect/no-retry,
   2 KiB masked reply and a 5-second deadline, extended to 30 seconds only for
   `big` and stated in its output. Use the fixed `--name` presets from the
   reference, never free text; `--field` and `--type` set the part field and
   claimed content type. The only script payload changes the document title.
   For E04 and E07, use `send GET` on the returned localhost address. E04 needs
   `--headers` to inspect the bounded Content-Type, Content-Disposition and
   Content-Security-Policy headers. A cut header block is incomplete evidence.
   For E08, use `send GET` with `..%2F<file>` and `%2E%2E%2F<file>` on the
   download address, choosing only a known harmless file exactly one level above
   the upload folder and inside the copy. The same storage STOP rule applies;
   never aim outside the copy or request system files. Record only the status
   and file name in the finding, never returned file content.
   Check both owner and other-user reads and
   keep the valid-image control unflagged. After the tries, list any
   `break-it-escape-*` files inside the copy or its run folder as E03 evidence.
   Stop on an observed crash or outage. Cleanup removes `files/` with the run.

   After Family E and before the C05 scan, use `net` for applicable Family F
   user-side bad connections. First prove a normal `send` to the same route
   answers. One command is one logical try and opens one bad connection only;
   fixed shapes have no raw-byte, repeat or concurrency option. Both URLs must
   use `http://` and the copy's same host and port. `--probe` is required and
   always makes a GET health check through `send`, during `slow`/`short` while
   the connection is held and after every kind:

   ```text
   node scripts/break-it.mjs make <run-id> medium-png
   node scripts/break-it.mjs upload <run-id> POST http://localhost:4000/upload --file medium.png --token LOCAL_TEST_SESSION
   node scripts/break-it.mjs net <run-id> cut POST http://localhost:4000/upload --probe http://localhost:4000/health --file medium.png --token LOCAL_TEST_SESSION
   node scripts/break-it.mjs net <run-id> slow GET http://localhost:4000/items --probe http://localhost:4000/health --seconds 2
   node scripts/break-it.mjs net <run-id> leave POST http://localhost:4000/items --probe http://localhost:4000/health --json '{"text":"local control"}'
   node scripts/break-it.mjs net <run-id> short POST http://localhost:4000/items --probe http://localhost:4000/health --json '{"text":"local control"}' --seconds 2
   node scripts/break-it.mjs net <run-id> garbage GET http://localhost:4000/items --probe http://localhost:4000/health
   node scripts/break-it.mjs net <run-id> bad-header GET http://localhost:4000/items --probe http://localhost:4000/health
   node scripts/break-it.mjs net <run-id> huge-header GET http://localhost:4000/items --probe http://localhost:4000/health
   node scripts/break-it.mjs net <run-id> two-lengths POST http://localhost:4000/items --probe http://localhost:4000/health
   ```

   `cut` sends exactly half the body rounded down, then closes. Use a made file
   already accepted when uploaded completely, with storage inside the copy;
   the harmless 100 KiB `medium-png` ensures the cut reaches file content.
   `slow` drips request line/headers one byte per 500 ms; `leave` sends the
   complete request and closes without reading; `short` requires more than
   10 JSON bytes and sends exactly 10 before going silent. The four F05 shapes
   take neither body option. JSON is capped at 64 KiB; only `cut` accepts a bare
   made `--file` using upload's multipart builder and 51 MiB cap. `--token`
   has send's validation. Only `slow`/`short` accept `--seconds` (1–30, default
   10). All kinds stop within 30 seconds plus the final probe's own five
   seconds; F05 waits at most five seconds. No socket stays open on return.
   Output always names sent/total bytes, elapsed time, who closed, the app's
   reaction and both probe results (`n/a` during other kinds). An app answer
   gets send's masked Status/body block capped at 2 KiB. A stopped during-probe
   is break-it's own limit and never evidence. Its line is
   `probe during: stopped when the try ended after <T> s (not evidence)`; if its
   answer is needed, run again with a larger `--seconds`. Only a genuine probe
   failure says `app did not answer`. Probe failures and app behavior are
   measurements, not refusals. `still open at our limit` is
   break-it's own cap and is NEVER evidence of a hole on its own; default or
   unknown app limits make it inconclusive. Confirm disabled limits in the
   copy's code before a SMALL F02/F04 finding. Stop on a crash/outage, never
   repeat it. Check half-saved/duplicate work through copy-local storage or
   `send`, and run the normal `send` safe control before and after the family.
5. Log each got-through try with its id, severity, title, **Tried, Saw, Where,
   Advice**. Locate the actual line in the copy, expressed as a relative `file:line`.
   Keep evidence outside the run folder so cleanup cannot erase the report input.
   Use invented example data; do not copy private values into findings. A whole
   secret is never printed, saved, or reported: use its first 3 characters + `…`
   + last 4 and its length; values of 8 characters or fewer use `•••• (N chars)`.
   For C03/C04 use `send`; describe private fields without copying their values.
   For an observed Family D failure, use its D01–D04 id and the same
   Tried/Saw/Where/Advice fields with a real `file:line` in the copy; report the
   chosen bounds, status counts and recovery observation. For Family F use
   F01–F04 or F05-<kind>, with fixed shape, bounds, probes and observed outcome;
   use the same real file:line contract and keep a shared F02/F04 cause clear.
   A failed health probe alone does not establish its cause; disclose inconclusive cases honestly.
6. After the tries, run `node scripts/break-it.mjs scan <run-id>` again for C05:
   inspect only logs the app wrote inside the copy, looking for invented passwords
   or tokens sent during this run. Compare before/after masked hits and locations;
   do not treat pre-existing configuration hits as evidence that a request was logged.
   Test the documented placeholder safe control too. Keep all evidence masked.

## Part 3: Check the seal

1. Stop the app you started and confirm it exited. Never stop someone else's app.
2. Run the seal before every report:

   ```text
   node scripts/break-it.mjs seal <run-id>
   ```

   Exit 3 and `REAL PROJECT CHANGED` means stop the run and tell the owner which
   files changed. Do not issue a clean report or claim the seal passed. Cleanup
   may still be used to dispose of the copy; a changed seal cannot produce a report.
3. With an unchanged seal, delete the run through the CLI:

   ```text
   node scripts/break-it.mjs cleanup <run-id>
   ```

   Confirm it says the run is gone. It prints only a short `Receipt file:` path;
   the CLI keeps the receipt under the guarded temporary `break-it/receipts`
   folder, outside the deleted run. Do not read, decode, or carry the receipt
   into findings. Save findings JSON **outside both the real project and run
   folder**, with at least one completed logical try and no `receipt` field.
4. Read [the report format](references/report-format.md), then generate the report:

   ```text
   node scripts/break-it.mjs report <run-id> <findings.json>
   ```

   Report finds the receipt by run id, checks the real fingerprint again, requires
   the run to be gone, and deletes the receipt after successful validation. Only
   then does its footer say nothing is left behind. A failed report keeps the
   receipt so you can correct the findings and retry; never claim that it finished.
   If you abandon that pending report, use cleanup with the same run id to delete
   only its guarded receipt. The CLI attempts non-recursive removal of the empty
   receipts folder; a nonempty or busy folder stays, and the shared base is kept.
   Never fabricate a receipt, seal result, attack count, or observation. If any
   step fails, report the failure plainly and do not claim a completed clean run.

## Part 4: Report and fix

Hand the generated report to the independent reviewer's notes as **Break-tries**.
Recommend what needs fixing and where; the builder fixes it separately. After
the builder's fix, repeat all four parts with a **fresh copy**, retest the original
holes and the safe controls, and report **Round 2** (then further rounds if needed).
No remaining hole means ready for the owner's look, never automatic approval.

Do not edit code in the real project or the attack copy. Do not make any
Backloop/pipeline status move, Commit, Accept, or Reject. The owner controls gates.
This skill never pushes, publishes, or changes the builder's delivery.
