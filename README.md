# Pi Sieve

A Jev-powered context and tool selector for Pi agents.

Pi Sieve selects local memories, command guides, skills, and optional tools for
the current task. Pi's main model still plans the work and executes tools.
Sieve does not generate or approve shell commands.

**Status:** v0.1, tested with Pi **0.86.1** and Node **22.19+**. The package targets
`@earendil-works/pi-coding-agent >=0.86.1 <0.87.0`. Other Pi releases are not yet
supported. Selection thresholds are experimental; faster or more accurate
task completion has not been established by the offline tests.

## Install locally

From this checkout:

```sh
npm ci --ignore-scripts
pi -e ./src/index.ts
```

For persistent installation, run `pi install .` from this checkout, then use
`/reload` in an existing Pi session. A local installation references the checkout;
keep it available. No GitHub or npm publication is required.

Set `TYPESAFE_API_KEY` in your environment or through your secret manager before
starting Pi. Do not paste a real key into a tracked file, shell example, issue,
or commit message. Sieve reads the environment directly; it does not load `.env`.
Missing credentials leave Pi's skills and tools available and use local keyword
matching for memories and guides.

Review [PRIVACY.md](PRIVACY.md) before enabling cloud selection. Sieve only runs
automatic selection in projects Pi already trusts; it never grants project trust.

## Add reference material

In the project where you use Pi, create:

```text
.pi/
  sieve.json
  sieve/
    memories/
      payment-retries.md
    guides/
      test-payments.md
```

Configuration is optional. Each Markdown reference needs an explicit name and
an uploadable description:

```markdown
---
name: payment-retries
description: Payment retry handling and idempotency checks in this project.
---

# Payment retries

Verify that retrying an idempotency key does not create another payment.
Check the current implementation before relying on this note.
```

The description is sent to Jev; the body is not. There is no automatic summary
generation. Selected bodies are supplied to Pi's main model as reference data.
Use `AGENTS.md` for mandatory project instructions: Sieve never filters those.

See the fictional [memory](examples/memories/payment-retries.md) and
[command guide](examples/guides/test-payments.md). Examples are not automatically
loaded. Files without valid metadata, symlinks, and files over 64 KiB are skipped.
Discovery is bounded to 1,000 directory entries and 12 nested levels. Directories
are visited in configuration order, with entries sorted by name.

## Configuration

Copy [examples/sieve.json](examples/sieve.json) to `.pi/sieve.json` in your target
project. Relative directories resolve from that project's working directory.
Absolute directories are supported only when you configure them explicitly.
No global memories, other applications, or conversation archives are scanned.

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Enable automatic selection |
| `memoryDirs` | `[".pi/sieve/memories"]` | Local Markdown memory directories |
| `guideDirs` | `[".pi/sieve/guides"]` | Local Markdown command-guide directories |
| `pinnedSkills` | `[]` | Skill names excluded from pruning |
| `pinnedTools` | `[]` | Already enabled tool names excluded from pruning |
| `model` | `jev-1.13.0` | Pinned Jev model identifier |
| `timeoutMs` | `1500` | Deadline for the cloud request, including response reading |
| `maxCandidates` | `40` | Maximum candidates evaluated in one request |
| `maxDocuments` | `6` | Maximum selected memories and guides combined |
| `contextChars` | `8000` | Budget for rendered reference content, in characters |
| `includeThreshold` | `0.5` | Minimum relevance probability for unpinned documents |
| `excludeThreshold` | `0.2` | Skills/tools below this probability may be hidden |

Unknown fields or invalid values disable selection for that task rather than
partially applying an invalid configuration. The configuration accepts no API
key or custom endpoint. All constants and limits are visible in
[src/selection.ts](src/selection.ts).

## Selection behavior

1. Capture user input before Pi expands skills and prompt templates. Use up to
   three verified inputs on the current branch, within 8,000 characters.
2. Read local metadata and Pi's existing skill/tool catalog. Prefer keyword
   matches when selecting the bounded shortlist; remaining slots can contain
   candidates with no lexical overlap for semantic evaluation.
3. Send one batch to the official TypeSafe endpoint. Each candidate gets a
   separate Noul question; another question checks whether the task has enough
   context for selection. The latest user input takes priority.
4. Inject selected document bodies through Pi's `context` event. An oversized
   body is replaced by its description and source reference rather than an
   incomplete command. References that cannot fit are omitted.
5. Narrow the current skill menu and extension-tool loadout through Pi's
   structured prompt options. Keep currently enabled built-in tools, pinned
   capabilities, and exact capability names mentioned in the verified inputs.
   Pinned documents are prioritized but still obey document and character limits.

