import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

const PUBLIC_EMAIL = /^(?:\d+\+)?[\w-]+@users\.noreply\.github\.com$/i;
const EXAMPLE_EMAIL = /@(?:[\w.-]+\.)?(?:example\.(?:com|org|net)|[\w-]+\.(?:invalid|test|example))$/i;
const PRIVATE_PATH = /(?:\/(?:Users|home)\/[^\s/"'<>]+|[A-Z]:[\\/]Users[\\/][^\s\\/"'<>]+)/i;

export function textIssues(text, localValues = []) {
  const issues = new Set();
  if (PRIVATE_PATH.test(text)) issues.add("personal-path");
  const emails = text.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi) ?? [];
  if (emails.some((email) => !PUBLIC_EMAIL.test(email) && !EXAMPLE_EMAIL.test(email))) issues.add("private-email");
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) issues.add("private-key");
  for (const value of localValues.filter((item) => item && item.length >= 3)) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "i").test(text)) issues.add("local-identity");
  }
  return [...issues];
}

export function fileIssues(path) {
  const parts = path.replaceAll("\\", "/").split("/");
  const basename = parts.at(-1);
  return parts.some((part) => [".pi", "node_modules", "results", "coverage"].includes(part)) ||
    (basename.startsWith(".env") && basename !== ".env.example") || /\.(?:log|tgz|pem|key)$/i.test(basename)
    ? ["private-file"] : [];
}

export function run(args = process.argv.slice(2)) {
  const failures = new Set();
  let count = 0;
  let globalName = "";
  try { globalName = git(["config", "--global", "--get", "user.name"]).trim(); } catch { /* No global identity is valid. */ }
  let publicName = "";
  try { publicName = git(["config", "--local", "--get", "user.name"]).trim(); } catch { /* CI need not configure an author. */ }
  const localValues = process.env.CI ? [] : [homedir(), userInfo().username, globalName !== publicName ? globalName : ""];
  function check(path, body, mode = "100644") {
    count++;
    for (const issue of [...fileIssues(path), ...textIssues(path, localValues), ...textIssues(body, localValues)]) failures.add(issue);
    if (mode === "120000" || mode === "160000") failures.add("linked-content");
  }
  if (args.includes("--identity")) {
    for (const kind of ["GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"]) {
      const identity = git(["var", kind]).trim();
      const match = identity.match(/^(.+) <([^<>]+)> /);
      if (!match || !PUBLIC_EMAIL.test(match[2]) || match[1] !== publicName || textIssues(identity, localValues).length) failures.add("commit-identity");
    }
  }
  if (args.includes("--message")) {
    const path = args[args.indexOf("--message") + 1];
    for (const issue of textIssues(readFileSync(path, "utf8"), localValues)) failures.add(issue);
  } else if (args.includes("--history")) {
    const commits = git(["rev-list", "--all"]).trim().split("\n").filter(Boolean);
    const blobs = new Set();
    for (const commit of commits) {
      for (const issue of textIssues(git(["cat-file", "commit", commit]), localValues)) failures.add(issue);
      for (const line of git(["ls-tree", "-r", "-z", commit]).split("\0").filter(Boolean)) {
        const [metadata, path] = line.split("\t");
        const [mode, type, hash] = metadata.split(" ");
        for (const issue of fileIssues(path)) failures.add(issue);
        if (type === "blob" && !blobs.has(hash)) {
          check(path, git(["cat-file", "blob", hash]), mode);
          blobs.add(hash);
        }
      }
    }
  } else if (args.includes("--package")) {
    const packs = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    for (const file of packs[0].files) {
      if (!/^(?:src\/|examples\/|(?:package\.json|README\.md|CONTRIBUTING\.md|PRIVACY\.md|LICENSE)$)/.test(file.path)) failures.add("package-allowlist");
      check(file.path, readFileSync(file.path, "utf8"));
    }
  } else if (args.includes("--staged")) {
    for (const line of git(["ls-files", "--stage", "-z"]).split("\0").filter(Boolean)) {
      const [metadata, path] = line.split("\t");
      const [mode, hash, stage] = metadata.split(" ");
      if (stage !== "0") failures.add("unmerged-index");
      if (mode !== "160000") check(path, git(["cat-file", "blob", hash]), mode);
      else failures.add("linked-content");
    }
  } else {
    for (const path of new Set(git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean))) {
      let info;
      try { info = lstatSync(path); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
      if (info.isSymbolicLink()) failures.add("linked-content");
      else if (info.isFile()) check(path, readFileSync(path, "utf8"));
    }
  }
  if (failures.size) {
    console.error(`Privacy check failed (${[...failures].sort().join(", ")}). Matched content is withheld.`);
    return 1;
  }
  console.log(`Privacy check passed (${count} files checked).`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = run(); }
  catch { console.error("Privacy check could not complete. Verify Git, npm, and readable files; no content was printed."); process.exitCode = 1; }
}
