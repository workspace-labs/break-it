# Working on Break-it

Read the approved workflow in docs/workflow and docs/scope.md before changes.
Keep the four original approved docs byte-identical. Changes to this skill are
reviewed by another agent: this build's reviewer is Claude.

Use Node 18+ standard library only. No dependency installation, external targets,
publishing or remote operations. The CLI is a safety/reporting shell; the reviewer
chooses bounded tries from the two references. Keep modules small and focused.
Tests run with `node --test`; the example uses throwaway localhost servers.
Only the demo harness simulates builder fixes, in synthetic scratch data; the
skill itself never fixes project code. Never start the original example server
to demonstrate testing: run `node scripts/demo-shop.mjs` instead.
