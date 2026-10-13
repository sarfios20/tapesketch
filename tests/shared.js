// The shared layer (contracts/6-shared.md): what is the same in every copy.
//
// What matters: a shared piece is one object seen in every copy (moving it
// in one moves it everywhere), sharing and unsharing never make a piece
// disappear from a copy, problems are counted per copy with shared pieces
// in, and what is saved stays strict format 2.
const { open, createChecker } = require('./cdp.js');

const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const APP_URL = process.env.APP_URL || 'http://localhost:8080/';

const room = () => [[
  {x: 0, y: 0, thickness: 10, openings: []}, {x: 300, y: 0, thickness: 10, openings: []},
  {x: 300, y: 200, thickness: 10, openings: []}, {x: 0, y: 200, thickness: 10, openings: []},
  {x: 0, y: 0, thickness: 10, openings: []},
]];
const piece = (label, x, y, w, h) => ({x, y, w, h, angle: 0, shape: 'rect', label});
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
// Copy 1 has a bed, copy 2 a desk right under where the radiator is; the
// radiator is shared.
const SAVE = {openProjectId: PROJECT_ID, projects: {[PROJECT_ID]: {
  name: 'bedroom', formatVersion: 2,
  copies: [{name: 'copy 1', walls: room(), pieces: [piece('bed', 10, 10, 150, 180)]},
           {name: 'copy 2', walls: room(), pieces: [piece('desk', 200, 5, 90, 50)]}],
  shared: {points: [], pieces: [piece('radiator', 220, 5, 60, 10)]},
  view: {offsetX: 100, offsetY: 150, pxPerCm: 0.8}, modifiedAt: '2026-10-12T12:00:00.000Z', isSample: false}}};

