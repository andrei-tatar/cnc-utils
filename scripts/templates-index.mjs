// Lists the template projects (templates/*.nc) in templates/index.json, which the
// app's Templates menu reads. Runs before start, build and test (npm pre-hooks);
// run `npm run templates` after adding a file while the dev server is running.
//
// A template's name is its file name ("box-template.nc" → "Box template")
// unless the file has a "; name: …" comment line; a "; description: …" line
// adds a description, and "; group: …" the heading it's listed under (in the
// order of GROUPS, then any others alphabetically, then those without one
// under "Other"; by name within each).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "templates";

// The menu's headings, in order.
const GROUPS = [
  "Boxes & casework",
  "Kitchen & gifts",
  "Signs & inlays",
  "Shop & machine",
  "Rotary axis",
];
const OTHER = "Other";

function groupRank(group) {
  const known = GROUPS.indexOf(group);
  return known >= 0
    ? known
    : group === OTHER
      ? GROUPS.length + 1
      : GROUPS.length;
}

function comment(lines, key) {
  const prefix = `; ${key}:`;
  return lines
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length)
    .trim();
}

function nameFromFile(file) {
  const words = file.replace(/\.nc$/, "").replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const templates = readdirSync(DIR)
  .filter((file) => file.endsWith(".nc"))
  .sort()
  .map((file) => {
    const lines = readFileSync(join(DIR, file), "utf8").split(/\r?\n/);
    if (!lines.some((line) => line.startsWith("; model="))) {
      console.warn(`templates: ${file} has no embedded project, left out`);
      return null;
    }
    return {
      file,
      name: comment(lines, "name") || nameFromFile(file),
      description: comment(lines, "description") ?? "",
      group: comment(lines, "group") || OTHER,
    };
  })
  .filter(Boolean)
  .sort(
    (a, b) =>
      groupRank(a.group) - groupRank(b.group) ||
      a.group.localeCompare(b.group) ||
      a.name.localeCompare(b.name),
  );

writeFileSync(
  join(DIR, "index.json"),
  JSON.stringify(templates, null, 2) + "\n",
);
console.log(`templates: ${templates.length} listed in ${DIR}/index.json`);
