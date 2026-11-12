# Shop app answer key

This key belongs to the synthetic teaching harness and its tests. It stays outside
`shop-app/`, so copying that app does not reveal the expected findings. The
harness locates each source line by its anchor rather than a fixed line number.

- `A09` — `server.mjs:75` — anchor `const limited =`. The login retry limit is
  disabled, so 50 sequential wrong passwords never receive a retry-later response.
- `A01` — `server.mjs:142` — anchor `if (!data.text) throw`. Empty text raises an
  exception and returns HTTP 500 for one request. The server survives, so this
  finding is SMALL. The `validateEmpty` switch controls the harness's repair.
- `B01` — `server.mjs:152` — anchor `const requireOwner =`. The regular order route
  does not enforce ownership, so user A can read user B's synthetic order.
- `C01` — `config.mjs:1` — anchor `export const API_KEY =`. The server imports a
  synthetic generic-assignment secret. It starts with `shopkey-EXAMPLE-` and is
  deliberately unlike a real provider credential. Evidence contains only its
  masked form; the harness removes the value in the scratch builder source.
- `C03` — `server.mjs:126` — anchor `if (!omitPrivate) profile.passwordHash`.
  The profile reply includes a synthetic password hash field. This is CRITICAL
  even for the caller's own profile; evidence withholds the value.
- `C04` — `server.mjs:130` — anchor `const hideDetails =`. A failed catalog request
  returns a database error and internal source path. This is SMALL.
- `D01` — `server.mjs:69` — anchor `if (catalogJobs.length > 4) catalogAvailable = false;`.
  `/catalog-refresh` retains shared work after each request. A single request
  answers, but the small concurrent burst exhausts that resource and later
  requests lose their connections without an HTTP status. This is CRITICAL.
- `D02` — `server.mjs:75` — anchor `const limited =`. The same disabled login
  throttle permits the eight concurrent wrong logins to answer consistently
  without any retry-later response. This is SMALL and enables password guessing.
- `D04` — `server.mjs:70` — anchor `if (!catalogAvailable) return req.socket.destroy();`.
  The final probe to `/catalog-refresh` fails after its pre-burst control answered.
  The retained-work state never recovers. This is CRITICAL.

- `E01` — `server.mjs:89` — anchor `const limitUploads =`. An authenticated user
  can upload the generated 20 MiB file without a size refusal. The copy stays
  healthy, so this is SMALL. The scratch repair rejects a body over 1 MiB before
  reading it, with HTTP 413.
- `E03` — `server.mjs:92` — anchor `const safeUploadNames =`. The client name is
  joined directly to the app's `uploads/` folder. The one-level traversal preset
  writes `break-it-escape-<runId>.txt` beside that folder, still inside the copy
  and run. This is CRITICAL. The scratch repair rejects path names.
- `E04` — `server.mjs:113` — anchor `const downloadUploads =`. HTML and SVG files
  are served inline using the extension's MIME type, with no attachment or
  sandboxing policy. The harmless marker only changes the document title. This
  is CRITICAL. The scratch repair adds attachment and sandboxing headers.
- `E07` — `server.mjs:107` — anchor `const privateUploads =`. User B can read a
  generated PNG that user A uploaded. Anonymous reads already require login.
  This is CRITICAL. The scratch repair checks the saved file's owner.
- `E08` — `server.mjs:110` — anchor `try { bytes = await readFile(path.join(uploadsFolder, name)); }`.
  Encoded `..%2Fserver.mjs` and `%2E%2E%2Fserver.mjs` names read the app's own
  source one level above uploads, still inside the copy. This is CRITICAL.
  Evidence reports only the status and file name, never file content. The
  `safeDownloadPaths` scratch repair refuses resolved paths leaving uploads
  before the separate owner check; an owner-check-free test proves this guard
  blocks the read on its own. A benign `..notes.png` basename still works.

The `/safe-orders/6` control checks ownership at `server.mjs:150` and must return
HTTP 403 to user A. It is not a finding. The synthetic users' passwords are
`example-a`, `example-b`, and `example-admin`; none is a real credential.
The `.env.example` control documents `your-key-here` as a placeholder and must
never become a finding. The scanner runs before startup and after the requests.
The plain `/catalog` route at `server.mjs:62` receives eight-request bursts with
concurrency two before and after the catalog-refresh burst. Every response and
its final probe must be HTTP 200; this safe control is never a finding.

Only `scripts/demo-shop.mjs` simulates builder fixes: it changes the `limited`,
`validateEmpty`, `requireOwner`, `omitPrivate`, `hideDetails`,
`releaseCatalogWork`, `limitUploads`, `safeUploadNames`, `downloadUploads`, and
`safeDownloadPaths`, and `privateUploads` switches to true,
and empties the config secret in a separate scratch source. It then makes a
fresh sealed copy for round 2. The catalog repair releases each completed job;
the login repair returns HTTP 429 after five wrong attempts. The load bursts
each use eight requests, concurrency two, and the one final health probe. No
pass/fail assertion depends on latency or scheduling: retained-job counts cause
the catalog failure. Break-it itself never fixes an app. The eighteen
logical tries are the original four, C01/C03/C04, the placeholder control,
D01/D02/D04, the catalog load safe control, E01/E03/E04/E07/E08, and the normal-PNG
upload/read-back safe control. Family E uses only files generated inside the
sealed run. Before uploading, the harness resolves the upload folder and checks
it is inside the copy. Both HTML and SVG are fetched for E04. The E03 evidence
lists every `break-it-escape-*` file in the run; cleanup deletes it with the run.
C02 history, C05 logs, and E02/E05/E06 are covered separately by tests.
