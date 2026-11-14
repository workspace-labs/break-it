# Shop app answer key

This key belongs to the synthetic teaching harness and its tests. It stays outside
`shop-app/`, so copying that app does not reveal the expected findings. The
harness locates each source line by its anchor rather than a fixed line number.

- `A09` — `server.mjs:129` — anchor `const limited =`. The login retry limit is
  disabled, so 50 sequential wrong passwords never receive a retry-later response.
- `A01` — `server.mjs:242` — anchor `if (!data.text) throw`. Empty text raises an
  exception and returns HTTP 500 for one request. The server survives, so this
  finding is SMALL. The `validateEmpty` switch controls the harness's repair.
- `B01` — `server.mjs:252` — anchor `const requireOwner =`. The regular order route
  does not enforce ownership, so user A can read user B's synthetic order.
- `C01` — `config.mjs:1` — anchor `export const API_KEY =`. The server imports a
  synthetic generic-assignment secret. It starts with `shopkey-EXAMPLE-` and is
  deliberately unlike a real provider credential. Evidence contains only its
  masked form; the harness removes the value in the scratch builder source.
- `C03` — `server.mjs:217` — anchor `if (!omitPrivate) profile.passwordHash`.
  The profile reply includes a synthetic password hash field. This is CRITICAL
  even for the caller's own profile; evidence withholds the value.
- `C04` — `server.mjs:221` — anchor `const hideDetails =`. A failed catalog request
  returns a database error and internal source path. This is SMALL.
- `D01` — `server.mjs:123` — anchor `if (catalogJobs.length > 4) catalogAvailable = false;`.
  `/catalog-refresh` retains shared work after each request. A single request
  answers, but the small concurrent burst exhausts that resource and later
  requests lose their connections without an HTTP status. This is CRITICAL.
- `D02` — `server.mjs:129` — anchor `const limited =`. The same disabled login
  throttle permits the eight concurrent wrong logins to answer consistently
  without any retry-later response. This is SMALL and enables password guessing.
- `D04` — `server.mjs:124` — anchor `if (!catalogAvailable) return req.socket.destroy();`.
  The final probe to `/catalog-refresh` fails after its pre-burst control answered.
  The retained-work state never recovers. This is CRITICAL.

- `E01` — `server.mjs:178` — anchor `const limitUploads =`. An authenticated user
  can upload the generated 20 MiB file without a size refusal. The copy stays
  healthy, so this is SMALL. The scratch repair rejects a body over 1 MiB before
  reading it, with HTTP 413.
- `E03` — `server.mjs:180` — anchor `const safeUploadNames =`. The client name is
  joined directly to the app's `uploads/` folder. The one-level traversal preset
  writes `break-it-escape-<runId>.txt` beside that folder, still inside the copy
  and run. This is CRITICAL. The scratch repair rejects path names.
- `E04` — `server.mjs:204` — anchor `const downloadUploads =`. HTML and SVG files
  are served inline using the extension's MIME type, with no attachment or
  sandboxing policy. The harmless marker only changes the document title. This
  is CRITICAL. The scratch repair adds attachment and sandboxing headers.
- `E07` — `server.mjs:198` — anchor `const privateUploads =`. User B can read a
  generated PNG that user A uploaded. Anonymous reads already require login.
  This is CRITICAL. The scratch repair checks the saved file's owner.
- `E08` — `server.mjs:201` — anchor `try { bytes = await readFile(path.join(uploadsFolder, name)); }`.
  Encoded `..%2Fserver.mjs` and `%2E%2E%2Fserver.mjs` names read the app's own
  source one level above uploads, still inside the copy. This is CRITICAL.
  Evidence reports only the status and file name, never file content. The
  `safeDownloadPaths` scratch repair refuses resolved paths leaving uploads
  before the separate owner check; an owner-check-free test proves this guard
  blocks the read on its own. A benign `..notes.png` basename still works.

The `/safe-orders/6` control checks ownership at `server.mjs:249` and must return
HTTP 403 to user A. It is not a finding. The synthetic users' passwords are
`example-a`, `example-b`, and `example-admin`; none is a real credential.
The `.env.example` control documents `your-key-here` as a placeholder and must
never become a finding. The scanner runs before startup and after the requests.
The plain `/catalog` route at `server.mjs:116` receives eight-request bursts with
concurrency two before and after the catalog-refresh burst. Every response and
its final probe must be HTTP 200; this safe control is never a finding.

