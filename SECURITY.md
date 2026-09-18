# Security Policy

## Supported versions

Rhizom has not published a release yet. Security fixes land on `main`. Once releases exist,
the latest minor release line receives security fixes.

## Reporting a vulnerability

Please do not open a public issue for security problems.

Use GitHub's private vulnerability reporting instead: open the **Security** tab of this
repository and choose **Report a vulnerability**, or go directly to
<https://github.com/lokianer/rhizom/security/advisories/new>. The report reaches only the
maintainer.

Please include:

- the affected component (server API, web UI, indexer, Docker image …) and version or commit
- steps to reproduce, or a proof of concept
- the impact you see (for example: reading files outside the vault, script execution through
  rendered Markdown, bypassing permissions once multi-user support exists)

You can expect an acknowledgement within seven days. Confirmed issues are fixed on `main` as
soon as possible and documented in the [changelog](CHANGELOG.md); the advisory is published
once a fix is available.

## Scope notes

Rhizom is local-first and self-hosted: it sends no telemetry and requires no third-party
accounts. Anything that breaks that promise — unexpected network calls, data leaving the host,
access outside the configured vault folder — is in scope, even if it is not a classic
vulnerability.
