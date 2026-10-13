// Wall face geometry without a browser: extract `isClosed` and `getWallFaces` from
// index.html and exercise them independently.
//
// A wall is stored as its axis, but drawn as a band of `thickness`.
// `getWallFaces` turns that axis into the two lines a piece sees, used
// for both snapping and the gap dimension.
const fileSystem = require('fs');
const path = require('path');

const html = fileSystem.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];

// Extract a script section using its header comments. If the file is
// reordered, fail here with the missing text instead of silently
// testing the wrong code.
const extractSection = (start, end) => {
  const startIndex = script.indexOf(start);
  if (startIndex < 0) throw new Error('cannot find the start: ' + start);
  const endIndex = script.indexOf(end, startIndex);
  if (endIndex < 0) throw new Error('cannot find the end: ' + end);
  return script.slice(startIndex, endIndex);
};

const source = extractSection('const isClosed = wall =>', '// A piece is stored') +
            extractSection('const WALL_FACE_INTERSECTION_TOLERANCE', '// All edges available for snapping');
const moduleExports = {};
new Function('exports', source + '\nexports.getWallFaces = getWallFaces;')(moduleExports);
const { getWallFaces } = moduleExports;

const createPoint = (x, y, thickness) => ({x, y, thickness:thickness, openings: []});
let failures = 0;
const runTest = (name, run) => {
  try { run(); console.log('OK   ' + name); }
  catch (error) { failures++; console.log('FAIL ' + name + '  ->  ' + error.message); }
};

// A wall 10 cm thick has faces 5 cm from its axis, so a room of
// 400 measures 390 inside and 410 outside.
runTest('closed room 400x400 with a wall of thickness 10', () => {
  const firstPoint = createPoint(0,0,10), secondPoint = createPoint(400,0,10), thirdPoint = createPoint(400,400,10), fourthPoint = createPoint(0,400,10);
  const [leftFace, rightFace] = getWallFaces([firstPoint,secondPoint,thirdPoint,fourthPoint,{...firstPoint}]);
  const getSize = points => {
    const xCoordinates = points.map(point => point.x), yCoordinates = points.map(point => point.y);
    return [Math.max(...xCoordinates)-Math.min(...xCoordinates), Math.max(...yCoordinates)-Math.min(...yCoordinates)];
  };
  const sides = [...getSize(leftFace), ...getSize(rightFace)].map(value => Math.round(value));
  if (!sides.includes(390) || !sides.includes(410))
    throw new Error('expected 390 and 410, got ' + sides.join('/'));
});

// Two consecutive clicks at the same point leave a zero-length wall segment,
// which the app allows. Such a segment has no direction or face, so it is
// skipped. If it crashes instead, `draw()` stops repainting and the app
// freezes with the project half drawn.
runTest('a zero-length wall segment does not crash the calculation', () => {
  const [leftFace] = getWallFaces([createPoint(0,0,10), createPoint(0,0,10), createPoint(300,0,10)]);
  if (!leftFace.length) throw new Error('no face was produced');
  if (leftFace.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y)))
    throw new Error('non-finite coordinates');
});

runTest('a wall with a single segment', () => {
  const [leftFace, rightFace] = getWallFaces([createPoint(0,0,10), createPoint(200,0,10)]);
  if (leftFace.length !== 2 || rightFace.length !== 2)
    throw new Error('expected 2 points per face, got ' + leftFace.length + '/' + rightFace.length);
});

runTest('with zero thickness both faces lie on the axis', () => {
  const [leftFace] = getWallFaces([createPoint(0,0,0), createPoint(100,0,0)]);
  if (Math.abs(leftFace[0].y) > 1e-9) throw new Error('the face moved away from the axis');
});

// A wall doubling back on itself sends the miter to infinity without a
// limit. With the limit it must fall back to a bevel and stay nearby.
runTest('a nearly 180 degree turn does not send the miter to infinity', () => {
  const [leftFace, rightFace] = getWallFaces([createPoint(0,0,10), createPoint(100,0,10), createPoint(0.5,0.5,10)]);
  const maximum = Math.max(...[...leftFace, ...rightFace].flatMap(point => [Math.abs(point.x), Math.abs(point.y)]));
  if (!(maximum < 1e6)) throw new Error('coordinate out of bounds: ' + maximum);
});

console.log(failures ? '\n' + failures + ' failure(s)' : '\nall OK');
process.exit(failures ? 1 : 0);
