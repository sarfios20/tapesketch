// Wall lock in a real Chrome browser.
//
// Locking disables selection and drawing, while keeping geometry active: locked
// walls still provide snapping targets and count towards the gap dimension.
// That second part can break unnoticed, so it is checked separately.
const { open, createChecker } = require('./cdp.js');

const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const APP_URL = process.env.APP_URL || 'http://localhost:8080/';

(async () => {
  const page = await open(CDP_PORT, APP_URL);
  const { check, finish } = createChecker();

  // A horizontal wall 300 cm long and 10 cm thick, and a separate piece.
  await page.evaluate(`
    localStorage.clear();
    walls.length = 0; pieces.length = 0;
    walls.push([{x:0,y:0,thickness:10,openings:[]},{x:300,y:0,thickness:10,openings:[]}]);
    pieces.push({x:100, y:60, w:60, h:40, angle:0, shape:'rect', label:''});
    view.offsetX = 200; view.offsetY = 300; view.pxPerCm = 1;
    selection = {pieces:[], walls:[]}; selectedWallSegment = null; draft = null;
    areWallsLocked = false; setTool('select');
    draw(); 'ready'
  `);

  const wallPosition = JSON.parse(await page.evaluate(`JSON.stringify(convertToScreen({x:150, y:0}))`));

  // Without this control the next check would prove nothing: if clicking did
  // not select an unlocked wall, the locked check would pass for the wrong reason.
  await page.click(wallPosition.x, wallPosition.y);
  check('control: clicking selects an unlocked wall',
            await page.evaluate(`selection.walls.length`) === 1);

  await page.evaluate(`selection = {pieces:[], walls:[]}; selectedWallSegment = null; draw(); 'ok'`);
  await page.press('b');
  check('the B key enables wall lock', await page.evaluate(`areWallsLocked`) === true);
  check('the toolbar button reflects the state',
            await page.evaluate(`wallLockButton.getAttribute('aria-pressed')`) === 'true');

  await page.click(wallPosition.x, wallPosition.y);
  check('when locked, clicking does not select the wall',
            await page.evaluate(`selection.walls.length`) === 0 && await page.evaluate(`selectedWallSegment`) === null);

  const vertexPosition = JSON.parse(await page.evaluate(`JSON.stringify(convertToScreen({x:0, y:0}))`));
  check('when locked, a vertex cannot be picked either',
            await page.evaluate(`pickVertex(${vertexPosition.x}, ${vertexPosition.y})`) === null);

  await page.evaluate(`finishSelectionBox({origin:{x:-50,y:-50}, end:{x:350,y:120}, isAdditive:false}); 'ok'`);
  check('when locked, the selection box selects pieces but leaves walls out',
            await page.evaluate(`selection.walls.length`) === 0 && await page.evaluate(`selection.pieces.length`) === 1,
            'walls=' + await page.evaluate(`selection.walls.length`) +
            ' pieces=' + await page.evaluate(`selection.pieces.length`));

  await page.press('a', {ctrl: true});
  check('when locked, Ctrl+A leaves walls out of the selection',
            await page.evaluate(`selection.walls.length`) === 0 && await page.evaluate(`selection.pieces.length`) === 1);

  await page.evaluate(`selection = {pieces:[], walls:[]}; draw(); 'ok'`);
  await page.press('l');
  check('when locked, wall mode cannot be entered',
            await page.evaluate(`tool`) !== 'wall', 'tool=' + await page.evaluate(`tool`));

  // The inner face of this wall is at y=5. A piece at 5.3 must
  // move up 0.3 to snap to it.
  const adjustment = JSON.parse(await page.evaluate(`
    (() => { const piece = {x:100, y:5.3, w:60, h:40, angle:0, shape:'rect', label:''};
      return JSON.stringify(snapMovement(piece, 0, 0, [piece])); })()
  `));
  check('when locked, pieces still snap to the wall',
            Math.abs(adjustment.deltaY - (-0.3)) < 1e-6, 'adjustment=' + JSON.stringify(adjustment));

  // From y=60 upwards the face is 55 away, while the axis is 60 away.
  const distance = await page.evaluate(`getFirstIntersectionDistance({x:150, y:60}, 0, -1, [])`);
  check('when locked, the gap dimension still sees the wall',
            Math.abs(distance - 55) < 1e-6, 'distance=' + distance);

  // Clear the selection first: with a single selected piece, the keyboard
  // belongs to its label and consumes every letter, including B. This predates
  // wall lock and also affects S, L and R.
  await page.evaluate(`selection = {pieces:[], walls:[]}; draw(); 'ok'`);
  await page.press('b');
  check('B unlocks walls', await page.evaluate(`areWallsLocked`) === false);
  await page.click(wallPosition.x, wallPosition.y);
  check('when unlocked, the wall can be selected again',
            await page.evaluate(`selection.walls.length`) === 1);

  check('no uncaught page exceptions', page.exceptions.length === 0,
            page.exceptions.join(' | '));

  page.close();
  finish();
})().catch(error => { console.error('CRASH: ' + error.message); process.exit(2); });
