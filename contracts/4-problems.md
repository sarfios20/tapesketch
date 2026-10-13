# Contract 4: problems in red

The app marks what does not fit, as it happens: a piece that overlaps another
piece, cuts into a wall, or stands where a door swings. The same check is a
function an agent can call, so it gets in text what a person sees in red.

## Invariants

1. **Three problems, nothing else.** A piece overlaps a piece. A piece cuts
   into a wall's band (its axis plus half the thickness on each side). A piece
   enters a door's swing (the quarter circle the leaf sweeps). Windows, pieces
   outside every room and pieces stacked on purpose are not problems.
2. **Touching is not a problem.** A piece snapped flush against a wall face or
   against another piece is fine. Shapes count as overlapping only when they
   share more than 0.1 cm.
3. **Real shapes.** Ellipses, L shapes and rotated pieces are checked by their
   outline (`getOutline`), not their box.
4. **One function.** `findProblems()` returns
   `[{kind: 'overlap'|'wall'|'door', pieces: [index...], text}]`, with `text`
   reading like "chair overlaps bed". Drawing and agents both use it, and it
   does not change any data.
5. **Visible, never blocking.** Pieces in a problem are outlined in the danger
   color. The status bar shows the count, and the full list on hover. Nothing
   stops you from placing a piece anywhere.
6. **Fast enough to run on every redraw** with 50 pieces: a bounding-box test
   comes before the outline test.
7. **No regressions.** `./test.sh` is green at the end of every task.

## Tasks, in order

1. `findProblems()` in a new `// --- problems` section: each kind, flush
   contact as not a problem, a rotated L and an ellipse.
2. Drawing and status bar: red outline, count and list.

Each task touches `index.html` and `tests/problems.js` (added to the suite
list in `test.sh` by the first), and is verified by `./test.sh`.

## Out of scope

Windows and furniture in front of them, walking space between pieces,
suggestions on where to move a piece, and exports: PDF and PNG stay clean.
