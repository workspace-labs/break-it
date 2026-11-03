# Shop app answer key

This key belongs to the synthetic teaching harness and its tests. It stays outside
`shop-app/`, so copying that app does not reveal the expected findings. The
harness locates each source line by its anchor rather than a fixed line number.

- `A09` — `server.mjs:32` — anchor `const limited =`. The login retry limit is
  disabled, so 50 sequential wrong passwords never receive a retry-later response.
- `A01` — `server.mjs:55` — anchor `if (!data.text) throw`. Empty text raises an
  exception and returns HTTP 500 for one request. The server survives, so this
  finding is SMALL. The `validateEmpty` switch controls the harness's repair.
- `B01` — `server.mjs:65` — anchor `const requireOwner =`. The regular order route
  does not enforce ownership, so user A can read user B's synthetic order.

The `/safe-orders/6` control checks ownership at `server.mjs:63` and must return
HTTP 403 to user A. It is not a finding. The synthetic users' passwords are
`example-a`, `example-b`, and `example-admin`; none is a real credential.

Only `scripts/demo-shop.mjs` simulates builder fixes: it changes the `limited`,
`validateEmpty`, and `requireOwner` switches to true in a separate scratch source,
then makes a fresh sealed copy for round 2. Break-it itself never fixes an app.
