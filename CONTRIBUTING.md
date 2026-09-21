# Contributing

All source, comments, messages, documentation, fixtures, and commits use English.
Use Node 22.19+ and the Pi 0.86.1 SDK pinned in the lockfile.

## File map

| Location | Responsibility |
| --- | --- |
| `README.md` | Installation, credentials, configuration, and daily use |
| `PRIVACY.md` | Data sent to providers, local storage, and distribution boundaries |
| `src/index.ts` | Pi events, provider registration, commands, context, and tool restoration |
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
usage. Character counts are not token counts. The keyword baseline filters all
optional candidates; runtime failure recovery keeps Pi's skills and tools.

Task outcome and end-to-end latency remain `not_run` and `null`: this benchmark
does not execute a main agent. To establish a speed or quality gain, run the same
coding tasks with identical models and permissions under all three conditions.
Measure objective test outcomes and total latency, including prompt-cache misses
and tool recovery. Keep private reports in the ignored `results/` directory.

## Behavior to preserve

- Only verified raw inputs captured before expansion may go to Jev, at most three
  on the current branch within 8,000 characters. Never reconstruct them from
  expanded history. Streaming input clears selection and is not cached.
- Candidate descriptions are explicitly authored. Bodies and source-path metadata
  stay out of Jev requests. Discovery stops at 1,000 directory entries and 12 levels.
- Each unpinned candidate receives its own Noul question; a separate question
  checks whether the task supplies enough context. Unjudged capabilities stay available.
- Reference content is transient. Oversized bodies become a description and source
  reference, not a partial command. Pinned documents still obey count and size budgets.
- Preserve other extensions' state. Recovery restores only Sieve's own exclusions;
  it never enables tools disabled before selection. Follow [PRIVACY.md](PRIVACY.md).
- Resolve TypeSafe credentials through Pi for each task. Pass the resolved key
  directly to selection; do not copy it into process environment, diagnostics,
  session entries, or the Jev request body. Keep the provider's chat-model list empty.

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
