// Lists the sample projects (samples/*.nc) in samples/index.json, which the
// app's Samples menu reads. Runs before start, build and test (npm pre-hooks);
// run `npm run samples` after adding a file while the dev server is running.
//
// A sample's name is its file name ("box-template.nc" → "Box template")
// unless the file has a "; name: …" comment line; a "; description: …" line
// adds a description.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "samples";

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

const samples = readdirSync(DIR)
  .filter((file) => file.endsWith(".nc"))
  .sort()
  .map((file) => {
    const lines = readFileSync(join(DIR, file), "utf8").split(/\r?\n/);
    if (!lines.some((line) => line.startsWith("; model="))) {
      console.warn(`samples: ${file} has no embedded project, left out`);
      return null;
    }
    return {
      file,
      name: comment(lines, "name") || nameFromFile(file),
      description: comment(lines, "description") ?? "",
    };
  })
  .filter(Boolean);

writeFileSync(join(DIR, "index.json"), JSON.stringify(samples, null, 2) + "\n");
console.log(`samples: ${samples.length} listed in ${DIR}/index.json`);
