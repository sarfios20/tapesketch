# Contract 2: English

Starts when contract 1 is closed. Everything becomes English: identifiers,
comments, strings, DOM ids, CSS classes, storage keys, saved-format fields,
file names and tests. Behaviour does not change, except that the saved format
gets English field names (see below).

## Units

Lengths are centimetres in the model, always. Angles are radians. Screen
values are CSS pixels. Names carry no unit suffix for cm or radians; a value
in screen pixels says so (`screenX`, `radiusPx`).

## Naming

The language conventions rule:

- `camelCase` for variables and functions; `UPPER_SNAKE_CASE` for fixed
  module-level settings; `kebab-case` for HTML ids and CSS classes.
- Functions start with a verb (`openProject`, `drawWall`). Event handlers are
  `onX`. Booleans read as a question: `is`, `has`, `can`.
- Collections are plural, single items singular.
- No abbreviations except `x`, `y`, `w`, `h`, `id`, `cm`, `px`, `ctx`,
  `pdf`, `png`, `csv`, `json`. `sel`, `tmp`, `fmt`, `nSel` and friends get
  their full name.
- A DOM element variable ends in its role: `exportButton`, `helpPanel`.
  Elements are taken with `getElementById`, never as implicit globals.

## Glossary

Every task uses these terms and no synonyms.

| Spanish | English |
|---|---|
| plano / doc (a saved document) | project |
| pared, tramo | wall, wall segment |
| recinto (closed path) | room |
| hueco, puerta, ventana | opening, door, window |
| grosor | thickness |
| cara de pared | wall face |
| cota | dimension |
| imantar, paso | snap, snap step |
| mueble, pieza, rect | piece (a furniture item is a piece) |
| etiqueta | label |
| giro, asa | rotation, handle |
| cajetín, marca (nombre y empresa) | title block, author (name and company) |
| hoja, escala | sheet, scale |
| recuadro | selection box |
| historial, foto | history, snapshot |
| gestor de proyectos | project manager |
| bloqueo de paredes | wall lock |
| ejemplo, `demo` | sample project, `isSample` |
| listado de piezas | parts list |

## Saved format

| In the code today | In tapesketch |
|---|---|
| key `plano.v3` `{actual, docs}` | key `tapesketch.v1` `{openProjectId, projects}` |
| key `plano.marca` `{nombre, empresa}` | key `tapesketch.author` `{name, company}` |
| other `plano.*` keys | `tapesketch.*`, same meaning |
| doc `{nombre, version, paths, rects, V, tocado, demo}` | `{name, formatVersion: 1, walls, pieces, view, modifiedAt, isSample}` |
| wall point `{x, y, g, h}` | `{x, y, thickness, openings}` |
| opening `{d, w, t: 'puerta'\|'ventana', s}` | `{offset, width, kind: 'door'\|'window', swing}` |
| piece `{x, y, w, h, a, f: 'rect'\|'circulo'\|'L', lw, lh, txt}` | `{x, y, w, h, angle, shape: 'rect'\|'ellipse'\|'l-shape', notchW, notchH, label}` |
| view `V {ox, oy, ppc}` | `view {offsetX, offsetY, pxPerCm}` |

tapesketch knows nothing about any other app or older format. Version
numbers start at 1: the key version (`tapesketch.v1`) covers the wrapper, and
`formatVersion` covers the shape of a project and travels in exported files.

There is one format today, `formatVersion` 1. If it ever evolves, the new
version brings its own migration from the one before. Import accepts the
versions this code knows, and every field is required: a file missing one,
or with a newer version, is rejected with a message naming what failed. The old `localStorage` migrations and the
defaults that filled in missing fields (`a`, `f`, `g`, `h`, `s`, `lw`, `lh`)
are removed, with their tests.

## Tasks, in order

1. Saved format, in three passes, each renaming the fields in memory, in
   storage and in every test, and making its part strict:
   a. storage keys, wrapper, project fields and `view`; old migrations out.
   b. walls: `paths`, points and openings.
   c. pieces: `rects` and their fields.
2. HTML and CSS: ids, classes and the DOM element variables.
3. to 8. The script and the markup in six stretches, from section header to
   section header: each renames the names it declares (and every use,
   anywhere, tests included) and translates its comments. Uses of names
   declared in a later stretch wait for that stretch.
9. Tests: `pruebas/` becomes `tests/`, `pruebas.sh` becomes `test.sh`, with
   suites renamed and their text translated.

Each task is verified by the suite green plus no Spanish left in its range:
`grep -nE '[áéíóúñ¿¡]|\b(que|los|las|del|para|con|una|por)\b'` → nothing.
