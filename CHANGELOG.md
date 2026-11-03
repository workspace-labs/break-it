# Changelog

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
