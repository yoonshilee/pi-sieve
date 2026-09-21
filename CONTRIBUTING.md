# Contributing

All source, comments, messages, documentation, fixtures, and commits use English.
Use Node 22.19+ and the Pi 0.86.1 SDK pinned in the lockfile.

## File map

| Location | Responsibility |
| --- | --- |
| `README.md` | Installation, credentials, configuration, and daily use |
| `PRIVACY.md` | Data sent to providers, local storage, and distribution boundaries |
| `src/index.ts` | Provider registration, retrieval tool, cancellation, and diagnostics |
| `src/selection.ts` | Config parsing, Markdown loading, ranking, Jev requests, and budgets |
| `examples/` | Fictional reference files, default config, and evaluation cases |
| `test/` | Selection, Pi SDK integration, package loading, and privacy checks |
| `scripts/evaluate.ts` | Offline and live selector comparison |
| `scripts/check-privacy.mjs` | Working files, staged content, history, identity, and package checks |
| `.githooks/`, `.github/workflows/` | Local commit checks and CI |

Keep the two runtime modules focused on these responsibilities. Pi supplies
credentials, frontmatter parsing, extension lifecycle, skill loading, and tool
execution. Project settings and private candidates belong in the target
project's ignored `.pi/` directory, not in `examples/`.

## Run checks

```sh
npm ci --ignore-scripts
npm run check
npm run eval
```

`check` runs TypeScript checking, Node's built-in tests, privacy scanning, and
the npm package inventory check. Tests load the packed extension through Pi's
actual SDK and use a scripted main-model provider. Jev requests are captured and
mocked; no account or network request to Jev is needed. Native login tests use a
temporary `auth.json`, never a developer's real credentials. These tests establish
integration behavior and data boundaries, not Jev accuracy.

To try a source change without installing the package, run `pi -e ./src/index.ts`.
For a persistent local installation, follow the [README](README.md#install).

## Evaluate selection

`npm run eval` compares all candidates with local keyword selection using
[fixed fictional cases](examples/evaluation.json). To add real Jev results:

```sh
npm run eval -- --live
```

This standalone script requires `TYPESAFE_API_KEY`; it does not run inside Pi or
read Pi's saved credentials. It sends fixture tasks and descriptions to TypeSafe
and may incur API charges. It records required-item recall, selected count,
context characters, selection latency, fallback reason, and reported Jev token
usage. Character counts are not token counts. Both selectors use the same references
and query; the local baseline applies the same count and body budgets.

Task outcome and end-to-end latency remain `not_run` and `null`: this benchmark
does not execute a main agent. To establish a speed or quality gain, run the same
coding tasks with identical models and permissions under local-only and Jev retrieval conditions.
Use the same tool definitions and source catalog. Measure necessary-reference
recall, objective outcomes, model requests, uncached/cached input, output, Jev usage,
and total latency. Keep fallbacks and unreported usage visible. Scripted responses
only establish integration behavior, not real relevance or speed. Keep private reports in the ignored `results/` directory.

## Behavior to preserve

- Only explicit retrieval calls can send a bounded query and authored metadata to
  Jev. Do not automatically attach history, bodies, source paths, or tool results.
- The tool schema, existing messages, skills, and tool availability stay unchanged.
  Results are appended through Pi's normal tool lifecycle and session storage.
- Local mode and Jev mode share the query, catalog, and output budgets. Exact names
  take priority. Oversized bodies return a source pointer, never a partial command.
- Discovery stops at 1,000 entries and 12 levels. Never scan other applications.
- Cancellation returns no obsolete references and cannot overwrite newer session
  diagnostics. Do not expose raw credential or service errors.
- Resolve TypeSafe credentials through Pi for each enabled search; never copy them
  to environment variables or logs. Keep the authentication provider's chat-model
  list empty. Follow [PRIVACY.md](PRIVACY.md).

## Before committing

Install [Gitleaks](https://github.com/gitleaks/gitleaks), then enable local hooks:

```sh
git config --local core.hooksPath .githooks
```

Set this repository's local Git name to your public handle and its email to your
verified GitHub `noreply` address. Hooks check the actual author and committer,
staged file contents, and commit messages. They fail closed without Gitleaks.

```sh
npm run check:privacy
npm run check:history
npm run check:package
npm run check:secrets
```

Checks reject private runtime files, personal home paths, non-example email
addresses other than GitHub no-reply addresses, and locally identifiable names.
Gitleaks supplies secret-pattern checks. Matched contents are never printed.
CI repeats checks without relying on contributors' local identity settings.
Scanners are incomplete; review the staged diff before sharing it.

Commit messages use `type(scope): subject` in English. The npm `files` allowlist
ships source, fictional examples, documentation, and the license; tests, scripts,
private configuration, and evaluation output stay out. No publishing is automated.
