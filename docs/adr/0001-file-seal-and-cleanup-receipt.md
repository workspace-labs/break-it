# ADR 0001: file/link seals and a temporary cleanup receipt

Date: 2026-11-03 · Status: revised by approved fix round 1

The workflow must delete the run before reporting; a later report command still
needs the original seal. Its receipt must remain available without asking an
agent to carry a manifest-sized output line.

Hash each regular file with SHA-256, indexed by relative path in seal.json.
Always include all real files, independent of copy exclusions. Fingerprint
before copying and verify after copying to detect ordinary concurrent changes.
Record each symbolic link as `{type: 'symlink', text: <readlink text>}` instead of
a file hash; never follow it while sealing. Recreate only links with the same
relative text whose targets resolve inside the project. Refuse absolute,
escaping or unresolvable copied links and special files. Skipped directories,
including all their links, are sealed but not copied or checked for copy eligibility.

Cleanup independently verifies the seal and removes its validated run folder.
On success it stores the JSON receipt under the guarded temporary base at
`receipts/<run-id>.json`, outside the run, and prints only the path. Report finds
the receipt by run id, requires an absent run and at least one completed logical
try, rechecks the source, then deletes the receipt after successful validation.
Failed reports retain it so corrected findings can be retried. On seal failure,
cleanup still removes its own copy, exits 3 and issues no success receipt.
If a report is abandoned after the run is gone, cleanup with that run id can
discard only its guarded pending receipt.

This keeps the five commands and the approved ordering with a bounded temporary
receipt lifecycle and no dependencies. The receipt can be large but is never
printed or inserted into findings. It is not authenticated against the caller:
a caller able to falsify it can also alter seal.json. Only an empty shared
receipts directory may remain after a successful report.

The original build used a caller-held base64url receipt to avoid retaining run
metadata. Review F2 showed that output grows beyond what agents can carry. The
owner's fix round replaces that decision with a guarded receipt file consumed
by report. Rendering before cleanup still contradicts the approved workflow.
This is file-content integrity, not a transactional filesystem snapshot or an
OS security boundary. Empty folders, file modes and timestamps are not sealed.
