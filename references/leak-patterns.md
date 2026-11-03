# Built-in leak patterns

`scan`, `mask`, and the report guard share a small built-in list. No lists are
downloaded and no candidate is checked against an external provider. Matches are
working-looking candidates, not proof that a credential is live. These checks
run only on the owner's throwaway copy or on text piped from that copy.

## Pattern list

- **private key:** a `-----BEGIN PRIVATE KEY-----` header, optionally with
  uppercase letter/digit labels before PRIVATE (for example RSA, EC, DSA,
  OPENSSH or ENCRYPTED). The match covers the whole block through its END header,
  or the remaining text if END is absent. A header is enough to flag it; no
  private-key body is printed.
- **GitHub ghp:** `ghp_` followed by at least 36 letters/digits.
- **GitHub github_pat:** `github_pat_` followed by at least 22
  letters/digits/underscores.
- **Slack xox:** `xox[baprs]-` followed by at least 10 token characters
  (letters, digits or hyphens).
- **AWS AKIA:** `AKIA` followed by exactly 16 uppercase letters/digits.
- **OpenAI sk:** `sk-` followed by at least 20 letters, digits,
  underscores or hyphens.
- **Stripe sk_live:** `sk_live_` followed by at least 16 letters/digits.
- **JWT:** three dot-separated base64url segments, each at least 8 characters;
  the first starts with `eyJ`. This recognizes a shape, without decoding data.
- **generic `<field>`:** case-insensitive `password`, `passwordHash`,
  `password_hash`, `secret`, `token` or `api_key` assigned a quoted value of at
  least 9 characters with `=` or `:`. Matching single/double quotes or backticks,
  JSON keys and minified text are supported. Assignment whitespace can span
  lines; a value itself cannot contain a line break. Other quote types and
  escaped delimiters are supported; matches use the written value without decoding it.
  A missing closing quote at the end of input is conservatively treated as a
  candidate too, including when a CLI reply was cut at the display cap.
  Only the value is masked, not the whole assignment or line. Hash-field names
  ensure C03's password hashes are masked before a CLI response is displayed.
  For CLI reply display only, named credential values shorter than 9 characters
  are also masked (8 or fewer use bullets); scan/report candidate thresholds stay unchanged.

Word boundaries delimit provider shapes and generic field names. When matches
overlap, the containing assignment or private-key block wins over a provider
match inside it. Partially overlapping spans are merged to avoid exposing any
part of a private-key body. Values documented as placeholders
are ignored: empty values, exact `example` or `changeme`, `your-…-here` forms,
and values made only from `x` characters. The `your` placeholder also accepts
underscores in place of hyphens. Matching is case-insensitive for these
placeholder checks. An EXAMPLE substring inside a longer synthetic key does not
exempt it; the shop example deliberately uses that control distinction.

## Output and limits

Every hit uses first 3 characters + `…` + last 4 plus length, such as
`sk-…a91f (51 chars)`. Values of 8 characters or fewer use `•••• (N chars)`.
Never print or store the original value in findings, reports or review notes.

`scan <run-id>` reads only that guarded run's `copy`. A hit is
`<relative file>:<line>  <pattern name>  <masked value>`. `.git` is skipped for
C02, binaries are skipped, symbolic links are not followed, and each file is
capped at 1 MiB. A plain note names every size skip. `No secrets found` with
exit 0 means only that the inspected text had no matching candidate; it does not
erase skip notes or certify the project.

`mask` reads stdin up to 20 MiB, stops with a plain note at that cap, and
prints only masked hits. With git patch input, each hit includes the nearest
preceding `commit <hash>` shortened to 7 characters and `+++ b/<file>` path,
with the historical line obtained from the patch hunk counters. Deleted lines
use the old side's line; added/context lines use the corresponding new line.
It prints no other input lines or context. Pipe history directly into it; never
save or display the unmasked stream.

The list does not cover arbitrary encodings, concatenated/split values, every
provider, password-hash format, or all personal data. C03–C05 also require the
reviewer's contract/field observations. Limits and skips are incomplete coverage,
not evidence that a leak was blocked. Never broaden a run beyond localhost or
the copy to compensate for scanner limits.
