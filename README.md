# CNC Utils

A browser-based CAM tool for CNC routers: draw 2D shapes, define your bits and the operations that cut them, check the toolpaths and the simulated material in 3D, and download G-code. Everything runs locally in the browser — there's no backend and no account.

**Live:** https://cnc-utils.web.app

## How it works

The editor is worked top to bottom:

1. **Variables** — named values (and expressions) any number field can use.
2. **Shapes** — what to cut.
3. **Tools** — the bits in your machine.
4. **Operations** — what to do: each picks a **tool** and a **shape** (or the operation it belongs to). G-code follows the order they're listed in.
5. **Stock** — the material: its size, where the G-code's zero is, the wood, and whether it lies on the table or is held on a rotary axis.
6. **G-code** — how the program is written.

The 3D preview updates as you edit: shape outlines, toolpaths with arrows for the direction of travel, coloured by depth or by feed rate (click the legend, or C), the stock and the G-code's zero. Expand a shape or an operation to highlight it and its toolpaths. **Simulate** (S) shows the material left after every cut as a solid, at a quality you pick; the view options set the grid, its numbers and how the material looks (the stock's wood, grey clay, or the cuts coloured by depth). **Measure** (M) measures between two points. The preview also lists **checks before cutting**: cuts into the spoilboard, deeper than a bit's flutes or too heavy, corners a round bit leaves rounded, parts cut free without tabs, toolpaths near a clamp, and more.

**Download G-code** saves a `.nc` file with the whole project embedded as a comment, so **Load .nc** restores it exactly. The G-code menu can also split the program into one file per tool, write a cut list, and open a printable setup sheet. Work is autosaved in the browser, can be saved as named projects (the project menu), and has undo / redo (Ctrl+Z, Ctrl+Shift+Z). **Templates** opens example projects, grouped by kind: boxes & casework, kitchen & gifts, signs & inlays, shop & machine, rotary axis.

### Variables and expressions

Every number field takes an expression: `width / 2 + 3`, `sqrt(2) * side`, `1/4in`, `2cm` (numbers without a unit are mm). Variables can use the ones above them; the field suggests names (Ctrl+Space), colours the expression and shows what each part works out to on hover. Alt+Enter (or the expand button) edits a long expression in a dialog.

### Shapes

