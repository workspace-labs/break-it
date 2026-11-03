# Shop app answer key

This key belongs to the synthetic teaching harness and its tests. It stays outside
`shop-app/`, so copying that app does not reveal the expected findings. The
harness locates each source line by its anchor rather than a fixed line number.

- `A09` — `server.mjs:33` — anchor `const limited =`. The login retry limit is
  disabled, so 50 sequential wrong passwords never receive a retry-later response.
- `A01` — `server.mjs:70` — anchor `if (!data.text) throw`. Empty text raises an
  exception and returns HTTP 500 for one request. The server survives, so this
  finding is SMALL. The `validateEmpty` switch controls the harness's repair.
- `B01` — `server.mjs:80` — anchor `const requireOwner =`. The regular order route
  does not enforce ownership, so user A can read user B's synthetic order.
- `C01` — `config.mjs:1` — anchor `export const API_KEY =`. The server imports a
  synthetic generic-assignment secret. It starts with `shopkey-EXAMPLE-` and is
  deliberately unlike a real provider credential. Evidence contains only its
  masked form; the harness removes the value in the scratch builder source.
- `C03` — `server.mjs:54` — anchor `if (!omitPrivate) profile.passwordHash`.
  The profile reply includes a synthetic password hash field. This is CRITICAL
  even for the caller's own profile; evidence withholds the value.
- `C04` — `server.mjs:58` — anchor `const hideDetails =`. A failed catalog request
  returns a database error and internal source path. This is SMALL.

The `/safe-orders/6` control checks ownership at `server.mjs:78` and must return
HTTP 403 to user A. It is not a finding. The synthetic users' passwords are
`example-a`, `example-b`, and `example-admin`; none is a real credential.
The `.env.example` control documents `your-key-here` as a placeholder and must
never become a finding. The scanner runs before startup and after the requests.

Only `scripts/demo-shop.mjs` simulates builder fixes: it changes the `limited`,
`validateEmpty`, `requireOwner`, `omitPrivate`, and `hideDetails` switches to true,
and empties the config secret in a separate scratch source. It then makes a
fresh sealed copy for round 2. Break-it itself never fixes an app. The eight
logical tries are the original four, C01/C03/C04, and the placeholder control;
C02 history and C05 log cases are covered separately by tests.
