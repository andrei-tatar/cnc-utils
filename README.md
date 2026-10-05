# CNC Utils

A browser-based CAM tool: draw 2D shapes, define your cutting tools and operations, preview the toolpaths in 3D, and download G-code. Everything runs locally in the browser — there's no backend and no account.

**Live:** https://cnc-utils.web.app

## How it works

The editor has three sections, worked top to bottom:

1. **Shapes** — what to cut.
2. **Tools** — the bits in your machine.
3. **Operations** — what to do: each operation picks a **tool** and a **shape**. G-code is generated in the order the operations are listed.

The 3D preview updates as you edit: shape outlines (with holes shown as holes), and toolpaths with arrows showing the direction of travel. Expand a shape to highlight just that shape and its toolpaths.

**Download G-code** saves a `.nc` file. The whole project is embedded in it as a comment, so **Load** on a `.nc` file restores the project exactly. Your work is also autosaved in the browser.

### Shapes

| Shape | |
| --- | --- |
| rectangle | width, height, corner radius |
| circle | diameter |
| line | an open path |
| path data | SVG path data (`d` attribute) |
| svg | an SVG file — click or drop a file onto the field |
| text | any text in a [Google Font](https://fonts.google.com/); size by cap height, letter/line spacing, alignment |
| boolean | union, intersection, difference or xor of two other shapes |
| copy of a shape | another shape's result (after its transforms), for this shape's own transforms: a transformed version next to the original that follows any change to it |

Each shape can have a chain of **transforms**, applied in order: move, align (put the left/middle/right and/or top/middle/bottom of the shape on a coordinate), rotate, scale, flip, repeat (grid arrays), offset (`clipper:inflate`) and convex hull.

### Tools

End mills and V-bits (angle and tip diameter). Feed rate, plunge rate and spindle speed are optional per tool: when set they're used while that tool cuts, otherwise the G-code section's defaults apply. A tool can also ramp in instead of plunging, at a set angle: pockets and v-carve clearings go round each step's first loop down to the next depth, profiles come down along the loop (on the pass with tabs, in the gap before a tab) or back and forth along open paths. Where a ramp wouldn't take the tool at least its radius away from the plunge point (a short gap between tabs, a loop smaller than the tool), it plunges instead. With several depth steps, each ramp carries on from where the one before ended: profiles keep going round the loop (or back along an open path) without lifting, and pockets start each level's ramp where the last level's ended. Leave the name empty and one is generated from the settings, e.g. "Ø6 mm 60° v-bit" — the same goes for shapes and operations.

### Operations

| Operation | Tool | |
| --- | --- | --- |
| profile | any | cut along the outline — outside, inside or on the line; climb or conventional; optional holding tabs (with an offset to move them along the toolpath). Profile the outlines and holes, only the holes, or the outlines with holes ignored |
| pocket | any | clear the inside of a shape in depth steps |
| flat | any | surface an area with parallel passes along X or Y |
| v-carve | V-bit | carve with a V-bit; the depth follows the shape's width, with sharp corners, a max depth and optional flat-bottom clearing — or no max depth, for a full, pointed V everywhere (down to the bit's cone, or all the way with a clearing first). Leave the stepover empty to carve in a single pass along the shape's centre line (its medial axis), each point at the depth that touches the nearest edge — far fewer moves, with sharp corners (up to the set angle) built in. Carve the outlines minus their holes, only the cuts around the holes (the same cuts, growing out from each hole and stopping halfway to the outer outline — e.g. a groove around letters cut out of a sign), or the outlines with holes ignored |
| v-carve clearing | end mill | rough out the bulk of a v-carve so the V-bit only finishes the walls; follows its v-carve automatically — list it **before** the v-carve. A V-bit alone can't go deeper than its cone (its shank would push through the uncut middle); with a clearing before it, the v-carve and the clearing go all the way to the max depth. |

Items with problems (a missing value, a deleted tool or shape, a v-carve on an end mill…) are outlined in red, with a "to fix" count on their section.

### G-code options

The **G-code** section sets how the program is written: safe height, default feed and plunge rates, tool changes (`T<n> M6`, a pause with `M0` for changing tools by hand — e.g. on GRBL, which doesn't support `M6` — or none), whether to skip tool changes when only one tool is used, spindle control (`M3 S<rpm>` with a spin-up wait, `M5` before tool changes and at the end), a `G90 G21 G17` header, returning to X0 Y0 at the end, the number of decimal places, and how precisely shapes are processed: the curve precision (how closely circles, arcs, SVG and text curves are followed) and the geometry precision (what offsets, pockets and shape booleans are rounded to). The program loads the first tool at the start and changes tools between operations that use different ones.

### Usage notes

- Units are millimetres. Depths are entered as positive numbers below the surface; Z = 0 is the top of the stock and travel moves happen at the safe height (10 mm by default).
- The editor and preview are separated by a draggable divider (double-click it to reset). Sections can be collapsed and every list can be reordered by dragging the ⠿ handle.
- Text shapes download fonts on demand from [Fontsource](https://fontsource.org) via jsDelivr and cache them in the browser. Each project stores the exact font version, so it always produces the same outlines. If the chosen font can't draw some characters, the font field says which.

> Always check the G-code in a simulator before running it on a machine.

## Development

Requires Node.js and npm.

```bash
npm install
npm start        # dev server at http://localhost:4200
npm run build    # production build into dist/
npm test         # Karma + Jasmine unit tests
```

Code is formatted with Prettier (`.prettierrc`).

Built with Angular 18 (standalone components, zoneless change detection), [ngx-formly](https://formly.dev) for the form-driven editor, Three.js for the preview, [Clipper2](https://github.com/AngusJohnson/Clipper2) (WebAssembly) for polygon offsetting and boolean operations, and [opentype.js](https://opentype.js.org) for fonts. Geometry runs in Web Workers so the UI stays responsive.

See [`CLAUDE.md`](CLAUDE.md) for an architecture overview: the reactive pipeline from model to shapes to G-code, the worker contract, and how to add a new shape, transform or operation.

### Deployment

The app is hosted on Firebase Hosting (project `cnc-utils`). GitHub Actions deploy every merge to the default branch to the live site and give each pull request a preview channel (`.github/workflows/`).
