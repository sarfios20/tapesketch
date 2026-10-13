# Contract 5: copies of a room

Trying another layout should not mean another project. A project holds
several copies of the room, side by side on the canvas, each with its own
walls and furniture.

## Invariants

1. **Format 2.** A project is `{name, formatVersion: 2, copies: [{name, walls,
   pieces}], shared: {points: [], pieces: []}, view, modifiedAt, isSample}`.
   A shared point is `{x, y, label}`; a shared piece is a piece. `shared`
   stays empty until contract 6. A version 1 project, stored or imported,
   migrates to one copy named "copy 1" and an empty `shared`. Every field is
   required, as in format 1. The storage key and the catalog do not change.
2. **One copy is active.** It is edited exactly as a project is today: every
   tool, undo, copy and paste. The others are drawn beside it, dimmed, in
   their own coordinates. A click on another copy makes it active, and the
   view shifts so nothing jumps on screen.
3. **A row, never overlapping.** Copies are laid out left to right, one
   stride apart. The stride is the widest copy plus 1 m, and it is computed,
   not stored. Each copy shows its name above it.
4. **Assisted.** "+ COPY" in the top bar duplicates the active copy, puts
   the new one at the end and activates it. A copy's name opens a small
   menu: rename, duplicate, delete (with a confirm; the last copy cannot be
   deleted). Each copy shows its problem count under its name.
5. **Exports follow the active copy**: PDF, PNG and parts list. One more PNG
   entry exports all copies side by side.
6. **Undo stays per copy**, like it is per project today.
7. **No regressions.** `./test.sh` is green at the end of every task.

## Tasks, in order

1. Format 2, migration and validation, with one copy behaving exactly as
   today.
2. Drawing the row, activating a copy, + COPY, and the name menu.
3. Problem count per copy, PNG of all copies, FORMAT.md and README.

Each task touches `index.html` and the tests that cover it, and is verified
by `./test.sh`.

## Out of scope

The shared layer (contract 6), moving copies by hand, applying walls to all
copies, and comparing copies in the PDF.
