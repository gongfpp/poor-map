import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const run = (cmd, args, cwd = process.cwd()) =>
  execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  }).trim();
if (run("git", ["status", "--porcelain"]))
  throw new Error("Please commit source changes before publishing Pages.");
const remote = run("git", ["remote", "get-url", "origin"]);
if (!/github\.com[:/]gongfpp\/poor-map(?:\.git)?$/.test(remote))
  throw new Error(
    "Pages publication requires the expected gongfpp/poor-map origin.",
  );
const sourceSha = run("git", ["rev-parse", "HEAD"]);
const author = run("git", ["log", "-1", "--format=%an"]),
  email = run("git", ["log", "-1", "--format=%ae"]);
execFileSync("npm", ["run", "build:pages"], { stdio: "inherit" });
const directory = mkdtempSync(path.join(tmpdir(), "poor-map-pages-"));
try {
  const exists = run("git", ["ls-remote", "--heads", remote, "gh-pages"]);
  if (exists)
    run("git", [
      "clone",
      "--single-branch",
      "--branch",
      "gh-pages",
      "--depth",
      "1",
      remote,
      directory,
    ]);
  else run("git", ["init", "--initial-branch=gh-pages", directory]);
  for (const name of readdirSync(directory))
    if (name !== ".git")
      rmSync(path.join(directory, name), { recursive: true, force: true });
  cpSync("pages-dist", directory, { recursive: true });
  writeFileSync(path.join(directory, ".nojekyll"), "");
  writeFileSync(
    path.join(directory, "deploy-meta.json"),
    JSON.stringify(
      {
        sourceSha,
        builtAt: new Date().toISOString(),
        mode: "pages-with-live-community",
      },
      null,
      2,
    ) + "\n",
  );
  run("git", ["config", "user.name", author], directory);
  run("git", ["config", "user.email", email], directory);
  run("git", ["add", "--all"], directory);
  run(
    "git",
    ["commit", "-m", `deploy: Pages from ${sourceSha.slice(0, 7)}`],
    directory,
  );
  run("git", ["push", remote, "HEAD:refs/heads/gh-pages"], directory);
  console.log(
    `Published static build from ${sourceSha.slice(0, 7)} to gh-pages; verify the live site after the Pages build completes.`,
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
