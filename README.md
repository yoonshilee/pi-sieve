# Pi Sieve

Classify batches of tool observations and assess their support for a hypothesis
inside one on-demand tool call. `sieve_inspect` reads an existing approved batch,
asks Jev narrow semantic questions, and returns typed judgments. The main model
does not need to copy every observation or write repeated question definitions.
`sieve_search` remains available; generic `sieve_score` is experimental and is not
the recommended default workflow. Tools append normal messages without rebuilding
earlier context or changing other capabilities.

**Compatibility:** Pi **0.86.1**, Node **22.19+**. The supported Pi package range
is `>=0.86.1 <0.87.0`. Thresholds are experimental; real-world speed and accuracy
gains have not been established.

## Install

The inspection feature is currently a local development change. GitHub installation
provides the last pushed version; use the local checkout below to test inspection.

Install from the [GitHub repository](https://github.com/yoonshilee/pi-sieve):

```sh
pi install git:github.com/yoonshilee/pi-sieve
pi list
```

This installs the plugin for your user account. Start Pi in the project where
you want to use Sieve, or run `/reload` in an existing session, then configure
your key with `/login typesafe`. No npm release is currently available.

For a project-only installation, run this from the target project instead:

```sh
pi install -l git:github.com/yoonshilee/pi-sieve
```

Update or remove the installation with:

```sh
pi update git:github.com/yoonshilee/pi-sieve
pi remove git:github.com/yoonshilee/pi-sieve
```

For project-only removal, add `-l` and run from that project. Reload or restart
Pi after changing the installation.
See [Pi package management](https://pi.dev/docs/latest/packages) for details.

### Local development

Clone the repository and install its development dependencies:

```sh
git clone https://github.com/yoonshilee/pi-sieve.git
cd pi-sieve
npm ci --ignore-scripts
pi -e ./src/index.ts
```

The last command loads Sieve for one session. For persistent local use, run
`pi install .` instead, then start or reload Pi. Keep the checkout in place:
Pi references local packages without copying them. After updating the checkout,
run `npm ci --ignore-scripts` there and reload Pi. Run `pi remove .` from the
checkout to remove that local installation.

## Configure your TypeSafe key

Each user supplies their own key from the [TypeSafe console](https://console.typesafe.ai).
The plugin contains no shared credential. Review [PRIVACY.md](PRIVACY.md) before
enabling Jev requests.

### Recommended: Pi login

After installing or reloading the plugin, enter this in interactive Pi:

```text
/login typesafe
```

Paste your key into Pi's API-key dialog. Pi saves it under `typesafe` in its
user-level `auth.json` (normally `~/.pi/agent/auth.json`). It applies to the next
search without restarting Pi and is shared across your projects. Sieve registers
an authentication provider with no chat models, so your main model is unchanged.
Saving the key does not validate it with TypeSafe; the next Jev-enabled search uses it.

Pi creates the credential file with `0600` permissions on Unix, but stores literal
keys as plain text. Its 0.86.1 login dialog can display the entered text; use the
secret-manager option below if you need to avoid displaying a key in the terminal.
To remove the saved credential, run `/logout` and select **TypeSafe**. Pi 0.86.1
does not accept a provider argument for `/logout`.

### Environment variables and secret managers

For CI or non-interactive Pi, set `TYPESAFE_API_KEY` before starting the process.
For a temporary setup in **zsh**, this prompt hides the key and keeps it out of
shell command history:

```zsh
read -rs 'TYPESAFE_API_KEY?TypeSafe API key: '
printf '\n'
export TYPESAFE_API_KEY
pi
```

Pi's saved credential takes precedence over `TYPESAFE_API_KEY`. Logging out removes
the saved credential only; an environment key remains usable. Use `/sieve off` to
disable all Jev requests regardless of the credential source. Restart Pi after
changing its parent environment; `/reload` does not import new shell variables.

Pi also supports a `!command` in `auth.json` to retrieve a key from a secret
manager. For example, if you already stored a generic password under the macOS
Keychain service name `typesafe`, merge this entry into your existing `auth.json`
without replacing other providers:

```json
{
  "typesafe": {
    "type": "api_key",
    "key": "!security find-generic-password -ws 'typesafe'"
  }
}
```

Pi executes the command locally and caches its output for the process lifetime;
restart Pi after rotating that secret. See [Pi authentication](https://pi.dev/docs/latest/providers#key-resolution)
for environment references and 1Password examples. Sieve uses Pi's credential
resolver; it does not maintain a second credential file or load `.env`.
Keys are not accepted in `.pi/sieve.json`.

## Add memories and guides

In the project where you run Pi, create these directories:

```sh
mkdir -p .pi/sieve/memories .pi/sieve/guides
```

Add Markdown files with a name, an uploadable description, and a body:

```markdown
---
name: payment-retries
description: Payment retry handling and idempotency checks in this project.
---

# Payment retries

Verify that retrying an idempotency key does not create another payment.
Check the current implementation before relying on this note.
```

See the fictional [memory](examples/memories/payment-retries.md) and
[guide](examples/guides/test-payments.md). Examples are not loaded automatically.
**The search query and descriptions go to Jev; selected bodies go to Pi's main
model.** Queries are written by the main model and may contain information from
your conversation. Keep mandatory rules in `AGENTS.md`. Sieve does not select or
read skills, other applications' memories, or arbitrary tool results.

Add these entries to your target project's `.gitignore` if the references and
configuration are private; this repository's ignore rules do not protect other projects:

```gitignore
.pi/sieve/
.pi/sieve.json
```

## Inspect existing observations

An existing diagnostic or retrieval tool can write an upload-approved batch to
`.pi/sieve/observations/<name>.json`. Only this dedicated directory is read;
Sieve does not collect arbitrary tool output automatically. Do not make the main
model read and recopy observations solely to invoke inspection: that duplicates work.

Each batch contains an `objective` and `observations` with unique `id` and `text`
fields. See [operation outcomes](examples/observations/transaction.json) and
[hypothesis evidence](examples/observations/hypothesis.json). For a manual demo,
copy those fictional files from this checkout into the dedicated directory:

```sh
mkdir -p .pi/sieve/observations
cp examples/observations/transaction.json examples/observations/hypothesis.json .pi/sieve/observations/
```

Then ask Pi to invoke `sieve_inspect` with either of these arguments:

```json
{"source":"transaction","mode":"outcome"}
```

```json
{"source":"hypothesis","mode":"evidence"}
```

- `outcome` classifies each observation as `completed`, `not_applied`, `partial`,
  or `unknown` relative to the requested operation.
- `evidence` classifies each observation as `supports`, `contradicts`, `unrelated`,
  or `insufficient` relative to the hypothesis. It does not combine separate
  observations into a causal proof.

The tool uses one batch of independent Choice questions. Files are limited to
32 KiB and 40 observations (also bounded by `maxCandidates`), with 4,000 characters
per observation and 2,000 for the objective. Invalid, oversized, or linked files
are rejected, not silently truncated. Unknown fields and duplicate IDs are invalid.
Original evidence stays in its file and remains accessible with Pi's `read` tool.

**The full objective and observation text are sent to TypeSafe.** Place only data
approved for that service here; omit credentials and private paths. This is a
broader data boundary than description-only retrieval. File names and item IDs
are not added to the request. See [PRIVACY.md](PRIVACY.md).

`/sieve off` returns the same raw batch for caller interpretation with no Jev call.
Missing credentials, timeouts, and invalid responses do the same, with an explicit
reason and no invented labels. Cancellation returns no stale observations or labels.
Default timeout remains 1.5 seconds; larger experiments must disclose overrides.
Confidence is not a correctness guarantee or execution permission. There is no
automatic command execution, retry, global completion verdict, or history rewrite.

## Experimental decision profiles

Use Jev when several plausible actions require substantial evidence comparison,
or choosing badly would cause significant rework. Execute explicit commands,
routine tests, and obvious next steps directly. There is no per-stage scoring quota.

Keep recurring candidates and a neutral rubric in a project-authored JSON file:

```sh
mkdir -p .pi/sieve/decisions
# Copy and adapt examples/decisions/payment-diagnostic.json from this checkout.
```

The file contains `question`, `criteria`, and `options` with the same format as
inline scoring below, but no context. Tell Pi which profile is applicable, then
it can call:

```json
{"profile":"payment-diagnostic","context":"The basic payment test passes. The caller supplying retry keys is still unknown."}
```

Only context and profile name need to be generated again. Profile files are loaded
on demand from `.pi/sieve/decisions/<name>.json`; their resolved question, rubric,
and options are sent to Jev. File paths and profile names are not sent automatically.
Profiles are not automatically discovered or added to the system prompt. Review
all candidates for current applicability; they are not permission grants. Prefer
existing profiles over writing a new profile for a one-off choice. Symlinks, files
over 64 KiB, unknown fields, missing profiles, and mixed inline/profile calls return
`invalid_input`. New input and mode changes cancel in-flight selection as before.

For scoring workloads, the observed v0.4 requests frequently exceeded the 1.5-second
default. Set `{"timeoutMs":10000}` in `.pi/sieve.json` if that longer wait is acceptable;
this applies to retrieval too. A longer timeout improves availability, not speed.

## Score candidate actions

Ask the main model to propose grounded options and a shared rubric, then use
`sieve_score` to delegate the next choice. It should not finish the same
comparison itself before delegating it. Example tool arguments:

```json
{
  "context": {
    "goal": "Locate duplicate payment charges",
    "observation": "Concurrent retries create duplicate charges"
  },
  "question": "How much useful evidence will this action provide?",
  "criteria": [
    "No relevant evidence",
    "Indirect evidence about a plausible cause",
    "Direct evidence distinguishing the leading causes"
  ],
  "options": [
    { "id": "inspect", "content": "Inspect the payment idempotency handler" },
    { "id": "test", "content": "Run the existing concurrent retry test" }
  ]
}
```

One request evaluates all options against the same rubric. Sieve selects the highest
score, breaking ties by input order, and returns only the selected ID and original
content to the main model:

```json
{"available":true,"reason":"none","selected":{"id":"test","content":"Run the existing concurrent retry test"}}
```

The model follows this selection using Pi's existing tools, without comparing the
options again. Supply an exact command as option content when exact execution is
required. Only propose eligible actions; normal project rules, tool validation,
and permissions still apply. This is a tool-use contract, not a runtime interceptor:
Sieve cannot force a noncompliant model to obey or grant permission to execute.

Per-option scores, probabilities, confidence, and usage remain in Pi tool details
for diagnostics; they are not included in the model-visible result text. Scores
range from zero to `criteria.length - 1`, not success percentages. Confidence
is distribution concentration, not a correctness guarantee. A neutral rubric
should describe useful outcomes without encoding a particular candidate as the
answer. There is no minimum acceptance score: include a suitable evidence-gathering
option if no immediate action is justified.

Supply one evaluation dimension, 2-10 descriptive levels, and 1-40 uniquely named
options. Context may be text or a flat object of text fields. Requests are capped
at 64,000 bytes, so maximum field lengths cannot all be used together. The
configured `model`, `timeoutMs`, and `enabled` apply; retrieval thresholds and
budgets do not alter scores. Scoring is strictly on demand.

Missing credentials, disabled mode, invalid input, timeout, or invalid responses
return `available: false`, a reason code, and `selected: null`. No decision was
made; report the reason and gather missing evidence or user input. Scoring never falls back to invented
keyword scores and never automatically retries.

## Retrieve references

Start with `/sieve on`, then ask Pi:

```text
Use sieve_search to find the payment retry rules and test guide before editing.
```

The model can call `sieve_search({ "query": "payment retry rules and tests" })`.
Sieve loads local reference metadata, keyword-ranks candidates, sends one batch
of independent relevance questions to Jev, and returns selected bodies with their
source paths. Guides are references, not commands Sieve executes. Ordinary input
and unrelated tool calls make no Jev requests. The main model decides when to search;
installing Sieve does not guarantee that every task uses it.

| Control | Effect |
| --- | --- |
| `/sieve status` | Show the latest operation, counts, duration, model, reported token usage, and reason |
| `/sieve on` | Enable Jev inspection, scoring, and retrieval |
| `/sieve off` | Return raw observations, disable scoring, and use local keyword retrieval |
| `sieve_inspect({ source, mode })` | Classify an existing approved observation batch using `outcome` or `evidence` |
| `sieve_score({ context, question, criteria, options })` | Select one caller-defined candidate for the main model to execute |
| `sieve_search({ query })` | Retrieve memories and command guides on demand |

On/off overrides last for the current session. Both modes keep exactly the same
tool definitions. Reloads and session changes reset the override and diagnostics.
New input, session changes, or switching modes cancel pending requests; cancelled
operations return no stale content. Completed tool results remain in Pi history.

Missing credentials, timeouts, service errors, or invalid answers return bounded
local results with an explicit fallback reason. There are no automatic retries.
`disabled` means local-only mode, `not_run` means no operation has completed, and
`none` means a Jev batch succeeded. `/sieve status` contains no query or body text.
A saved key is not proof of a successful Jev request; check the reported reason.

If `/sieve` is unknown, check `pi list` and reload the extension. For `missing_key`,
use `/login typesafe`. For `invalid_config`, check the example below. Untrusted
projects return no references or network requests; use Pi's normal trust flow.

## Configure retrieval

Defaults work without a configuration file. Copy [examples/sieve.json](examples/sieve.json)
to `.pi/sieve.json` in your target project to override them. Changes apply to the
next search. Relative directories resolve from the project working directory.
Keys and custom endpoints are not accepted in this file.

| Field | Default | Purpose |
| --- | --- | --- |
| `enabled` | `true` | Use Jev for searches; `false` uses local matching |
| `memoryDirs` | `[".pi/sieve/memories"]` | Markdown memory directories |
| `guideDirs` | `[".pi/sieve/guides"]` | Markdown guide directories |
| `model` | `jev-1.13.0` | Jev model identifier |
| `timeoutMs` | `1500` | Request deadline, including response reading |
| `maxCandidates` | `40` | Maximum candidates evaluated per request |
| `maxDocuments` | `6` | Maximum returned memories and guides combined |
| `contextChars` | `8000` | Character budget for returned reference material |
| `includeThreshold` | `0.5` | Minimum relevance probability for unnamed documents |

Queries are limited to 8,000 characters. Exact reference names take priority and
are not excluded by Jev. All references still obey document and character limits.
An oversized body becomes a source pointer and description, not a partial command.
Malformed Markdown, symlinks, and files over 64 KiB are skipped. Unknown configuration
fields or invalid values stop that search without returning private content.

The timeout and threshold remain experimental defaults. The historical pilot
needed a 10-second timeout for reliable responses; that is a separate benchmark
setting, not a new production default or a speed claim.

## Context, cache, and limitations

Sieve registers fixed tools and appends ordinary tool results. It does not insert
transient context blocks, rewrite prior messages, or change available skills and
tools between searches. This avoids Sieve-induced changes to existing request
prefixes. Results still add tokens and may be saved in Pi sessions. Provider cache
hits also depend on routing, retention, compaction, and other extensions; they are
not guaranteed. See [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

Jev can reduce the references the main model needs to inspect, but also adds a
network request. Small or easily searched catalogs may work better with `/sieve off`.
Relevance is judged from authored summaries, so missing candidates, inaccurate
summaries, and stale references remain limitations. Verify important claims against
the current project. No speed, cost, or accuracy improvement is established for v0.2.

### Migrating from v0.1

Installation, `/login typesafe`, and the `sieve_search({ query })` signature remain
unchanged. v0.2 removes automatic per-task selection, raw-input collection, context
injection, capability filtering, and hidden-tool recovery. Existing `pinnedSkills`,
`pinnedTools`, and `excludeThreshold` fields are accepted but ignored; remove them
when updating your configuration. Skills and tools follow Pi's normal settings.
Previously saved tool results remain ordinary session history.

### Migrating from v0.4

Inline scoring remains supported. The optional `profile` argument reuses project
files and cannot be combined with inline `question`, `criteria`, or `options`.
No automatic scoring, tool execution, or conversation caching is introduced.

### Migrating from v0.5

`sieve_inspect` adds two optional semantic inspection modes. Existing search and
scoring inputs remain compatible. Inspection reads only explicitly named approved
batches, and uploads their full observation text when enabled. `/sieve off` returns
raw observations; it does not replace semantic judgments with keyword labels.

### Migrating from v0.3

The `sieve_score` input signature is unchanged. Its model-visible output now contains
`selected` instead of a score table. The model follows that selection; it no longer
uses scores as advice for its own final choice. No command execution is added to
the plugin. Unavailable responses have `selected: null`.

## Evaluation status

Candidate scoring has no established speed, cost, or accuracy improvement.
Earlier retrieval and automatic-context experiments are historical diagnostics,
not evidence for this mechanism or future release performance claims. New
experiments use Sol medium. Benchmark implementation lives in
[Pi Sieve Bench](https://github.com/yoonshilee/pi-sieve-bench).

## Development and license

See [CONTRIBUTING.md](CONTRIBUTING.md) for the file map, tests, evaluation, and
commit checks, and [PRIVACY.md](PRIVACY.md) for exact data boundaries.

References: [Pi extensions](https://pi.dev/docs/latest/extensions),
[TypeSafe API](https://docs.typesafe.ai/api),
[Jev models](https://docs.typesafe.ai/models).

Licensed under [Apache-2.0](LICENSE). This is an independent project, not an
official Pi or TypeSafe product.
