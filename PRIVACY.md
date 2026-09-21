# Privacy and data boundaries

## What Jev receives

When automatic selection is enabled, the project is trusted, and
`TYPESAFE_API_KEY` is present, Sieve sends an HTTPS POST to
`https://api.typesafe.ai/v1/systemone` containing:

- Up to three verified raw user inputs from the current branch, within the task budget.
- Candidate kinds, names, and descriptions from the bounded shortlist.
- Fixed English questions and the configured model identifier.

The credential is sent only in the Authorization header. Redirects are rejected.
There is no alternate endpoint, telemetry destination, or automatic retry.

Sieve does not attach memory/guide bodies, full skill files, expanded prompt
templates, images, assistant replies, tool results, tool parameter schemas,
project rules, full history, or source-path metadata to this request. Raw inputs
that cannot be verified are skipped. Descriptions are explicitly authored;
Sieve never derives a cloud summary from a private body.

**User inputs and descriptions can themselves contain private data**, including
paths and credentials. Sieve is not a general-purpose redaction or data-loss
prevention system. Review those inputs and descriptions before using the cloud
service. Disable Sieve for tasks that must not reach TypeSafe. The service's
retention and processing terms are independent of this plugin; consult
[TypeSafe's policies](https://docs.typesafe.ai/legal).

## What the main model receives

Selected memories and guides are provided to Pi's existing main-model provider.
They can contain their original local source paths so the model can verify or
read the full reference. The recovery tool can return matching bodies and skill
paths, and restore tools previously hidden by Sieve. This is local retrieval,
not a promise that the main-model provider is local.

Sieve does not overwrite project instructions, bypass permission checks, or
execute command guides. Jev's decisions are relevance judgments, not security
authorizations or proof that a reference is correct.

## Local state and logs

Raw input mappings, selection state, and document content stay in memory. Sieve
does not append them to Pi's session log or create a persistent prompt cache.
The automatic context block is transient. Normal Pi user messages, main-model
responses, and explicit recovery-tool results still follow Pi's session storage
behavior; they may contain private content. Protect Pi sessions and exports.

`/sieve status` shows only aggregate counts, duration, model identifier, and a
fixed reason code. Sieve does not print requests, headers, source paths, raw
service errors, response bodies, or document content to diagnostic logs.

## Source control and distribution

This repository ignores `.pi/`, environment files, logs, evaluation outputs,
dependencies, and package archives. Only fictional examples are tracked.
Other projects need their own ignore rules for private `.pi/sieve` content.

The npm file allowlist includes source, fictional examples, README, this file,
and the license. Local hooks check staged contents and effective commit identity;
CI checks tracked content, history, and the package inventory. Gitleaks scans for
secrets. Personal names and email addresses are not required in project files.

GitHub no-reply email protects the private email address, not account anonymity.
Commits remain attributable to the public handle. Hooks and scanners cannot
guarantee that every form of private information is detected. Review changes
before publishing; revoke any credential that has already been exposed.
