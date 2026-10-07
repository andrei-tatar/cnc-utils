# Regression harness

Runs projects through the app's real pipelines in Node — shapes, G-code,
toolpaths, job checks and the material-removal simulation — and compares two
runs geometrically, so a change to the geometry code (like replacing the
geometry library) can be checked against what the app did before.

```
npm run regression:check                 # master vs this checkout, everything
npm run regression:check -- vcarve       # only projects whose name has "vcarve"
npm run regression:check -- --ref <ref>  # another baseline
npm run regression:check -- --fresh      # record the baseline again
```

The report is `out/report/report.md`, with an SVG overlay for each check
that fails (baseline blue, now red). Everything under `out/` is ignored by
git.

## What runs

- every template in `templates/`;
- every fixture in `projects/*.ts`: small projects that together use every
  shape, transform and operation, and their options (see each fixture's
  `covers`).

## What's compared

Per project (tolerances at the top of `run.ts`):

- each shape's outlines: Hausdorff distance;
- the tabs on them: their footprints and tops;
- the material left after every cut (the simulation's heightmap, simulated
  with arcs followed far finer than the preview's), allowing an edge to move
  by a cell — this is what decides whether two runs cut the same;
- the job checks' warnings;
- reported, not failed: each operation's cutting moves in the material
  (Z ≤ 0), in 3D (Hausdorff distance, travel left out; plus the number of
  cuts and their length), the estimated time, and the G-code's size and arc
  count.

Order, direction and the split into separate cuts may change freely: what
must hold is the material cut.

Failing checks get an overlay SVG: the cuts or outlines (baseline blue, now
red), or for the material, dots over the shapes where more is left now (red)
or more is cut (blue).

## Accepted differences

`accepted.json` lists differences known to be intended, by project and by
check (the start of its name: `material left`, `warnings`, `tabs`,
`operation op-…`), each with the reason. They're reported as notes with the
reason instead of failing. Add one only once the difference is understood —
the reason should say why the new result is right (or as good).

## How

`build.mjs` bundles `run.ts` with esbuild, replacing the worker pool with
`fake-worker.ts` (work functions called in this process, their arguments and
results packed and unpacked like the real pool does) and `image-polyfill.ts`
standing in for the browser's image decoding (traced bitmaps). With
`--src <dir>`, the app's code comes from another checkout: that's how
`check.mjs` records the baseline from a worktree of the ref.

```
node scripts/regression/build.mjs [--src <dir>] record <out dir> [filter]
node scripts/regression/build.mjs compare <baseline> <current> <report dir> [filter]
```

Text shapes fetch their fonts from jsDelivr, so the first run needs the
network.
