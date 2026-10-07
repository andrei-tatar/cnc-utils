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
- each operation's cutting moves, in 3D: Hausdorff distance (travel left out),
  plus the number of cuts and their length;
- the material left after every cut (the simulation's heightmap), allowing
  an edge to move by a cell;
- the estimated time, the job checks' warnings, and the G-code's size and
  arc count (reported, not failed).

Order, direction and the split into separate cuts may change freely: what
must hold is the geometry cut.

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
