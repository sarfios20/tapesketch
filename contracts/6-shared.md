# Contract 6: the shared layer

Some things are the same in every copy of a room: the outlets, the water
point, the radiator. They are placed once and appear in every copy, in the
same place.

## Invariants

1. **No format change.** Format 2 already has `shared: {points: [{x, y,
   label}], pieces: [...]}`. Shared items use the copies' own coordinates, so
   a shared item sits in the same spot of every copy.
2. **Points of interest.** A new tool, Point (key P): a click places a point
   and the keyboard types its label, as with a piece. A point is a small dot
   with its label, drawn in every copy, in the PDF and in the PNG: it is what
   the electrician or the plumber needs. Selecting, dragging, deleting and
   undo work as for a piece. A point is never a problem.
3. **Shared pieces.** With pieces selected, "Same in every copy" moves them
   to the shared layer and they appear in every copy. Pressing it on shared
   pieces ("Only in this copy") gives every copy its own ordinary piece in
   that spot, so nothing disappears from any copy.
4. **One object, edited where you are working.** A shared piece or point is
   edited in the active copy with the usual tools; moving it there moves it
   in every copy. Pasting a shared piece gives an ordinary one.
5. **Recognisable.** A shared piece has a dashed outline. A point is a
   filled dot.
6. **Problems count per copy.** A shared radiator that overlaps the bed of
   copy 2 is a problem in copy 2.
7. **Strict at the edge.** In memory a shared piece may carry a flag; what
   is saved or exported is format 2 exactly, checked by `validateProject`.
8. **No regressions.** `./test.sh` is green at the end of every task.

## Tasks, in order

1. Shared pieces: editing, "Same in every copy", the dashed outline and
   problems.
2. Points: the tool, the label, dragging and deleting, and drawing them on
   the canvas, in the PDF and in the PNG.
3. FORMAT.md, README and the help panel.

Each task touches `index.html` and `tests/shared.js` (added to `test.sh` by
the first), and is verified by `./test.sh`.

## Out of scope

Hiding a shared item in a single copy, point kinds with icons (outlet, water,
gas), points in the parts list, points as snap targets, points in box
selection and copy and paste.
