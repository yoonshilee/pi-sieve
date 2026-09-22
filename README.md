# Pi Sieve

Pi Sieve is a Pi extension that delegates on-demand semantic judgments to Jev:
classify operation outcomes, assess evidence for a hypothesis, retrieve project
memories and guides, or select a candidate action. The main model calls Sieve when
needed and receives typed judgments or relevant reference material. Sieve does not
automatically review every command or execute selected actions itself.

**Compatibility:** Pi **0.86.1** (`>=0.86.1 <0.87.0`), Node **22.19+**.

## Install and log in

Run in your terminal:

```sh
pi install git:github.com/yoonshilee/pi-sieve
pi list
pi
```

If Pi is already running, enter `/reload` in that session. Then enter this **inside
Pi**, and paste your own [TypeSafe key](https://console.typesafe.ai) into the login
dialog, not into chat:

```text
/login typesafe
```

Sieve registers TypeSafe for authentication only; your main chat model is unchanged.
Pi saves the key in its user-level `auth.json`. Saving it does not validate the key;
the next enabled Sieve tool call does. See [privacy and credentials](PRIVACY.md#credentials).

To update an unpinned installation, run in your terminal, then `/reload` inside Pi:

```sh
pi update git:github.com/yoonshilee/pi-sieve
```

To uninstall, run in your terminal:

```sh
pi remove git:github.com/yoonshilee/pi-sieve
```

## Commands

Enter these commands **inside Pi**:

| Command | Effect |
| --- | --- |
| `/sieve on` | Enable Jev for inspection, retrieval, and candidate selection. |
| `/sieve off` | Stop Jev calls: inspection returns raw observations, retrieval uses local keywords, and scoring returns no selection. |
| `/sieve status` | Show enabled state and the latest operation, reason, counts, duration, model, and reported token usage. |
| `/reload` | Reload installed extensions after an installation or update. |
| `/login typesafe` | Configure the TypeSafe API key through Pi. |

These are **model tools**, not terminal commands or slash commands. Ask Pi to call
them using the examples below:

| Tool | Input | Result |
| --- | --- | --- |
| `sieve_inspect` | `source` and `mode` (`outcome` or `evidence`) | Per-observation judgments, or raw observations on fallback. |
| `sieve_search` | `query` | Relevant memory and guide bodies, with source paths. |
| `sieve_score` | `context`, `question`, `criteria`, `options`; or `context` and `profile` | One selected option, or no selection when unavailable. |

Installing or enabling Sieve does not force the main model to call it. Ordinary
conversation and unrelated tools do not trigger Jev requests.

## Examples

These examples create fictional demo data in the project where you run Pi. Use a
scratch project if the demo filenames already exist. Run the file-creation commands
in a terminal in that project, then paste the indicated prompt into Pi.

In real workflows, an existing tool should produce the approved observation batch.
Do not make the main model read and recopy material solely to invoke Sieve. Exact
status fields, exit codes, and arithmetic should be handled with local code.

### Classify operation outcomes

Create a batch:

```sh
mkdir -p .pi/sieve/observations
cat > .pi/sieve/observations/operation-demo.json <<'JSON'
{
  "objective": "Apply the requested record update.",
  "observations": [
    { "id": "request-a", "text": "The transaction committed. Sending the completion email failed afterward." },
    { "id": "request-b", "text": "The client lost its connection after sending the request. The transaction ledger has not been checked." }
  ]
}
JSON
```

Enter `/sieve on`, then paste this prompt into Pi:

```text
Call sieve_inspect with source "operation-demo" and mode "outcome".
Explain what each observation establishes about the requested update.
```

`source` is the filename without `.json`. Each observation is judged independently
as `completed`, `not_applied`, `partial`, or `unknown`. A timeout alone does not
establish whether an operation took effect. The tool does not prove overall task
completion or trigger a retry.

### Assess evidence for a hypothesis

Create a second batch:

```sh
mkdir -p .pi/sieve/observations
cat > .pi/sieve/observations/evidence-demo.json <<'JSON'
{
  "objective": "The described request applied the record update more than once.",
  "observations": [
    { "id": "audit-a", "text": "Two distinct committed update entries share the same request identifier." },
    { "id": "audit-b", "text": "The completion notification was delivered twice. No update ledger entries were retrieved." }
  ]
}
JSON
```

Paste into Pi:

```text
Call sieve_inspect with source "evidence-demo" and mode "evidence".
Explain whether each observation supports the stated hypothesis.
```

Labels are `supports`, `contradicts`, `unrelated`, or `insufficient`, relative to
that file's `objective`. This assesses each observation separately; it does not
combine them into a causal proof. Successful tool results contain `available`,
`reason`, `mode`, `objective`, and `judgments` with `id`, `label`, and `confidence`.
Labels and confidence come from the service; confidence is not a correctness guarantee.

### Retrieve a project memory

Create a Markdown file with an upload-approved description:

```sh
mkdir -p .pi/sieve/memories
cat > .pi/sieve/memories/retry-demo.md <<'MARKDOWN'
---
name: retry-demo
description: Retry checks for the fictional record-update service.
---

Check the transaction ledger before retrying a request with an unknown outcome.
Reuse the original idempotency key when a retry is justified.
MARKDOWN
```

Paste into Pi:

```text
Use sieve_search with query "retry checks after an unknown update outcome".
Summarize the returned guidance without executing any commands.
```

Command guides use the same format under `.pi/sieve/guides/`. Sieve keyword-ranks
candidate metadata, optionally asks Jev about relevance, and returns selected
bodies within a budget. Exact reference names take priority. Guides are reference
material, not commands Sieve executes; mandatory rules belong in `AGENTS.md`.

<details>
<summary>Advanced example: select a candidate action</summary>

For this fictional example, ask Pi to call `sieve_score` with the following
arguments and report the selection without executing it:

```json
{
  "context": "The update request timed out. Its transaction ledger has not been checked.",
  "question": "How much useful evidence would this action provide about whether the update committed?",
  "criteria": ["No relevant evidence", "Indirect evidence", "Direct evidence about the update"],
  "options": [
    { "id": "ledger", "content": "Inspect the transaction ledger for this request" },
    { "id": "notification", "content": "Inspect the completion notification log" }
  ]
}
```

Sieve scores each option, returns the highest-scoring option as `selected`, and
breaks ties by input order. The caller follows the selection without reranking;
Sieve itself does not execute or authorize it. Project rules and permissions still
apply. When unavailable, the result has `available: false` and `selected: null`.

Use this for substantial evidence comparisons, not obvious steps or routine tests.
Do not finish the same comparison before delegating it. This use case remains
experimental; no speed or accuracy benefit is established.

For repeated choices, save a project-authored profile with `question`, `criteria`,
and `options` under `.pi/sieve/decisions/<name>.json`, then supply only `profile`
and new `context`. Do not mix profile and inline fields. See the
[fictional decision profile](examples/decisions/payment-diagnostic.json).

</details>

### Confirm whether Jev was used

After a tool call, enter `/sieve status`:

| Reason | Meaning / next step |
| --- | --- |
| `none` | The latest Jev request succeeded. |
| `not_run` | No operation has completed since the last reset or enable action. |
| `disabled` | Jev is off; enter `/sieve on` to enable it. |
| `missing_key` | Enter `/login typesafe`, or configure the environment key. |
| `no_candidates` | Retrieval had no unnamed candidates to evaluate; explicitly named references can still be returned locally. |
| `timeout` | The request exceeded `timeoutMs`; inspect the fallback before deciding whether to allow a longer wait. |
| `invalid_input` | Check the source name, JSON fields, unique IDs, and size limits. |
| `invalid_config` | Check `.pi/sieve.json` against the supported settings. |
| `untrusted_project` | Use Pi's normal project-trust flow before accessing project data. |
| `service_error` / `invalid_response` | Jev did not provide a usable response; the tool reports its fallback. |

For a local-only comparison, enter `/sieve off` and repeat an inspection or search
prompt. No Jev request is made. This confirms the mode change, not relative accuracy.
If `/sieve` is unknown, check `pi list` in your terminal and `/reload` in Pi.

## Configuration

Configuration is optional. Create `.pi/sieve.json` in the target project, or merge
these settings into an existing file:

```json
{
  "enabled": true,
  "model": "jev-1.13.0",
  "timeoutMs": 1500
}
```

Changes apply to the next tool call. Keys and alternate API endpoints are not
accepted here. Unsupported fields and invalid values stop the operation.

| Setting | Default | Applies to |
| --- | --- | --- |
| `enabled` | `true` | All tools; `/sieve on` or `off` overrides it for the session. |
| `model` | `jev-1.13.0` | All Jev requests. |
| `timeoutMs` | `1500` | All Jev requests, including response reading. |
| `maxCandidates` | `40` | Retrieval shortlist and inspection item limit; inspection also caps at 40. |
| `memoryDirs` | `[".pi/sieve/memories"]` | Retrieval. |
| `guideDirs` | `[".pi/sieve/guides"]` | Retrieval. |
| `maxDocuments` | `6` | Maximum returned memories and guides combined. |
| `contextChars` | `8000` | Returned reference character budget. |
| `includeThreshold` | `0.5` | Relevance probability for unnamed references. |

Inspection files are limited to 32 KiB, 40 observations, 4,000 characters per
observation, and 2,000 for the objective. Scoring accepts 1–40 options and 2–10
rubric levels within a 64,000-byte request limit. Retrieval queries are limited to
8,000 characters; Markdown files over 64 KiB are skipped. Symlinks are not loaded.
An oversized reference body becomes a source pointer rather than a partial guide.
Timeouts and relevance thresholds are experimental defaults, not performance guarantees.

## Data and credentials

- Inspection sends the full objective and observation text to TypeSafe. Place only
  upload-approved data in the dedicated directory; Sieve does not redact its text.
- Retrieval sends the model-written query and authored candidate summaries, not
  reference bodies. Selected bodies go to your main-model provider.
- Scoring sends supplied context and the resolved question, rubric, and options.
  Model-written arguments can include information extracted from your conversation.

Credentials use Pi's resolver: saved TypeSafe credentials take precedence over
`TYPESAFE_API_KEY`. For non-interactive use, set that variable before starting Pi.
Sieve does not load `.env` files. Pi also supports secret-manager commands in
`auth.json`; see [Pi authentication](https://pi.dev/docs/latest/providers#key-resolution).
Pi stores literal keys as plain text, and its login dialog may display entered
text. Never put credentials in prompts, demo files, or project configuration.

Sieve adds no telemetry or conversation cache. Tool results, including raw fallback
observations, can be saved in Pi sessions. Status output omits request text and raw
service errors. To keep project data private, add `.pi/sieve/` and `.pi/sieve.json`
to that project's `.gitignore`. See [PRIVACY.md](PRIVACY.md) for full boundaries.

## Fallbacks and cache behavior

For valid inputs, missing credentials, disabled mode, timeouts, and unusable
responses return raw observations for inspection, bounded local results for
retrieval, or no scoring selection. There are no automatic retries. Invalid input,
invalid configuration, and untrusted projects return no private content.
Cancellation returns no stale results. New input and mode changes cancel pending
requests; session changes and reloads also reset mode overrides and diagnostics.

Sieve keeps its tool definitions fixed and appends ordinary tool messages. It does
not rewrite existing history or filter other skills and tools. This preserves
existing request prefixes from Sieve-induced changes, but new results still add
input, and provider cache hits depend on other factors. Cache hits are not guaranteed.

## Evaluation

An exploratory semantic-component comparison with Sol medium recorded **20.4%
fewer main-model tokens** (63,760 → 50,728, including cached input). Jev separately
used 42,105 input and 7,149 output tokens. Raw text was replaced by compact labels;
both arms still made two main-model requests per stage. Outcome agreement was
72/72 in both arms; evidence agreement was 72/72 versus 69/72, repeating one
label-boundary disagreement and yielding 0/3 strict Jev evidence-run successes.

These are 12 runs over 48 distinct authored observations, not completed coding
tasks. The experiment used a 10-second timeout; one Jev call exceeded the 1.5-second
default. No stable speed or total monetary-cost gain is established. See
[Pi Sieve Bench](https://github.com/yoonshilee/pi-sieve-bench) for the method,
sanitized per-run data, and limitations.

## More installation options

Install only for the current project:

```sh
pi install -l git:github.com/yoonshilee/pi-sieve
```

Pin the published version:

```sh
sieve_version=v1.0.0
pi install "git:github.com/yoonshilee/pi-sieve@$sieve_version"
```

Pinned installs stay on that tag; explicitly install a new tag to advance. Add
`-l` for project-only installs or removal. Reload Pi after changing installations.
To remove a saved credential, use `/logout` and select TypeSafe. Uninstalling does
not remove credentials; an environment key remains usable after logout.
No npm release is available. See [Pi packages](https://pi.dev/docs/latest/packages).

## Development, releases, and license

For a local checkout:

```sh
git clone https://github.com/yoonshilee/pi-sieve.git
cd pi-sieve
npm ci --ignore-scripts
pi -e ./src/index.ts
```

This loads the extension for one session. Use `pi install .` for a persistent local
installation and keep that checkout in place. See [CONTRIBUTING.md](CONTRIBUTING.md)
for checks, architecture, and release instructions.

[GitHub Releases](https://github.com/yoonshilee/pi-sieve/releases) describe published
versions; the current release is [v1.0.0](https://github.com/yoonshilee/pi-sieve/releases/tag/v1.0.0).
Public tool interfaces, configuration, and commands follow semantic versioning
within 1.x; model judgments and performance are not correctness or speed guarantees.

Licensed under [Apache-2.0](LICENSE). Independent of Pi and TypeSafe.
