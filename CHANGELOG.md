# Changelog

## [0.1.0] - 2026-11-03

- First reviewer-only release of the four-part safety shell: check a local folder,
  copy it, compare SHA-256 file seals, clean one run and write an evidence report.
- Add bounded bad-user/crash and other-people's-data try lists, a synthetic shop
  with three planted holes, and reproducible before/after reports.
- Keep the owner's approved documents unchanged. No dependencies or installation.
- Fix round 1: seal symbolic links by their distinct link text and preserve safe
  relative links in copies; skipped folders remain sealed without copying links.
- Keep cleanup receipts in guarded temporary files, read them by run id, and
  delete them after a successful report instead of printing large receipt bodies.
- Refuse zero-try reports and align Tried/Saw/Where/Advice value columns.