(async () => {
  const page = await open(CDP_PORT, APP_URL, {
    beforeLoad: 'window.alert = () => {}; window.confirm = () => true; localStorage.setItem("tapesketch.seen", "1");',
  });
  const { check, finish } = createChecker();
  const restart = async () => {
    await page.evaluate(`localStorage.setItem('tapesketch.v1', ${JSON.stringify(JSON.stringify(SAVE))}); 'ok'`);
    await page.reload();
  };
  const labelsIn = expression => page.evaluate(`(${expression}).map(piece => piece.label).sort().join()`);
  const stored = () => page.evaluate('storeOpenProject(); JSON.parse(JSON.stringify(projects[openProjectId]))');
  const select = label => page.evaluate(`clearSelection(); selection.pieces.push(pieces.find(piece => piece.label === ${JSON.stringify(label)})); draw(); 'ok'`);
  const toggleButton = `readoutPanel.querySelector('.share-toggle')`;
  await restart();
  page.exceptions.length = 0;

  check('a shared piece is in the active copy, with its own pieces', await labelsIn('pieces') === 'bed,radiator');
  check('and in the others', await labelsIn('getCopyLayout().copies[1].pieces') === 'desk,radiator');
  check('problems count per copy, shared pieces included: the radiator is on the desk of copy 2 only',
        await page.evaluate(`[...document.querySelectorAll('#copy-labels .copy-problems')].map(count => count.hidden ? '' : count.textContent.trim()).join('|')`) === '|1 problem');

  // --- sharing ---
  await select('bed');
  check('with a piece selected, the panel offers "Same in every copy"',
        await page.evaluate(`${toggleButton} && ${toggleButton}.textContent.trim()`) === 'Same in every copy');
  // A real mouse click: the panel is redrawn often, and the button must
  // survive from press to release.
  const buttonBox = await page.evaluate(`(() => { const box = ${toggleButton}.getBoundingClientRect();
    return {x: box.left + box.width/2, y: box.top + box.height/2}; })()`);
  await page.click(buttonBox.x, buttonBox.y);
  let project = await stored();
  check('sharing moves it to the shared layer, and every copy shows it',
        project.copies[0].pieces.length === 0 && project.shared.pieces.map(piece => piece.label).sort().join() === 'bed,radiator' &&
        await labelsIn('getCopyLayout().copies[1].pieces') === 'bed,desk,radiator', JSON.stringify(project.shared));
  check('what is stored is strict format 2', await page.evaluate(`(() => {
    try { validateProject(JSON.parse(JSON.stringify(projects[openProjectId]))); return 'valid'; }
    catch (error){ return error.message; } })()`) === 'valid');

  // One object: move it here, it has moved there.
  await page.evaluate(`pieces.find(piece => piece.label === 'bed').x += 20; draw(); activateCopy(1); 'ok'`);
  check('a shared piece moved in one copy has moved in the others',
        await page.evaluate(`pieces.find(piece => piece.label === 'bed').x`) === 30);

  // --- unsharing, in copy 2 ---
  await select('bed');
  check('on a shared piece the panel offers "Only in this copy"',
        await page.evaluate(`${toggleButton}.textContent.trim()`) === 'Only in this copy');
  await page.evaluate(`${toggleButton}.click()`);
  project = await stored();
  check('unsharing gives every copy its own ordinary piece in that spot',
        project.shared.pieces.map(piece => piece.label).join() === 'radiator' &&
        project.copies.every(copy => copy.pieces.some(piece => piece.label === 'bed' && piece.x === 30)),
        JSON.stringify(project.copies.map(copy => copy.pieces.map(piece => piece.label))));

  // Unsharing wrote into the other copies: undoing it here would share the
  // piece again on top of their own beds.
  await page.press('z', {ctrl: true});
  project = await stored();
  check('unsharing cannot be undone into a duplicate',
        project.shared.pieces.map(piece => piece.label).join() === 'radiator', JSON.stringify(project.shared));

  // --- undo, paste ---
  await select('desk');
  await page.evaluate(`${toggleButton}.click()`);
  await page.press('z', {ctrl: true});
  project = await stored();
  check('sharing can be undone', project.shared.pieces.map(piece => piece.label).join() === 'radiator' &&
        project.copies[1].pieces.some(piece => piece.label === 'desk'), JSON.stringify(project.shared));
  await select('radiator');
  await page.evaluate('copySelection(); pasteSelection(); draw()');
  project = await stored();
  check('pasting a shared piece gives an ordinary one',
        project.shared.pieces.length === 1 && project.copies[1].pieces.filter(piece => piece.label === 'radiator').length === 1,
        JSON.stringify(project));
  // --- points (task 2) ---
  // An outlet in empty floor in both copies, and later a water point placed
  // on the bed of copy 1: points sit on anything and are never a problem.
  const withPoint = JSON.parse(JSON.stringify(SAVE));
  withPoint.projects[PROJECT_ID].shared.points.push({x: 230, y: 150, label: 'outlet'});
  await page.evaluate(`localStorage.setItem('tapesketch.v1', ${JSON.stringify(JSON.stringify(withPoint))}); 'ok'`);
  await page.reload();
  const screenOf = (x, y) => page.evaluate(`convertToScreen({x: ${x}, y: ${y}})`);
  // Distance from the ground color, 0..255, of the most different pixel around a point.
  const ink = ({x, y}) => page.evaluate(`(() => {
    const ratio = window.devicePixelRatio || 1;
    const data = canvas.getContext('2d').getImageData(Math.round(${x}*ratio)-1, Math.round(${y}*ratio)-1, 3, 3).data;
    const ground = colors.ground.match(/[0-9a-f]{2}/gi).map(hex => parseInt(hex, 16));
    let most = 0;
    for (let offset = 0; offset < data.length; offset += 4)
      most = Math.max(most, ...[0, 1, 2].map(channel => Math.abs(data[offset+channel] - ground[channel])));
    return most; })()`);
  check('a shared point is loaded with its label', await page.evaluate('points.map(point => point.label).join()') === 'outlet');
  check('it is a dot in the active copy and in the others',
        await ink(await screenOf(230, 150)) > 60 && await ink(await screenOf(400 + 230, 150)) > 25,
        (await ink(await screenOf(230, 150))) + ' / ' + (await ink(await screenOf(630, 150))));

  // The outlet is in the right half of the room: its label goes left of the
  // dot, as in the PDF, so the PNG and the PDF of a plan agree.
  const outlet = await screenOf(230, 150);
  const inkAlong = async direction => {
    let most = 0;
    for (let distance = 10; distance <= 40; distance += 2)
      most = Math.max(most, await ink({x: outlet.x + direction*distance, y: outlet.y}));
    return most;
  };
  check('a point in the right half of a copy has its label on the left',
        await inkAlong(-1) > 60 && await inkAlong(1) < 25, (await inkAlong(-1)) + ' / ' + (await inkAlong(1)));

  await page.press('p');
  check('P picks the point tool', await page.evaluate('tool') === 'point');
  const onBed = await screenOf(100, 150);
  await page.click(onBed.x, onBed.y);
  for (const key of 'water') await page.press(key);
  await page.press('Enter');
  check('a click places a point and the keyboard types its label',
        await page.evaluate('points.map(point => point.label).join()') === 'outlet,water' &&
        await page.evaluate('Math.abs(points[1].x - 100) < 1 && Math.abs(points[1].y - 150) < 1'));
  project = await stored();
  check('points are saved in the shared layer, strict format 2',
        project.shared.points.map(point => point.label).join() === 'outlet,water' && await page.evaluate(`(() => {
          try { validateProject(JSON.parse(JSON.stringify(projects[openProjectId]))); return true; }
          catch (error){ return error.message; } })()`) === true, JSON.stringify(project.shared.points));
  check('a point on a piece is not a problem', await page.evaluate('findProblems().length') === 0);

  await page.press('s');
  const to = await screenOf(150, 150);
  await page.drag(onBed.x, onBed.y, to.x, to.y);
  check('with the select tool a point is picked before the piece under it, and dragged',
        await page.evaluate('Math.abs(points[1].x - 150) < 1') && await page.evaluate(`pieces.find(piece => piece.label === 'bed').x`) === 10,
        await page.evaluate('JSON.stringify(points[1])'));
  await page.press('Delete');
  check('Delete removes the selected point', await page.evaluate('points.map(point => point.label).join()') === 'outlet');
  await page.press('z', {ctrl: true});
  check('and undo brings it back', await page.evaluate('points.map(point => point.label).join()') === 'outlet,water');
  // Enter with nothing typed keeps the label, as it does for a piece.
  const water = await screenOf(150, 150);
  await page.click(water.x, water.y);
  await page.press('Enter');
  check('Enter on a selected point with nothing typed keeps its label',
        await page.evaluate('points.map(point => point.label).join()') === 'outlet,water');

  await page.evaluate('activateCopy(1); points[0].x += 10; draw(); activateCopy(0)');
  check('a point moved in one copy has moved in the others', await page.evaluate('points[0].x') === 240);
  const pdf = await page.evaluate(`exportProjectToPdf({scale: 50, orientation: 'landscape', author: {name: '', company: ''}})`);
  check('points and their labels are in the PDF', pdf.includes('(water)') && pdf.includes('(outlet)'));
  // A plan as wide as the sheet allows, with a long label on its right edge:
  // drawn to the right of the dot, it ran off the page.
  const edge = await page.evaluate(`(() => {
    walls.length = 0; pieces.length = 0; points.length = 0;
    points.push({x: 0, y: 0, label: 'outlet'}, {x: 899, y: 0, label: 'washing machine water'});
    const pdf = exportProjectToPdf({scale: 50, orientation: 'portrait', author: {name: '', company: ''}});
    const pageWidth = Number(pdf.match(/MediaBox\\[0 0 ([0-9.]+)/)[1]);
    const left = Number(pdf.match(/([-0-9.]+) [-0-9.]+ Tm\\n\\(washing machine water\\) Tj/)[1]);
    return {left, right: left + measureTextWidth('washing machine water', FONT_SIZE.label), pageWidth}; })()`);
  check('a point label on the right edge of the plan stays on the PDF page',
        edge.left >= 0 && edge.right <= edge.pageWidth, JSON.stringify(edge));

  check('no page errors', page.exceptions.length === 0, page.exceptions.join(' | '));

  finish();
})();
