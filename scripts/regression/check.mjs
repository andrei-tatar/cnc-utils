// The whole regression check in one go: records a baseline from a git ref
// (default master, checked out in a worktree under out/), records this
// checkout, and compares them.
//
//   node scripts/regression/check.mjs [--ref <ref>] [--fresh] [filter]
//
// The baseline is kept between runs (per ref and commit); --fresh records
// it again. The report (and overlays of what differs) is in out/report/.
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const out = path.join(here, "out");
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i < 0
    ? null
    : (args.splice(i, name.startsWith("--fresh") ? 1 : 2)[1] ?? true);
};
const ref = option("--ref") ?? "master";
const fresh = option("--fresh") !== null;
const filter = args[0];

const git = (...a) =>
  execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const commit = git("rev-parse", ref);
const tree = path.join(out, "base-src");
if (!fs.existsSync(tree)) {
  git("worktree", "add", "--detach", tree, commit);
} else {
  execFileSync("git", ["checkout", "--detach", "--quiet", commit], {
    cwd: tree,
  });
}
if (!fs.existsSync(path.join(tree, "node_modules"))) {
  fs.symlinkSync(
    path.join(root, "node_modules"),
    path.join(tree, "node_modules"),
  );
}

const run = (...a) => {
  const r = spawnSync(process.execPath, [path.join(here, "build.mjs"), ...a], {
    stdio: "inherit",
  });
  return r.status ?? 1;
};
const baseline = path.join(out, `baseline-${commit.slice(0, 10)}`);
if (fresh || !fs.existsSync(baseline)) {
  fs.rmSync(baseline, { recursive: true, force: true });
  console.log(`Baseline: ${ref} (${commit.slice(0, 10)})`);
  run("--src", tree, "record", baseline, ...(filter ? [filter] : []));
}
const current = path.join(out, "current");
fs.rmSync(current, { recursive: true, force: true });
console.log("\nThis checkout:");
run("record", current, ...(filter ? [filter] : []));
const report = path.join(out, "report");
fs.rmSync(report, { recursive: true, force: true });
console.log("");
process.exit(
  run("compare", baseline, current, report, ...(filter ? [filter] : [])),
);
