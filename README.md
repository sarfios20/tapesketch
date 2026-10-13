# tapesketch

Draw a room to exact measure and move the furniture around until it fits.

Use it at [tapesketch.com](https://tapesketch.com).

It is a single HTML file. There is no account and no server, and nothing leaves your browser. Type any length and it is kept exactly, shown to the millimeter (or 1/16 in). With the mouse, things snap to 0.5 cm (1/8 in); hold Shift to place them freely.

## What it does

- Walls with their real thickness. Type a length while you draw and the wall measures exactly that.
- Doors and windows on any wall (D and W).
- Furniture as rectangles, ellipses and L shapes, each with its label.
- Copies of the same room side by side, to try another layout without starting another project.
- Points such as an outlet or the water supply (P), and pieces that are the same in every copy, like a radiator.
- Lock the walls (B) to move the furniture without dragging a wall by mistake.
- Your own catalog: save any piece you have drawn, then rename, resize or delete it, and move the whole catalog between browsers as a JSON file.
- As many projects as you want, each one exported and opened again as a JSON file.
- Centimeters or feet and inches, and a light or dark theme.
- Export a PNG image of one copy or of all of them, a parts list, or a PDF to scale (1:50 or 1:100 on A4, 1/4" or 1/8" to the foot on Letter) that you can measure with a ruler.

## Run your own copy

Serve the folder with any static server, for example `python3 -m http.server`, and open it in the browser.

## Your data

Everything is saved in your browser's local storage. If you clear the site data, your projects go with it, so export the ones you care about.

Projects and the catalog are JSON files, described in [FORMAT.md](FORMAT.md), so you or an AI agent can write one and open it in the app.

## Tests

`./test.sh` needs node, python3, curl and Chrome or Chromium. It serves the folder, starts headless Chrome and runs every suite.

## License

MIT.
