import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fileIssues, textIssues } from "../scripts/check-privacy.mjs";

test("privacy checks reject private data without embedding real identities in fixtures", () => {
  const privateEmail = ["fixture", "personal", "invalid-domain", "com"].join(".").replace(".personal.", "@personal.");
  assert(textIssues(privateEmail).includes("private-email"));
  assert(textIssues(["", "Users", "fixture", "project"].join("/")).includes("personal-path"));
  assert(textIssues(["C:", "Users", "fixture", "project"].join("\\")).includes("personal-path"));
  assert(textIssues("written by fixture-user", ["fixture-user"]).includes("local-identity"));
  assert.deepEqual(textIssues("123+public-name@users.noreply.github.com docs@example.com"), []);
  assert.deepEqual(fileIssues("examples/sieve.json"), []);
  assert(fileIssues(".pi/sieve.json").includes("private-file"));
  assert(fileIssues(".env.local").includes("private-file"));
});

test("the staged-content check rejects a leak even when the working file is clean", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "sieve-privacy-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd });
  const privateText = ["", "home", "fixture", "private"].join("/");
  await writeFile(join(cwd, "note.md"), privateText);
  execFileSync("git", ["add", "note.md"], { cwd });
  await writeFile(join(cwd, "note.md"), "Clean working copy.");
  const script = fileURLToPath(new URL("../scripts/check-privacy.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script, "--staged"], { cwd, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert(result.stderr.includes("personal-path"));
  assert(!`${result.stdout}${result.stderr}`.includes(privateText));
});
