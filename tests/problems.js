// Problems in red (contracts/4-problems.md): what findProblems() reports.
//
// What matters: a real, well furnished room reports nothing (pieces flush
// against walls and each other are fine), each of the three problems is
// found, and the check follows the real shape, not the box, so an L or an
// ellipse does not cry wolf in its empty corners.
const { open, createChecker } = require('./cdp.js');

const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const APP_URL = process.env.APP_URL || 'http://localhost:8080/';

// A 4.20 x 3.40 m bedroom with 10 cm walls: the inner faces are at 5 and 415
// across, 5 and 335 down. The door is on the bottom wall, hinged at x 400,
// and sweeps x 320..400, y 260..340 into the room.
const ROOM = [[
  {x: 0,   y: 0,   thickness: 10, openings: [{offset: 210, width: 120, kind: 'window', swing: 1}]},
  {x: 420, y: 0,   thickness: 10, openings: []},
  {x: 420, y: 340, thickness: 10, openings: [{offset: 60, width: 80, kind: 'door', swing: -1}]},
  {x: 0,   y: 340, thickness: 10, openings: []},
  {x: 0,   y: 0,   thickness: 10, openings: []},
]];
const piece = (label, x, y, w, h, extra = {}) => ({x, y, w, h, angle: 0, shape: 'rect', label, ...extra});
const FURNISHED = [
  piece('bed', 135, 5, 150, 200),
  piece('nightstand', 95, 5, 40, 40), piece('nightstand', 285, 5, 40, 40),   // flush with the bed
  piece('wardrobe', 5, 275, 120, 60),
  piece('desk', 355, 60, 60, 120), piece('chair', 305, 97, 45, 45, {shape: 'ellipse'}),
];

