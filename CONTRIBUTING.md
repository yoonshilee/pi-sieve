# Contributing

All source, comments, messages, documentation, fixtures, and commits use English.
Use Node 22.19+ and the Pi 0.86.1 SDK pinned in the lockfile.

## File map

| Location | Responsibility |
| --- | --- |
| `README.md` | Installation, credentials, configuration, and daily use |
| `PRIVACY.md` | Data sent to providers, local storage, and distribution boundaries |
| `src/index.ts` | Provider registration, the three tools, cancellation, and diagnostics |
| `src/jev.ts` | Bounded requests, deadlines, response parsing, and sanitized failures |
| `src/inspection.ts` | Approved observation batches and typed outcome/evidence judgments |
| `src/scoring.ts` | Inline/profile validation, candidate scoring, and selected-option output |
| `src/selection.ts` | Config parsing, Markdown loading, retrieval ranking, and budgets |
| `examples/` | Fictional reference files, default config, and evaluation cases |
| `test/` | Selection, Pi SDK integration, package loading, and privacy checks |
| `scripts/evaluate.ts` | Offline and live selector comparison |
| `scripts/check-privacy.mjs` | Working files, staged content, history, identity, and package checks |
| `.githooks/`, `.github/workflows/` | Local commit checks and CI |

Keep runtime modules focused on these responsibilities. Pi supplies
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
For a persistent local installation, follow the [README](README.md#development-releases-and-license).

## Evaluate retrieval

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

- Only explicit tool calls can send data to Jev. Retrieval sends a bounded query
  and authored metadata; scoring sends supplied context and the resolved rubric
  and options; inspection sends the named, approved batch's objective and full
  observation text. Never automatically collect history or unrelated tool output.
- The tool schema, existing messages, skills, and tool availability stay unchanged.
  Results are appended through Pi's normal tool lifecycle and session storage.
- Local mode and Jev mode share the query, catalog, and output budgets. Exact names
  take priority. Oversized bodies return a source pointer, never a partial command.
- Discovery stops at 1,000 entries and 12 levels. Never scan other applications.
- Cancellation returns no obsolete references and cannot overwrite newer session
  diagnostics. Do not expose raw credential or service errors.
- Resolve TypeSafe credentials through Pi for each enabled operation; never copy them
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

## Publish a GitHub Release

Use GitHub Releases as the user-facing version history. Keep the README focused on
current capabilities, commands, and examples; put version-specific upgrade notes
in Releases. Avoid a second manually maintained changelog. One release describes
a reviewed version, not every development commit.

Within 1.x, the documented public tool names and input/output contracts,
configuration settings, and slash commands follow semantic versioning. Use patch
versions for compatible fixes and minor versions for compatible additions;
breaking changes require a new major version. Model judgments, confidence values,
and performance are not correctness or speed guarantees. Clearly document any
experimental defaults and limitations without treating them as permission to
silently break public interfaces.

1. Set the intended version in `package.json` and the root package entries in
   `package-lock.json`. Reuse no existing release tag or change dependencies solely
   to bump the version.
2. Review changes since the previous tag and write English notes with **Changes**,
   **Upgrade**, **Compatibility and validation**, and **Known limitations**. For the
   first release, summarize current capabilities and link the README's examples.
   Describe the conditions and limits of any cited experiment.
3. Run the checks above, commit using the public identity, push the intended
   commit, and wait for that exact commit's GitHub CI to pass.
4. Create a version tag and Release targeting that exact commit. Save reviewed
   notes to a temporary file and use the CLI's structured flags:

   ```sh
   gh release create vX.Y.Z --target FULL_COMMIT_SHA \
     --title 'vX.Y.Z — Short user-facing summary' \
     --notes-file /path/to/release-notes.md
   ```

5. Verify the tag's commit, published notes, and installation of the intended tag
   in an isolated Pi directory using the [pinned install command](README.md#more-installation-options).
   Correct code through a new version rather than moving an existing tag. Mark an
   intentionally unfinished release with `--prerelease`.

GitHub's generated notes primarily summarize merged pull requests. Since this
project currently uses direct commits, write the user-facing summary explicitly;
generated commit/PR links may supplement it. See the official
[release guide](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
and [generated notes documentation](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes).
This process publishes GitHub source and notes only; it does not publish to npm
or start live benchmarks. Benchmark methods and sanitized results remain in
[Pi Sieve Bench](https://github.com/yoonshilee/pi-sieve-bench).
