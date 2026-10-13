# The file formats

tapesketch saves two things, your projects and your catalog, and both travel as JSON files. You can write them by hand or have a program or an AI agent write them, then open them in the app. The app checks every field. It refuses a file with a missing field, a field it does not know or a newer version, and the message names the field, for example `Invalid project field "pieces[2].shape"`.

## Units and coordinates

- Lengths are in centimeters, whatever units the app shows.
- Angles are in radians.
- x grows to the right and y grows down, as on the screen. A positive angle turns clockwise.

## The project

`{name, formatVersion, copies, shared, view, modifiedAt, isSample}`

- `name`: a string. On import the project takes the file name instead: `bedroom.json` opens as "bedroom".
- `formatVersion`: 2. A version 1 file still opens: its walls and pieces become one copy named "copy 1".
- `copies`: one or more copies of the room. The app shows them left to right, but each copy has its own coordinates.
- `shared`: `{points, pieces}`, the things that are the same in every copy. They use the coordinates of the copies, so a shared item sits in the same spot in every copy.
- `view`: where the canvas looks when the project opens, as seen from the first copy. `offsetX` and `offsetY` are the screen position of the point (0, 0), in pixels, and `pxPerCm` is the zoom.
- `modifiedAt`: the date of the last change, as an ISO 8601 string.
- `isSample`: false.

### A copy

`{name, walls, pieces}`

- `name`: shown above the copy.
- `walls`: a list of walls. Each wall is a list of points, joined in order. If the last point repeats the first, the wall is a closed room and the app shows its area.
- `pieces`: the furniture.

### A wall point

`{x, y, thickness, openings}`

- `x`, `y`: a point on the wall's axis. The wall is drawn centered on that line.
- `thickness` and `openings` belong to the segment that starts at this point and ends at the next one. The last point of an open wall still needs them, but they are not used.
- `thickness`: 0 or more.

### An opening

`{offset, width, kind, swing}`

- `offset`: the distance from the segment's start to the center of the opening.
- `width`: more than 0.
- `kind`: `"door"` or `"window"`.
- `swing`: 1 or -1. A door hangs from its edge nearer the segment's start. Walking from the start of the segment to its end, 1 opens to your left and -1 to your right. A window does not use it but still needs it.

### A piece

`{x, y, w, h, angle, shape, label}`, plus `notchW` and `notchH` on an L.

- `x`, `y`: the top-left corner of the piece's box, before rotation.
- `w`, `h`: the width and depth of the box.
- `angle`: the rotation around the center of the box.
- `shape`: `"rect"`, `"ellipse"` (inscribed in the box) or `"l-shape"`.
- `notchW`, `notchH`: only on an `"l-shape"`. They give the size of the bite taken out of the top-right corner. To put the bite in another corner, rotate the piece.
- `label`: the text shown on the piece.

### A point

`{x, y, label}`

A point of interest, such as an outlet or the water supply. It is drawn as a dot with its label next to it. `label` can be empty.

### An example

A 3.40 × 3.00 m bedroom in two copies, with the bed on the left or on the right. The radiator under the window and the outlet are shared.

```json
{"name": "bedroom", "formatVersion": 2,
 "copies": [
  {"name": "bed on the left",
   "walls": [[
    {"x": 0,   "y": 0,   "thickness": 10, "openings": [{"offset": 170, "width": 120, "kind": "window", "swing": 1}]},
    {"x": 340, "y": 0,   "thickness": 10, "openings": []},
    {"x": 340, "y": 300, "thickness": 10, "openings": [{"offset": 60, "width": 80, "kind": "door", "swing": -1}]},
    {"x": 0,   "y": 300, "thickness": 10, "openings": []},
    {"x": 0,   "y": 0,   "thickness": 10, "openings": []}
   ]],
   "pieces": [
    {"x": 5,   "y": 40, "w": 160, "h": 200, "angle": 0, "shape": "rect", "label": "bed"},
    {"x": 275, "y": 5,  "w": 60,  "h": 120, "angle": 0, "shape": "rect", "label": "wardrobe"}
   ]},
  {"name": "bed on the right",
   "walls": [[
    {"x": 0,   "y": 0,   "thickness": 10, "openings": [{"offset": 170, "width": 120, "kind": "window", "swing": 1}]},
    {"x": 340, "y": 0,   "thickness": 10, "openings": []},
    {"x": 340, "y": 300, "thickness": 10, "openings": [{"offset": 60, "width": 80, "kind": "door", "swing": -1}]},
    {"x": 0,   "y": 300, "thickness": 10, "openings": []},
    {"x": 0,   "y": 0,   "thickness": 10, "openings": []}
   ]],
   "pieces": [
    {"x": 195, "y": 20,  "w": 140, "h": 190, "angle": 0, "shape": "rect", "label": "bed"},
    {"x": 5,   "y": 175, "w": 140, "h": 120, "angle": 0, "shape": "l-shape", "notchW": 80, "notchH": 60, "label": "desk"}
   ]}
 ],
 "shared": {
  "points": [{"x": 250, "y": 5, "label": "outlet"}],
  "pieces": [{"x": 120, "y": 5, "w": 100, "h": 10, "angle": 0, "shape": "rect", "label": "radiator"}]
 },
 "view": {"offsetX": 100, "offsetY": 80, "pxPerCm": 1.5},
 "modifiedAt": "2026-10-13T12:00:00.000Z", "isSample": false}
```

Open it with EXPORT → Open a project file. It always becomes a new project and never overwrites the one that is open.

## The catalog

`{formatVersion: 1, pieces: [{id, label, shape, w, h}]}`, plus `notchW` and `notchH` on an `"l-shape"`. A catalog piece has the same fields as a piece in a project, without position or angle. `id` is any string, unique in the file. Import the catalog from the furniture menu, with Manage catalog… → IMPORT JSON. It adds to what is already there: every piece gets a new id, and a label that clashes with an existing one gets a number, as in "desk 2".