(async () => {
  const page = await open(CDP_PORT, APP_URL, {
    beforeLoad: 'window.alert = () => {}; window.confirm = () => true;',
  });
  const { check, finish } = createChecker();

  // Load walls and pieces into the open project and return what findProblems says.
  const problemsWith = async (pieces, walls = ROOM) => page.evaluate(`(() => {
    walls.length = 0; walls.push(...${JSON.stringify(walls)});
    pieces.length = 0; pieces.push(...${JSON.stringify(pieces)});
    return findProblems(); })()`);
  const texts = problems => problems.map(problem => problem.text).sort().join(' | ');

  const furnished = await problemsWith(FURNISHED);
  check('a furnished room with pieces flush against walls and each other has no problems',
        Array.isArray(furnished) && furnished.length === 0, JSON.stringify(furnished));

  const before = await page.evaluate('JSON.stringify([walls, pieces])');
  await page.evaluate('findProblems()');
  check('findProblems changes nothing', await page.evaluate('JSON.stringify([walls, pieces])') === before);

  // --- overlap ---
  const overlap = await problemsWith([piece('bed', 135, 5, 150, 200), piece('chair', 270, 100, 45, 45)]);
  check('two pieces that overlap are one problem, naming both, lower index first',
        overlap.length === 1 && overlap[0].kind === 'overlap' &&
        JSON.stringify(overlap[0].pieces) === '[0,1]' && overlap[0].text === 'bed overlaps chair', JSON.stringify(overlap));
  const barely = await problemsWith([piece('bed', 135, 5, 150, 200), piece('chair', 284.95, 100, 45, 45)]);
  check('sharing 0.05 cm is touching, not overlapping', barely.length === 0, JSON.stringify(barely));
  const unlabeled = await problemsWith([piece('', 135, 5, 150, 200), piece('chair', 270, 100, 45, 45)]);
  check('a piece without a label is called "unlabeled piece"',
        unlabeled.length === 1 && unlabeled[0].text === 'unlabeled piece overlaps chair', JSON.stringify(unlabeled));

  // --- wall ---
  const wall = await problemsWith([piece('bed', 135, 0, 150, 200)]);
  check('a piece into the band of a wall is a wall problem',
        wall.length === 1 && wall[0].kind === 'wall' && wall[0].text === 'bed cuts into a wall' &&
        JSON.stringify(wall[0].pieces) === '[0]', JSON.stringify(wall));
  const outside = await problemsWith([piece('sofa', 500, 100, 200, 90)]);
  check('a piece outside every room is not a problem', outside.length === 0, JSON.stringify(outside));

  // --- door ---
  const door = await problemsWith([piece('basket', 330, 280, 40, 40)]);
  check('a piece in the swing of a door is a door problem',
        door.length === 1 && door[0].kind === 'door' && door[0].text === 'basket blocks a door', JSON.stringify(door));
  const besideDoor = await problemsWith([piece('basket', 270, 295, 45, 40)]);
  check('a piece beside the swing, flush with the wall, is fine', besideDoor.length === 0, JSON.stringify(besideDoor));

  // --- real shapes ---
  // An L 140 x 120 with an 80 x 60 bite, turned half way: the bite is at the
  // bottom left, x 135..215, y 65..125 for a box at x 135, y 5.
  const turnedL = {x: 135, y: 5, w: 140, h: 120, angle: Math.PI, shape: 'l-shape', notchW: 80, notchH: 60, label: 'desk'};
  const inBite = await problemsWith([turnedL, piece('chair', 150, 75, 45, 45, {shape: 'ellipse'})]);
  check('a piece inside the bite of a turned L does not overlap it', inBite.length === 0, JSON.stringify(inBite));
  const onArm = await problemsWith([turnedL, piece('chair', 150, 20, 45, 45, {shape: 'ellipse'})]);
  check('a piece on the arm of a turned L overlaps it', texts(onArm) === 'desk overlaps chair', JSON.stringify(onArm));
  // A 100 cm round table leaves its box corners empty: a 12 cm stool there is clear.
  const corner = await problemsWith([piece('table', 150, 100, 100, 100, {shape: 'ellipse'}), piece('stool', 150, 100, 12, 12)]);
  check('a piece in the empty corner of an ellipse box does not overlap it', corner.length === 0, JSON.stringify(corner));

  // --- found in review ---
  // A doorway is not wall: a piece in the gap blocks the door, even on the
  // side the door does not swing to (here below the wall, outside the room).
  const doorway = await problemsWith([piece('crate', 340, 341, 40, 40)]);
  check('a piece in a doorway blocks the door and does not cut into a wall',
        texts(doorway) === 'crate blocks a door', JSON.stringify(doorway));

  // Walls meet in mitered corners: the outer corner square is wall too, at
  // the start of a closed room and between two segments.
  const corners = await problemsWith([piece('crate', -44, -44, 40, 40), piece('box', 424, -44, 40, 40)]);
  check('a piece into the outer corner of a room cuts into a wall',
        texts(corners) === 'box cuts into a wall | crate cuts into a wall', JSON.stringify(corners));
  // Curves are checked to within the tolerance, not to a coarse polygon. A
  // 20 cm square, turned to face the curve, entering it by 0.2 cm where a
  // 32-sided circle or a 12-sided door arc falls short of the true curve.
  const facing = (label, center, angle, distance) => {
    const x = center.x + Math.cos(angle)*(distance+10), y = center.y + Math.sin(angle)*(distance+10);
    return {x: x-10, y: y-10, w: 20, h: 20, angle, shape: 'rect', label};
  };
  const table = piece('table', 150, 100, 100, 100, {shape: 'ellipse'});
  const intoCircle = await problemsWith([table, facing('stool', {x: 200, y: 150}, 5.625*Math.PI/180, 49.8)]);
  check('a piece 0.2 cm into a round table overlaps it', texts(intoCircle) === 'table overlaps stool', JSON.stringify(intoCircle));
  const onCircle = await problemsWith([table, facing('stool', {x: 200, y: 150}, 5.625*Math.PI/180, 50)]);
  check('a piece touching a round table does not overlap it', onCircle.length === 0, JSON.stringify(onCircle));
  const angleIntoSwing = Math.PI + 41.25*Math.PI/180;
  const intoSwing = await problemsWith([facing('basket', {x: 400, y: 340}, angleIntoSwing, 79.8)]);
  check('a piece 0.2 cm into the swing of a door blocks it', texts(intoSwing) === 'basket blocks a door', JSON.stringify(intoSwing));

  // Every pair is reported once, and each kind on its own.
  const many = await problemsWith([piece('a', 100, 100, 50, 50), piece('b', 120, 120, 50, 50), piece('c', 140, 140, 50, 50)]);
  check('three pieces overlapping in a chain give each pair once',
        texts(many) === 'a overlaps b | a overlaps c | b overlaps c', texts(many));

  // --- on screen (task 2) ---
  // How red the outline of a piece is, from the canvas pixels around the
  // middle of its top edge: red minus green of the reddest one. The danger
  // color is far above 60 in both themes, the line color is near 0.
  const redness = index => page.evaluate(`(() => {
    const piece = pieces[${index}], ratio = window.devicePixelRatio || 1;
    const point = convertToScreen({x: piece.x + piece.w/2, y: piece.y});
    const data = canvas.getContext('2d').getImageData(Math.round(point.x*ratio)-2, Math.round(point.y*ratio)-2, 5, 5).data;
    let reddest = -255;
    for (let offset = 0; offset < data.length; offset += 4) reddest = Math.max(reddest, data[offset] - data[offset+1]);
    return reddest; })()`);
  const drawWith = async pieces => { await problemsWith(pieces); await page.evaluate('clearSelection(); draw()'); };

  // a and b overlap, c stands clear; all away from the walls, whose band is
  // drawn over the pieces.
  await drawWith([piece('a', 100, 100, 50, 50), piece('b', 120, 120, 50, 50), piece('c', 300, 100, 50, 50)]);
  check('a piece in a problem is outlined in the danger color', await redness(0) > 80, String(await redness(0)));
  check('a piece in no problem keeps its usual outline', await redness(2) < 30, String(await redness(2)));
  check('the status bar counts the problems and lists them on hover',
        await page.evaluate('!problemsNotice.hidden && problemsNotice.textContent.trim()') === '1 problem' &&
        await page.evaluate('problemsNotice.title') === 'a overlaps b',
        await page.evaluate('problemsNotice.textContent + " / " + problemsNotice.title'));
  check('the list can be hovered, although the status bar ignores the mouse',
        await page.evaluate('getComputedStyle(problemsNotice).pointerEvents') !== 'none');

  await drawWith([piece('a', 100, 100, 50, 50), piece('b', 120, 120, 50, 50), piece('c', 140, 140, 50, 50)]);
  check('several problems are counted in the plural, one per line',
        await page.evaluate('problemsNotice.textContent.trim()') === '3 problems' &&
        await page.evaluate('problemsNotice.title') === 'a overlaps b\na overlaps c\nb overlaps c',
        await page.evaluate('problemsNotice.textContent + " / " + JSON.stringify(problemsNotice.title)'));

  // A selected piece in a problem is red too: dragging one onto another must show it.
  await problemsWith([piece('a', 100, 100, 50, 50), piece('b', 120, 120, 50, 50)]);
  await page.evaluate('clearSelection(); selection.pieces.push(pieces[0]); draw()');
  check('a selected piece in a problem is outlined in the danger color', await redness(0) > 80, String(await redness(0)));

  await drawWith(FURNISHED);
  check('with no problems the notice is hidden', await page.evaluate('problemsNotice.hidden'));

  // The PNG export draws the same canvas code: it must come out clean.
  await problemsWith([piece('a', 100, 100, 50, 50), piece('b', 120, 120, 50, 50)]);
  await page.evaluate('clearSelection(); isExporting = true; draw()');
  const exportedRedness = await redness(0);
  await page.evaluate('isExporting = false; draw()');
  check('while exporting, problems are not drawn', exportedRedness < 30, String(exportedRedness));

  finish();
})();
