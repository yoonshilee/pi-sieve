# Privacy and data boundaries

## What Jev receives

Only an explicit `sieve_search` or `sieve_score` tool call in a trusted project can make a Jev
request. When Jev is enabled and Pi can resolve a TypeSafe credential, the request
to `https://api.typesafe.ai/v1/systemone` contains, for retrieval:

- The search query supplied by the main model, within 8,000 characters.
- Candidate kinds, names, and explicitly authored descriptions from the shortlist.
- Fixed English relevance questions and the configured model identifier.

For scoring, Jev receives the model-authored context plus the evaluation question,
scoring levels, and option IDs and contents. These are supplied inline or loaded
from an explicitly named project decision profile. Profile names and source paths
are not automatically included in the request. These can include
command text or selected observations if the main model puts them in the call.
Sieve does not automatically collect those observations or run the options.
Decision profiles are authored project files, not a conversation cache. Their full
validated content goes to TypeSafe; do not store private facts or credentials in them.

The key is sent only in the Authorization header. Redirects are rejected. There
is no alternate endpoint, telemetry destination, or automatic retry.

Sieve does not automatically attach memory/guide bodies, full skill files,
expanded prompts, attachments, assistant replies, other tool results, project
rules, full history, or source-path metadata. It does not reconstruct user inputs
from history or derive summaries from private bodies.

**Queries and scoring arguments are model-authored, not verified raw user inputs.** The model may copy
private information, paths, or credentials from its context into a query. Authored
descriptions can also contain private information. The payload boundary does not
guarantee that those strings are free of sensitive data. Sieve is not a redaction
or data-loss prevention system. Use `/sieve off` to disable scoring and use local-only retrieval when data
must not reach TypeSafe. Consult [TypeSafe's policies](https://docs.typesafe.ai/legal)
for the service's retention and processing terms.

## What the main model receives

Selected bodies and their source paths are returned to Pi's existing main-model
provider as a normal tool result. Oversized bodies return a description and source
pointer. Local retrieval does not mean the main-model provider is local.

Scoring returns the selected option ID and unchanged content to the main model.
Full scores remain in Pi tool details for diagnostics and session storage.
Sieve never executes command guides or changes skills, tools, or project rules.
Relevance judgments are not security authorizations or proof of correctness.
It does not rewrite earlier messages to keep retrieved material at the prompt tail.

## Credentials

Sieve registers `typesafe` with Pi's native authentication system. `/login typesafe`
saves a key to Pi's user-level `auth.json`, normally `~/.pi/agent/auth.json`;
custom Pi agent directories use their own file. Pi creates it with `0600`
permissions on Unix. Literal keys remain plain text, and Pi 0.86.1's native login
dialog can display entered text. The command does not send the key to a model or
validate it with TypeSafe. Avoid recording the dialog or entering keys in chat.

The saved credential takes precedence over `TYPESAFE_API_KEY`. Pi also resolves
environment references and `!command` secret-manager entries. Commands execute
locally under Pi's rules, with output cached for the process lifetime. Sieve does
not implement its own credential storage or load `.env` files. Resolved keys go
only to the fixed TypeSafe endpoint's Authorization header.

Use `/logout` and select TypeSafe to remove the saved credential. Environment
keys remain available after logout; `/sieve off` stops Jev requests and cancels pending searches
regardless of credential source. Protect the user-level Pi directory separately
from this repository. Removing the plugin does not delete credentials saved by Pi.

## Local state and logs

Sieve keeps only pending request controllers, an on/off override, and sanitized
last-operation diagnostics in memory. It does not retain a conversation cache,
persist queries separately, or log requests and responses.

**Search queries, reference bodies, scoring arguments, and scores follow normal Pi session storage.**
They can appear in saved sessions, exports, and subsequent main-model requests.
This differs from v0.1's transient reference injection. Protect Pi sessions and
exports; switching Sieve off does not delete earlier tool results. Scoring arguments can contain private data even when Sieve itself reads no local files.

`/sieve status` shows counts, duration, model identifier, reported token usage,
and fixed reason codes only. Missing usage is unknown, not zero. It does not print
queries, headers, source paths, service error bodies, or reference contents.

## Source control and distribution

This repository ignores `.pi/`, environment files, logs, evaluation outputs,
dependencies, and package archives. Only fictional examples are tracked.
Other projects need their own ignore rules for private `.pi/sieve` content.

The npm file allowlist includes source, fictional examples, README, CONTRIBUTING,
this file, and the license. Local hooks check staged contents and effective commit identity;
CI checks tracked content, history, and the package inventory. Gitleaks scans for
secrets. Personal names and email addresses are not required in project files.

GitHub no-reply email protects the private email address, not account anonymity.
Commits remain attributable to the public handle. Hooks and scanners cannot
guarantee that every form of private information is detected. Review changes
before publishing; revoke any credential that has already been exposed.
