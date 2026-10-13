// Door and window tests. Check that they are placed where the mouse points
// without selecting anything first, as promised by the interface. Previously
// the wall segment had to be selected, with no indication of that requirement.
const {open, createChecker} = require('./cdp.js');

const {check, finish} = createChecker();

// A straight wall 4 m long, with the view fitted to locate it.
const WALL = `walls.length = 0; pieces.length = 0;
  walls.push([{x:0, y:0, thickness:10, openings:[]}, {x:400, y:0, thickness:10, openings:[]}]);
  setTool('select'); clearSelection(); fitDrawing(); draw()`;

const getOpenings = page => page.evaluate('JSON.stringify(walls[0][0].openings)').then(JSON.parse);

async function main(){
  const page = await open(process.env.CDP_PORT, process.env.APP_URL, {
    beforeLoad: 'window.__dialogs = []; window.alert = message => window.__dialogs.push(message);',
  });
  await page.evaluate('localStorage.clear()');
  await page.reload();
  await page.evaluate(WALL);

  // The screen position of the middle of the wall.
  const midpoint = JSON.parse(await page.evaluate('JSON.stringify(convertToScreen({x:200, y:0}))'));
  const pointAt = async (x, y) =>
    page.evaluate(`cursor = {x:${Math.round(x)}, y:${Math.round(y)}}; 'ok'`);

  // --- keyboard shortcut with no selection ---
  await pointAt(midpoint.x, midpoint.y);
  await page.press('d');
  let openings = await getOpenings(page);
  check('pointing at the wall, d places a door without any selection',
            openings.length === 1 && openings[0].kind === 'door' && openings[0].width === 80, JSON.stringify(openings));
  check('the door is placed at the pointer rather than an endpoint',
            Math.abs(openings[0].offset - 200) < 6, JSON.stringify(openings));
  check('without having to select the segment',
            await page.evaluate('selectedWallSegment') === null);

  await page.press('d');
  openings = await getOpenings(page);
  check('the same key over the door flips its swing',
            openings.length === 1 && openings[0].swing === -1, JSON.stringify(openings));
  await page.press('d');
  check('the third press removes it', (await getOpenings(page)).length === 0);

  await page.press('w');
  openings = await getOpenings(page);
  check('w places a window wider than the door',
            openings.length === 1 && openings[0].kind === 'window' && openings[0].width === 120, JSON.stringify(openings));
  await page.press('w');
  check('another w removes it', (await getOpenings(page)).length === 0);

  // A typed measurement overrides the default.
  for (const key of ['9', '0']) await page.press(key);
  await page.press('d');
  openings = await getOpenings(page);
  check('typing 90 first makes the door 90 wide',
            openings.length === 1 && openings[0].width === 90, JSON.stringify(openings));
  await page.evaluate('walls[0][0].openings.length = 0; draw()');

  // --- nothing happens away from the wall ---
  await pointAt(midpoint.x, midpoint.y - 200);
  await page.press('d');
  check('pointing away from walls places nothing', (await getOpenings(page)).length === 0);

  // --- also in wall mode, as the hint promises ---
  await page.evaluate('setTool("wall")');
  await pointAt(midpoint.x, midpoint.y);
  await page.press('d');
  check('the key also works in wall mode', (await getOpenings(page)).length === 1);
  await page.evaluate('walls[0][0].openings.length = 0; setTool("select"); draw()');

  // --- disabled when walls are locked ---
  await page.evaluate('toggleWallLock()');
  await pointAt(midpoint.x, midpoint.y);
  await page.press('d');
  check('no door is placed when walls are locked',
            (await getOpenings(page)).length === 0);
  check('the door tool cannot be activated either',
            await page.evaluate('doorToolButton.click(); tool') !== 'door',
            await page.evaluate('tool'));
  await page.evaluate('toggleWallLock()');

  // --- tool selected with the mouse ---
  await page.evaluate('doorToolButton.click()');
  check('the button activates door mode', await page.evaluate('tool') === 'door');
  await page.click(midpoint.x, midpoint.y);
  openings = await getOpenings(page);
  check('clicking on the wall places the door there',
            openings.length === 1 && openings[0].kind === 'door', JSON.stringify(openings));
  check('without selecting the segment as a side effect',
            await page.evaluate('JSON.stringify([selection.walls.length, selectedWallSegment])') === '[0,null]',
            await page.evaluate('JSON.stringify([selection.walls.length, selectedWallSegment])'));

  await page.evaluate('windowToolButton.click()');
  await page.click(midpoint.x + 80, midpoint.y);
  openings = await getOpenings(page);
  check('the window is placed beside the door without changing it',
            openings.length === 2 && openings.some(opening => opening.kind === 'window'), JSON.stringify(openings));

  check('the hint describes the available action',
            /Click on a wall to put a window/.test(await page.evaluate('hintPanel.textContent')),
            await page.evaluate('hintPanel.textContent'));

  await page.evaluate('setTool("select")');
  check('no uncaught exceptions', !page.exceptions.length, page.exceptions.join(' | '));
  page.close();
  finish();
}

main();
