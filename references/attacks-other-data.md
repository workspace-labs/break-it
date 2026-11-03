# Family B: Other people's data

This is broken access control (OWASP A01). Use two invented local users A and B
with separate records and a normal, non-admin role. Authenticate normally as A;
do not assume a header claiming a user name is authentication. Establish that B
owns the test record and that A's own record works before trying the boundary.

Keep all calls on the throwaway copy's localhost port, with a 5-second deadline
and no redirects. Use only record ids created for this test. Do not enumerate ids.
Inspect response content and resulting local state; status codes alone do not
prove a boundary held. A 200 response with no protected content may be safe, while
a 403 response containing B's protected content is a hole.

## B01: Change an id in the URL

- **Send:** As A, open A's order/record, then replace only its URL id with B's
  known test id. For shop-app, use the session obtained by A's normal login.
- **BLOCKED:** The copy refuses access or conceals the record; no B-only data is
  returned and no B record changes. A's permitted record still works.
- **HOLE:** A sees any B-only record content or changes B's record.
- **Severity:** CRITICAL: a customer can access another customer's protected data.
  Locate the line that retrieves/returns the record without checking its owner.

## B02: Change an id in the request body

- **Send:** As A, repeat one harmless disposable local read/update request with
  its body record id or owner id changed to B's known test id.
- **BLOCKED:** The app checks permission independently of the submitted id; B's
  data stays hidden and unchanged. A's allowed operation still works.
- **HOLE:** A reads or modifies B-only data by changing the submitted id.
- **Severity:** CRITICAL. Identify the actual missing permission check in the copy.

## B03: Call an admin route as a normal user

- **Send:** First establish the route exists through source inspection or a
  disposable admin control. Then call that same route using only a normal user's
  authenticated session. Choose a harmless local read or reversible test record.
- **BLOCKED:** No admin-only data or behavior is available to the normal user.
- **HOLE:** Admin-only content is returned or an admin-only action happens.
- **Severity:** CRITICAL. Record the normal-user session and exact observed result.

## Safe control

Repeat B01 against shop-app's safe route. It must refuse B's record while still
serving A's own record. Count that boundary as blocked, never as a finding.
If a later delivery removes its owner check, the same try must become a finding;
never exempt a route merely because its name contains “safe”.

If an applicable route, test account, or owner rule cannot be established, mark
the try incomplete or inapplicable with a reason. Do not count it as blocked and
do not invent evidence. Advice says what permission must hold, not how to rebuild
the app. Break-it never applies the fix.