| Shape | |
| --- | --- |
| rectangle, circle, slot | the basics, with corner radius for rectangles |
| line, lines through points | open (or closed) paths through typed points |
| path data | SVG path commands, typed or pasted |
| svg | an SVG file — click or drop it onto the field |
| text | any [Google Font](https://fonts.google.com/); size by cap height, spacing, alignment |
| image trace | the outline of a picture's dark areas |
| points / hole pattern | drill points in a grid, on a circle or listed |
| box panel | a panel with finger joints |
| European hinge cup, bowtie | a 35 mm hinge cup with its screw holes; a butterfly key |
| boolean | union, intersection, difference or xor of other shapes |
| copy of a shape | another shape's result, for transforms of its own |
| nest parts on a sheet, with a nest's parts | lay out copies of other shapes on sheets; place dados and grooves wherever a nest's part goes |

A shape can be marked as a **clamp** (a keep-out zone the checks watch). Each shape has a chain of **transforms**, applied in order: move, align, rotate, scale, scale to size, flip, mirror copy, repeat (grid), polar array, offset, round / bevel corners, dogbone corners, simplify, convex hull, bounding rectangle, centre marks and **tabs** (holding tabs placed on the shape, kept by every operation that cuts it). Any shape can be exported as SVG.

### Tools

End mills, ball noses, bull noses, V-bits, drills and keyhole cutters, each with its number in the G-code (`T<n>`), flutes and flute length. Feed rate, plunge rate and spindle speed can be set per tool and overridden per operation; by default each operation **calculates** them from the cut it makes, the bit, the stock's wood and the machine. A tool can ramp into its cuts instead of plunging. The **library** keeps tools for every project, and exports / imports them as JSON.

### Operations

| Operation | Bit | |
| --- | --- | --- |
| profile | cutter | along the outline — outside, inside or on the line; climb or conventional; finishing pass, onion skin, arc lead-ins |
| pocket | cutter | clear the inside, offset or raster, in depth steps |
| rest machining | end mill | what a pocket's bigger bit couldn't reach |
| flat | cutter | surface an area with parallel passes |
| drill | any | holes at points or shape centres, with pecks, dwell, or canned cycles |
| helical bore | end mill | holes bigger than the bit, spiralling down |
| keyhole slot | keyhole cutter | plunge, run the slot, come back |
| chamfer | V-bit | bevel the edges of a part or the rim of a hole |
| v-carve | V-bit | depth following the shape's width, with sharp corners, a max depth and flat-bottom clearing — or a full V, or one pass along the centre line |
| v-carve clearing | end mill | rough out a v-carve so the V-bit only finishes the walls |
| v-carve inlay plug, flat inlay plug | V-bit / end mill | the plug for a v-carved or flat-bottomed inlay |
| image engraving, and its clearing | V-bit / end mill | engrave a picture, each line as deep as the image is dark |
| rotate, rotary repeat | — | with the stock on a rotary axis: turn it, or cut a list of operations at several angles |

Items with problems (a missing value, a deleted tool or shape, the wrong bit…) are outlined in red, with a "to fix" count on their section.

### Rotary axis (4th axis)

Held on a rotary axis — along X or Y, centred on it, a box or a cylinder, with the G-code's zero on the axis at the chuck's end (change the axis' direction and the app offers to turn the whole project with it) — the stock can be turned between operations for **indexed machining**: a **rotate** step turns it for the operations below; a **rotary repeat** cuts its own list of operations at several angles (evenly round a turn, a set angle apart, or over a range), e.g. a profile on every face. Each operation is cut as if from above with the stock turned; the G-code turns the axis (`G0 A…`, letter and direction configurable) at a safe height that clears the stock's corners, and the preview and simulation show every cut where it lands on the stock.

An operation can also be **wrapped round the stock**: draw it on the stock's surface unrolled (a square blank's on the circle its corners turn in — wrap a flat pass round one to turn it round) (outlined in the preview: once round is π × the diameter) and it's cut round it, the axis turning as the bit moves — lettering round a column, spiral (barley-twist) grooves, anything you can draw flat. The feed rate is kept along the surface: an F worked out per move, or inverse time (G93) for controllers that support it.

### G-code options

Safe height, default feeds, rapid speed (for the time estimate), tool changes (`T<n> M6`, a pause with `M0` to change by hand, or none), spindle control with a spin-up wait, a `G90 G21 G17` header, returning to X0 Y0, operation comments, arcs as `G2`/`G3`, shortening the travel between cuts, decimals and the curve and geometry precision. The machine sets the limits the feeds & speeds calculator works within.

### Usage notes

- Units are millimetres. Depths are entered as positive numbers below the surface; Z0 is the top of the stock (or its bottom, or the rotary axis — see the stock section), and travel moves happen at the safe height (5 mm by default).
- The editor and preview are separated by a draggable divider (double-click it to reset). Sections and items can be collapsed, cloned, switched off, and reordered by dragging the ⠿ handle.
- Text shapes download fonts on demand from [Fontsource](https://fontsource.org) via jsDelivr and cache them in the browser. Each project stores the exact font version, so it always produces the same outlines.

> Always check the G-code (and the simulation) before running it on a machine.

## Development

Requires Node.js 24.15 or newer (see `.nvmrc`; with nvm, run `nvm use`) and npm.

```bash
npm install
npm start                  # dev server at http://localhost:4200
npm run build              # production build into dist/
npm test                   # Karma + Jasmine unit tests
npm run regression:check   # every template and fixture through the real pipelines, compared with master
npm run kernel             # rebuild the geometry kernel (Rust → WebAssembly; needs cargo)
```

Code is formatted with Prettier (`.prettierrc`).

Built with Angular 22 (standalone components, zoneless change detection), [ngx-formly](https://formly.dev) for the form-driven editor, Three.js for the preview, and [opentype.js](https://opentype.js.org) for fonts. Geometry — booleans and offsets over lines and arcs, so arcs stay arcs — runs in our own kernel, written in Rust and compiled to WebAssembly (`kernel/`), with [CavalierContours](https://github.com/jbuckmccready/cavalier_contours) for offsetting. Geometry runs in Web Workers so the UI stays responsive; the built `.wasm` is committed, so building the app needs no Rust.

See [`CLAUDE.md`](CLAUDE.md) for an architecture overview: the reactive pipeline from model to shapes to G-code, the worker contract, the kernel, and how to add a new shape, transform or operation. The regression harness is described in [`scripts/regression/README.md`](scripts/regression/README.md).

### Deployment

The app is hosted on Firebase Hosting (project `cnc-utils`). GitHub Actions deploy every merge to the default branch to the live site and give each pull request a preview channel (`.github/workflows/`).
