# Changelog

## [0.4.2] - 2026-11-10

### Fixed

- Recognize explicit plural credential words and compound pairs in the shared
  name rule, so plural scalar fields and nested parents reach the existing
  detection, masking and report guard without a second name list.
- Document and pin the tokenizer `tokens` array false-positive limit while
  preserving scalar-array masking and the nested confirmed/by-eye rules.
- Update the report banner and regenerate the example report for 0.4.2.

## [0.4.1] - 2026-11-10

### Fixed

- Find string values nested beneath credential names, even when their own keys
  are not sensitive. Stop at the parent's matching close brace or bracket,
  respect quoted strings, and bound depth and repeated scanning.
- Separate settings-like inner keys into a masked “Check by eye” list, so a
  possible secret under a metadata key cannot produce a false `No secrets found`.
  Redaction masks those values too; the existing confirmed-hit exit codes stay unchanged.
- Fix round 1: default eligible nested values to masked by-eye evidence. Confirm
  only exact value-like keys, existing sensitive names or bare array elements
  without their own key; arrays beneath object fields keep that field's rule.
  This prevents confirmed false alarms on ordinary auth settings without hiding
  possible secrets under keys such as `pass` or `argon`. Remove metadata-list
  classification while preserving the existing filters, walk and timing limits.
- Correct the report banner to 0.4.1 and regenerate the example report. Document
  the classification limit and add confirm/by-eye regression evidence.

## [0.4.0] - 2026-11-07

- Add Family D, Load: check whether an owner's throwaway localhost copy survives
  many users at once and recovers afterward, with safe controls and report-only advice.
- Add `load` through the existing `send` network boundary: at most 2,000 burst
  requests, 50 in flight, and 30 seconds (also the default hard stop). Cancel
  in-flight burst requests at the deadline, then make one final recovery probe
  with its own five-second deadline. Each burst request retains that deadline too.
- Print only bounded counts, status groups, completed-request latency statistics
  and the recovery result; never print response bodies. Refuse malformed options
  and reuse send's localhost, method, token-header and 64 KiB body validation.
- Extend the synthetic shop and real two-round demo with load failures and an
  unthrottled login, then simulate their fixes only in scratch source. Keep the
  normal catalog route as a safe control in both rounds.
- Preserve the existing copy, seal, cleanup, masking and reporting contracts,
  the one-network-module wall, and the approved documents under docs/ unchanged.
- Fix round 1 (2026-11-07): distinguish the tool's duration cancellations from
  genuine transport failures and send's five-second request timeouts; show
  `cancelled at deadline` separately so our cap cannot look like an app fault.
- Fix round 1 (2026-11-07): give redirects their own 3xx status group, separate
  other received statuses from `no status` failures, and exclude cancellations
  from status totals. Update the four-line summary, guidance and regression
  tests. Version remains 0.4.0; all caps and the send-only boundary are unchanged.

## [0.3.1] - 2026-11-04

- Fix nested object credentials being consumed as outer assignment fragments, so
  scan, history masking, CLI replies and the report guard inspect inner fields.
- Escape control characters and mask candidate secrets in seal/copy diagnostic
  filenames, preventing forged status lines and terminal control sequences.
- Add regression tests and record baseline, failing reproductions, fixed results
  and local workflow evidence in TEST-EVIDENCE.md.

## [0.3.0] - 2026-11-03

- Add TEST-EVIDENCE.md: every round of 0.1.0, 0.2.0 and 0.3.0, with tests, break-tries
  and verdicts.
- Add Family C: secrets in copy-local files and git history, over-sharing replies,
  detailed errors, and passwords/tokens or personal data retained in local logs.
- Add bounded, dependency-free `scan` and stdin `mask` commands with a shared
  documented pattern list, placeholder controls and masked output only.
- Refuse matching unmasked secrets in report evidence and skipped text; separate
  the first same-cause note from findings with a blank line.
- Mask detected CLI reply credentials, including short named values, while
  preserving the response cap; attach historical hunk line numbers to git hits.
- Extend the synthetic shop and real two-round demo with file, reply and error
  leaks, keeping the answer key outside the app and the placeholder unflagged.
- Preserve reviewer-only use, the copy/localhost walls and approved docs unchanged.
- Fix round 1 (2026-11-04): recognize unquoted credentials and sensitive words
  inside prefixed, separated or camelCase names across scan, history masking and
  the report guard; ignore secret-reading expressions and placeholder references.
- Fix round 1 (2026-11-04): scan eligible text files through 20 MiB in 1 MiB
  windows with 4 KiB overlap, deduplicating boundary hits and retaining real line
  numbers; name files above the cap or with an unfinished candidate beyond the
  retained boundary overlap as skipped. Version remains 0.3.0.
- Fix round 2 (2026-11-04): bound generic field names to 128 characters and
  require a name boundary before each candidate, preventing repeated suffix
  matching on long single-line bundles. Avoid rescanning consumed values,
  repeated ignored reads, failed quoted lines and long punctuation tails; keep
  placeholder checks fast and inspect JWT segments without repeated suffix
  retries while preserving supported secret shapes and masking.
- Fix round 2 (2026-11-04): ignore unquoted plain dotted variable references;
  compact object closing braces do not turn those reads into a finding.
  Digit-bearing values and quoted literals retain their existing treatment.
  Version remains 0.3.0.

## [0.2.0] - 2026-11-03

- T1: Add optional skipped-try ids and reasons to findings JSON and reports,
  without changing completed-try counts.
- T2: Connect findings at the same file and line with a same-cause note, ignoring
  anchor text while preserving every finding and count.
- T3: Remove answer comments and try ids from the synthetic shop source; keep
  the answer key outside the app and regenerate the real two-round report.
- T4: Add a one-request localhost-only `send` command with a 5-second deadline,
  no redirects or retries, a 64 KiB body cap and a 2 KiB response display cap.
  Require it for reviewer tries and controls. No new attack family is added.
- Preserve the approved documents under docs/ unchanged.

## [0.1.0] - 2026-11-03

- First reviewer-only release of the four-part safety shell: check a local folder,
  copy it, compare SHA-256 file seals, clean one run and write an evidence report.
- Add bounded bad-user/crash and other-people's-data try lists, a synthetic shop
  with three planted holes, and reproducible before/after reports.
- Keep the owner's approved documents unchanged. No dependencies or installation.
- Add the README hero picture (media/break-it-hero.png); README now says Windows is not
  tested yet.
- Fix round 1: seal symbolic links by their distinct link text and preserve safe
  relative links in copies; skipped folders remain sealed without copying links.
- Keep cleanup receipts in guarded temporary files, read them by run id, and
  delete them after a successful report instead of printing large receipt bodies.
- Refuse zero-try reports and align Tried/Saw/Where/Advice value columns.
- Fix round 2: suggest --skip when an absolute or escaping link is inside a
  skippable folder, while keeping the refusal and containment checks intact.
- Remove the receipts folder non-recursively after its final receipt is deleted;
  leave other runs, nonempty or busy folders, and the temporary base alone.