Only `scripts/demo-shop.mjs` simulates builder fixes: it changes the `limited`,
`validateEmpty`, `requireOwner`, `omitPrivate`, `hideDetails`,
`releaseCatalogWork`, `limitUploads`, `safeUploadNames`, `downloadUploads`,
`safeDownloadPaths`, `privateUploads`, `keepCompleteUploads`, and
`boundedConnections`, `invalidateLogout`, `unpredictableSessions`, `expireSessions`,
`invalidateOtherSessions`, `protectedCookie`, and `uniformLoginErrors` switches to true,
and empties the config secret in a separate scratch source. It then makes a
fresh sealed copy for round 2. The catalog repair releases each completed job;
the login repair returns HTTP 429 after five wrong attempts. The load bursts
each use eight requests, concurrency two, and the one final health probe. Family D
assertions depend on retained-job counts rather than latency or scheduling.
Family F separately observes short app time limits before our one-second cap. Break-it itself never fixes an app. The thirty-four
logical tries are the original four, C01/C03/C04, the placeholder control,
D01/D02/D04, the catalog load safe control, E01/E03/E04/E07/E08, and the normal-PNG
upload/read-back safe control, plus the eight Family F connections and G01–G07 with the login/session safe control. The network
controls send a complete upload and normal save before the family and a normal
save afterwards; they are setup/control requests, not extra logical tries. Family E uses only files generated
inside the sealed run. Before uploading, the harness resolves the upload folder and checks
it is inside the copy. Both HTML and SVG are fetched for E04. The E03 evidence
lists every `break-it-escape-*` file in the run; cleanup deletes it with the run.
C02 history, C05 logs, and E02/E05/E06 are covered separately by tests.

- `F01` — `server.mjs:179` — anchor `const keepCompleteUploads =`. Upload bytes
  stream into the final file before the request is complete. A cut connection
  leaves a shorter file which GET still serves (SMALL). The complete generated
  100 KiB PNG control is below 1 MiB and is accepted in both rounds. Round 2 keeps
  the prior complete file intact until the new request finishes.
- `F02` — `server.mjs:108` — anchor `const boundedConnections =`. Header and request
  time limits are explicitly 0. The catalog probe still answers during the slow
  headers, but the source-confirmed disabled limits make this SMALL. Our one-second
  cap alone is never evidence. Round 2 uses 350 ms header and 600 ms request limits
  with a 50 ms connections-check interval, so the app closes before our cap.
- `F04` — `server.mjs:108` — anchor `const boundedConnections =`. A ten-byte fragment
  of a longer JSON request also remains open at our one-second cap with the same
  source-confirmed disabled limits (SMALL). F02 and F04 share one configuration
  cause and one repair; the report says so.

`F03` sends a complete `/notes` create then leaves without reading. The copy still
answers and a normal GET shows the note once or not at all. All four F05 kinds
(`F05-garbage`, `F05-bad-header`, `F05-huge-header`, `F05-two-lengths`) are refused
by Node with 4xx or a closed connection; the after probe answers in both rounds.
These five blocked tries prove this family does not turn expected disconnects
or malformed-request refusals into findings. Only the throwaway copy is used.


Family G runs last because logout and password changes alter session state. A09
uses synthetic user B; G03 uses synthetic user A. Login budgets are combined per
user when families share one, and any 429 stops further logins for that user.
The G03 batch is ten sequential logins; no sampled values enter reports. Safe
controls before and after the family prove correct bearer and cookie login still
answer normally, with a fresh correct login after the password change.

- `G01` — `server.mjs:16` — anchor `const invalidateLogout =`. POST /logout returns success but leaves its server session active (CRITICAL). The scratch repair deletes it.
- `G03` — `server.mjs:17` — anchor `const unpredictableSessions =`. Session values count up in steps of ten (CRITICAL). The scratch repair issues randomUUID values. No pattern found in ten samples does not prove randomness.
- `G04` — `server.mjs:18` — anchor `const expireSessions =`. Session lifetime enforcement is disabled and the cookie has no Max-Age or Expires (SMALL). The scratch repair enforces 1800 seconds on the server and adds Max-Age=1800.
- `G05` — `server.mjs:19` — anchor `const invalidateOtherSessions =`. POST /password verifies the current own password but keeps other sessions for that user (SMALL). The scratch repair invalidates those sessions while keeping the current session.
- `G06` — `server.mjs:20` — anchor `const protectedCookie =`. The login cookie lacks HttpOnly and SameSite (SMALL). The scratch repair adds both. Secure is judged from production HTTPS configuration, never from localhost HTTP; this teaching copy has no production deployment. Source confirms credentials are accepted only through bearer or cookie, never address query parameters.
- `G07` — `server.mjs:21` — anchor `const uniformLoginErrors =`. Wrong-password and nonexistent-user replies both use 401 but disclose different messages (SMALL). The scratch repair uses Wrong login for both. Timing differences are out of scope.

G02 is BLOCKED in both rounds: made-up and one-character-changed bearer values
receive HTTP 401. The initial sixteen-digit sequence always ends in zero, so
changing its last character cannot accidentally select another issued session.
The shop does not issue JWTs, so both JWT forge kinds are inapplicable here; local
JWT fixture servers separately prove acceptance and refusal of unsigned/bad-signature
values. No JWT payload is changed. Cookie and bearer carry the same session value.

The regenerated result is **34 tried / 11 blocked / 23 findings** in round 1,
then **34 / 34 / 0** in round 2. The original A–F findings and blocked tries retain
their outcomes; G01/G03/G04/G05/G06/G07 add six findings, while G02 and G-safe are
blocked controls. The report contains only statuses, shape, flags and patterns.
