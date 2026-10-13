# Contract 3: your own furniture catalog

Today the furniture menu is a fixed list per unit system. This development
lets people save their own pieces, with the shapes that already exist and any
dimensions, and manage them.

## Invariants

1. **One catalog for all projects.** It is the furniture you own, and it
   applies to any room. It lives in `localStorage`, under its own key, and
   never travels inside a project.
2. **A catalog piece is a template.** `{id, label, shape, w, h}`, plus
   `notchW` and `notchH` on an `l-shape` and nowhere else. No position, no
   angle: those are decided when the piece is placed. Lengths are cm, like
   everything else; the menu shows them in the current units.
3. **Strict, like projects.** Key `tapesketch.catalog`, value
   `{formatVersion: 1, pieces: [...]}`. Every field is required, a field
   outside the format is rejected, and the error names the path. The same
   schema walker as projects; no second validator. A corrupt catalog is set
   aside under `tapesketch.catalog.corrupt` and the app starts with an empty
   one.
4. **The built-in catalog stays as it is**, below the user's pieces.
5. **Nothing is overwritten by a name clash.** Saving or importing a piece
   whose label exists gets a free name (`desk 2`), as duplicating a project
   does today.
6. **No regressions.** `./test.sh` is green at the end of every task.

## The tools

- **Save selected piece**, at the top of the furniture menu, enabled when
  exactly one piece is selected. It is not a key: with one piece selected the
  keyboard types its label.
- **The furniture menu** in two blocks: "Yours" first, then the built-in
  pieces. One click places a piece, as today.
- **Manage catalog…**, at the bottom of the menu, opens a dialog like the
  project manager: per piece, rename, resize (typing `120x60`, parsed like on
  the canvas) and delete (with a confirm).
- **Export and import** the catalog as JSON, from that dialog. Import adds to
  what is there.

## Tasks, in order

1. Storage and schema, Save selected piece, and the "Yours" block.
2. The manager: rename, resize, delete.
3. Export and import.

Each task touches `index.html` and `tests/catalog.js` (added to the suite
list in `test.sh`), and is verified by `./test.sh`.

## Out of scope

Custom polygon shapes (they would change both formats, so they come with
`formatVersion` 2). Reordering the catalog by hand, folders or categories,
editing or hiding built-in pieces.
