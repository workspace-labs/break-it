---
name: break-it
description: "Use when an independent reviewer asks to break, attack, or stress-test their own project before release, on a throwaway localhost copy. Tests bad input and access control and reports holes. Never for the builder testing their own delivery, live sites, other people's systems, code fixes, or load/performance testing."
---

# Break-it 0.1.0

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
   words. Read [bad user & crashes](references/attacks-bad-user.md) and
   [other people's data](references/attacks-other-data.md). Pick applicable tries;
   record why an inapplicable try was skipped. Skips never count as blocked.
2. Before startup, inspect the copy's startup code and configuration. Use isolated
   local test data and disposable users A, B, and a normal user. Disable every
   external integration through existing local test settings. Do not use production
   accounts or shared data. If local-only operation cannot be established, stop.
3. Start the app **only from the copy folder**, bound to a free localhost port.
   Use its documented offline test launch. Every request must target that copy's
   localhost port; do not follow redirects or contact other services. Keep the
   process handle so you stop only the app you started.
4. Try one case at a time. Use bounded requests and timeouts from the references.
   Observe the response and whether the app stays healthy. Count each completed
   logical try as blocked or got through. Expected valid input is blocked against
   the attempted failure when it behaves correctly; ordinary success is not a hole.
5. Log each got-through try with its id, severity, title, **Tried, Saw, Where,
   Advice**. Locate the actual line in the copy, expressed as a relative `file:line`.
   Keep evidence outside the run folder so cleanup cannot erase the report input.
   Use invented example data; do not copy private values into findings.

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
   only its guarded receipt. Empty shared temporary folders may remain.
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
