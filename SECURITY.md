# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for a security problem. Use GitHub's
private ["Report a vulnerability"](https://github.com/cagrianilokumus/squadreader/security/advisories/new)
advisory flow, or contact the maintainer privately.

Include: the affected version or commit, your OS, the Squad server version, and
steps to reproduce. You'll get an acknowledgement within a reasonable time and
we'll coordinate a fix and disclosure.

## Scope

sqreader reads local process memory and serves a local HTTP endpoint. The most
relevant areas are:

- the `serve` HTTP surface — authentication is intentionally delegated to your
  reverse proxy (see `deploy/`); running it exposed without one is misuse, not a
  vulnerability;
- path handling for served static files (`/icons`, `/sqmaps`, the SPA);
- the stats database, which stores player identifiers (see `PRIVACY.md`).

## Supported versions

Only the latest release receives security fixes.
