#!/usr/bin/env bun
// Keeps the specification and the tests in step. The checks in docs/FLOWS.md (F-<section>.<n>) and the rules in
// docs/RULES.md (R-<group><n>) are defined by the first cell of their table rows; a test cites them by starting its
// name with their ids. This fails when:
//   - an id is defined twice;
//   - a test, a document or a code comment cites an id that is not defined (or a test cites a retired one);
//   - a check's Test column names a test that does not exist or does not cite it, or says "—" while a test cites it;
//   - fewer ids are covered by tests than BASELINE.
// It prints covered/total. Raise BASELINE when coverage grows; it never goes down.
//
//   bun run trace
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const BASELINE = 57;

const ROOT = join(import.meta.dir, "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const ID = /\b(F-\d+\.\d+|R-[A-Z]+\d+)\b/g;
const errors: string[] = [];

// Definitions: table rows whose first cell is an id.
type Def = { id: string; file: string; retired: boolean; tests: string[] | null };
const defs = new Map<string, Def>();
for (const file of ["docs/FLOWS.md", "docs/RULES.md"]) {
  for (const line of read(file).split("\n")) {
    const m = line.match(/^\|\s*(F-\d+\.\d+|R-[A-Z]+\d+)\s*\|/);
    if (!m) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (defs.has(m[1])) errors.push(`${m[1]} is defined twice (${defs.get(m[1])!.file} and ${file})`);
    const last = cells.at(-1)!;
    // FLOWS rows end with a Test column: test names separated by ";", or "—".
    const tests = file.endsWith("FLOWS.md") ? (last === "—" ? [] : last.split(/;\s*/)) : null;
    defs.set(m[1], { id: m[1], file, retired: /\bretired\b/i.test(line), tests });
  }
}

// Tests: the ids a test's name starts with.
const tests = new Map<string, string[]>();
for (const f of readdirSync(join(ROOT, "test")).filter((f) => f.endsWith(".test.ts"))) {
  for (const [, name] of read(join("test", f)).matchAll(/\btest\(\s*"([^"]+)"/g)) {
    const ids = name.match(/^(?:(?:F-\d+\.\d+|R-[A-Z]+\d+)\s+)+/)?.[0].trim().split(/\s+/) ?? [];
    if (!ids.length) errors.push(`test "${name}" cites no F- or R- id`);
    if (tests.has(name)) errors.push(`test "${name}" is named twice`);
    tests.set(name, ids);
    for (const id of ids) {
      if (!defs.has(id)) errors.push(`test "${name}" cites ${id}, which no document defines`);
      else if (defs.get(id)!.retired) errors.push(`test "${name}" cites ${id}, which is retired`);
    }
  }
}

// Every id mentioned in the documents and the code must exist.
const cited = ["README.md", "SECURITY.md", "CONTRIBUTING.md", "server.ts", "public/app.js", "public/index.html",
  ...readdirSync(join(ROOT, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`)].filter((f) => existsSync(join(ROOT, f)));
for (const f of cited) for (const [id] of read(f).matchAll(ID)) if (!defs.has(id)) errors.push(`${f} mentions ${id}, which no document defines`);

// The Test column of each check agrees with the tests.
const citing = (id: string) => [...tests].filter(([, ids]) => ids.includes(id)).map(([n]) => n);
for (const d of defs.values()) {
  if (!d.tests) continue;
  for (const n of d.tests) {
    if (!tests.has(n)) errors.push(`${d.id}: its Test column names "${n}", which is not a test`);
    else if (!tests.get(n)!.includes(d.id)) errors.push(`${d.id}: its Test column names "${n}", which does not cite it`);
  }
  for (const n of citing(d.id)) if (!d.tests.includes(n)) errors.push(`${d.id}: test "${n}" cites it, but its Test column does not name it`);
}

const live = [...defs.values()].filter((d) => !d.retired);
const covered = live.filter((d) => citing(d.id).length);
const share = (xs: Def[], p: string) => `${xs.filter((d) => d.id.startsWith(p) && citing(d.id).length).length}/${xs.filter((d) => d.id.startsWith(p)).length}`;
console.log(`trace: ${covered.length}/${live.length} ids covered by tests (checks ${share(live, "F-")}, rules ${share(live, "R-")}); ${tests.size} tests; baseline ${BASELINE}`);
if (covered.length < BASELINE) errors.push(`coverage fell to ${covered.length}, below the baseline of ${BASELINE}`);
if (covered.length > BASELINE) console.log(`trace: coverage is above the baseline; raise BASELINE in scripts/trace.ts to ${covered.length}`);
for (const e of errors) console.error(`trace: ${e}`);
process.exit(errors.length ? 1 : 0);