Sieve keeps unjudged tools and skills available. A failed request never means
an empty capability set. Missing credentials, HTTP errors, malformed answers,
insufficient task context, or deadlines preserve the existing skills/tools and
fall back to bounded local keyword matching for documents. There are no retries.
Requests and responses also have byte limits.

Within a run, tool results do not trigger more Jev calls. New steering/follow-up
input releases hidden tools and clears the old reference block. Automatic
selection resumes with the next normal prompt. Input that arrives while a run
is streaming is not retained in Sieve's raw-input cache.

The small raw-input cache lives in memory only. Reloads, session replacement,
and tree navigation clear it. Historical messages without a verified raw input
are not reconstructed from expanded transcript text or uploaded to Jev.

## Controls and recovery

- `/sieve status` displays counts, timing, model version, and the last fallback reason.
- `/sieve off` releases Sieve's hidden tools and stops automatic selection.
- `/sieve on` enables selection for the next task. These toggles are session-local.
- `sieve_search({ "query": "payment retries" })` lets the main model search local
  reference material and the current skill/tool catalog without contacting Jev.
  Matching tools hidden by Sieve are restored; their commands are not executed.

Sieve never hides its recovery tool. If an explicit Pi tool allowlist excludes
`sieve_search`, automatic selection is skipped rather than changing that allowlist.
Likewise, pinned names and recovery never enable tools that were disabled before
selection. Existing permission checks and tool handlers continue to apply.

Once the agent settles, or the extension is disabled/reloaded, Sieve restores
its remaining tool exclusions. It preserves unrelated additions. If a previously
visible tool has disappeared, Sieve yields to that external restriction instead
of restoring its exclusions. Pi does not expose ownership for every loadout
change; avoid multiple extensions independently controlling the same tools.

## Development and verification

```sh
npm ci --ignore-scripts
npm run check
npm run eval
```

Tests use Node's built-in runner and Pi's actual SDK with its scripted model
provider. They do not require a model account or send requests to Jev. The Jev
transport is captured and mocked to test privacy, validation, timeout behavior,
and recovery. These tests establish integration behavior, not model accuracy.

For a real selector measurement using only the shipped fictional fixture:

```sh
npm run eval -- --live
```

This requires `TYPESAFE_API_KEY` and sends the fixture's tasks and descriptions
to Jev. The report compares complete candidates, keyword selection, and Jev
selection, with required-item recall, character counts, selection latency,
fallback status, and reported Jev token usage. Character counts are not tokens.
The keyword baseline deliberately filters all optional candidates; normal
failure recovery conservatively keeps Pi's skills and tools.

Task outcome and end-to-end latency are marked `not_run`/`null`: this small
selection benchmark does not execute a main agent. To establish a product gain,
run the same coding tasks with the same model and permissions in all three
conditions, record objective test outcomes and total latency, and account for
prompt-cache misses and tool recovery. Do not infer a speedup from context size
alone. Save private results under the ignored `results/` directory.

## Safe contributions

Install [Gitleaks](https://github.com/gitleaks/gitleaks), then enable the hooks:

```sh
git config --local core.hooksPath .githooks
```

Configure this repository's Git author name to your public handle and its email
to your verified GitHub `noreply` address. Do not copy a private global identity.
The hook checks actual author and committer identities, all staged file contents,
and secrets before each commit. A second hook checks the commit message. Both
fail closed when Gitleaks is unavailable.

```sh
npm run check:privacy
npm run check:history
npm run check:package
npm run check:secrets
```

Checks reject private runtime files, personal home paths, non-example email
addresses (other than GitHub no-reply addresses), and locally identifiable
names. Gitleaks supplies the secret-pattern scan. Results omit matched content.
CI repeats the checks without using contributors' local identity settings.
Automated scanners are incomplete; inspect the staged diff before sharing it.

Keep real configurations, memories, logs, environment files, and credentials
outside tracked content. The npm package uses an explicit file allowlist. Commit
messages follow `type(scope): subject`, in English. No automatic publishing is
configured.

## References and license

- [Pi extension API](https://pi.dev/docs/latest/extensions)
- [Pi package installation](https://pi.dev/docs/latest/packages)
- [TypeSafe HTTP API](https://docs.typesafe.ai/api)
- [Jev model versions and limits](https://docs.typesafe.ai/models)
- [Jev known limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13)

Licensed under [Apache-2.0](LICENSE). This is an independent project, not an
official Pi or TypeSafe product.
