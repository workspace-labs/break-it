# ADR 0001: byte seals and a caller-held cleanup receipt

Date: 2026-11-03 · Status: chosen within the approved build brief

The workflow must delete the run before reporting; a later report command still
needs the original seal. Keeping hidden metadata would contradict no trace.

Hash each regular file with SHA-256, indexed by relative path in seal.json.
Always include all real files, independent of copy exclusions. Fingerprint
before copying and verify after copying to detect ordinary concurrent changes.
Reject symbolic links and special files so the copy has no filesystem aliases.

Cleanup independently verifies the seal and removes its validated run folder.
On success it emits a base64url JSON receipt carrying that manifest. The caller
keeps it in the findings artifact. A report needs that receipt, an absent run,
and a fresh successful comparison against the real source. On seal failure,
cleanup still removes its own copy, exits 3 and issues no success receipt.

This keeps the five commands and the approved ordering without a persistent
receipt store or dependencies. The receipt can be large; it belongs only in
the local findings file, not in the final human report. It is not authenticated
against the caller: a caller able to falsify it can also alter seal.json.

Alternatives considered: keep a receipt directory (leaves run state behind),
or render before cleanup (contradicts workflow). Neither was selected.
This is file-content integrity, not a transactional filesystem snapshot or an
OS security boundary. Empty folders, file modes and timestamps are not sealed.
