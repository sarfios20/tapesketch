// Copies of a room (contracts/5-copies.md), as a person uses them.
//
// What matters: the copies sit side by side without overlapping, a click
// on one makes it the one you edit without the canvas jumping, what you do
// in one copy stays in it (undo included), and the assisted actions (+ COPY,
// rename, duplicate, delete) do what they say and are saved.
const { open, createChecker, RECORD_DOWNLOADS } = require('./cdp.js');

const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const APP_URL = process.env.APP_URL || 'http://localhost:8080/';
const SAVE_WAIT = 500;

// Two copies of a 3 x 2 m room. Their union is 300 cm wide, so with the
// 1 m gap the stride is 400 cm. At 0.8 px/cm and an offset of (100, 150),
// copy 1 spans screen x 100..340 and copy 2 spans 420..660.
const room = () => [[
  {x: 0, y: 0, thickness: 10, openings: []}, {x: 300, y: 0, thickness: 10, openings: []},
  {x: 300, y: 200, thickness: 10, openings: []}, {x: 0, y: 200, thickness: 10, openings: []},
  {x: 0, y: 0, thickness: 10, openings: []},
]];
const piece = (label, x, y, w, h) => ({x, y, w, h, angle: 0, shape: 'rect', label});
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const SAVE = {openProjectId: PROJECT_ID, projects: {[PROJECT_ID]: {
  name: 'bedroom', formatVersion: 2,
  copies: [{name: 'copy 1', walls: room(), pieces: [piece('bed', 10, 10, 150, 180)]},
           {name: 'copy 2', walls: room(), pieces: [piece('desk', 200, 100, 90, 50)]}],
  shared: {points: [], pieces: []},
  view: {offsetX: 100, offsetY: 150, pxPerCm: 0.8}, modifiedAt: '2026-10-12T12:00:00.000Z', isSample: false}}};

(async () => {
  const page = await open(CDP_PORT, APP_URL, {
    beforeLoad: 'window.__dialogs = []; window.alert = message => window.__dialogs.push(message);' +
                'window.confirm = () => true; window.__promptAnswer = null; window.prompt = () => window.__promptAnswer;' +
                'localStorage.setItem("tapesketch.seen", "1");' + RECORD_DOWNLOADS,
  });
  const { check, finish } = createChecker();
  await page.evaluate(`localStorage.setItem('tapesketch.v1', ${JSON.stringify(JSON.stringify(SAVE))}); 'ok'`);
  await page.reload();
  page.exceptions.length = 0;

  // A label's text is the copy's name; its problem count, if any, is apart.
  const labels = () => page.evaluate(`[...document.querySelectorAll('#copy-labels .copy-label')].map(label => ({
    text: [...label.childNodes].filter(node => !(node.classList && node.classList.contains('copy-problems')))
      .map(node => node.textContent).join(''), isActive: label.getAttribute('aria-current') === 'true',
    left: label.getBoundingClientRect().left, bottom: label.getBoundingClientRect().bottom}))`);
  const screenX = worldX => page.evaluate(`convertToScreen({x: ${worldX}, y: 0}).x`);
  const screenY = worldY => page.evaluate(`convertToScreen({x: 0, y: ${worldY}}).y`);
  // Distance from the ground color, 0..255, of the most different pixel around a point.
  const ink = (x, y) => page.evaluate(`(() => {
    const ratio = window.devicePixelRatio || 1;
    const data = canvas.getContext('2d').getImageData(Math.round(${x}*ratio)-2, Math.round(${y}*ratio)-2, 5, 5).data;
    const ground = colors.ground.match(/[0-9a-f]{2}/gi).map(hex => parseInt(hex, 16));
    let most = 0;
    for (let offset = 0; offset < data.length; offset += 4)
      most = Math.max(most, ...[0, 1, 2].map(channel => Math.abs(data[offset+channel] - ground[channel])));
    return most; })()`);
  const menuButton = text => `[...document.querySelectorAll('#copy-menu button')].find(button => button.textContent.startsWith(${JSON.stringify(text)}))`;

  // --- the row ---
  let current = await labels();
  check('every copy shows its name, the active one marked',
        current.map(label => label.text + (label.isActive ? '*' : '')).join('|') === 'copy 1*|copy 2', JSON.stringify(current));
  check('the second copy sits one stride (widest copy plus 1 m) to the right, its name at its left edge, above it',
        Math.abs(current[1].left - await screenX(400)) < 2 && current[1].bottom <= await screenY(0),
        JSON.stringify(current) + ' expected left ' + await screenX(400));
  const copyTwoWall = [await screenX(550), await screenY(0)];
  const inkBefore = await ink(...copyTwoWall);
  check('the other copy is drawn', inkBefore > 15, String(inkBefore));

  // --- activating a copy ---
  const deskScreen = [await screenX(400 + 245), await screenY(125)];
  await page.click(await screenX(550), await screenY(100));
  check('a click on another copy makes it the active one, and starts nothing',
        await page.evaluate('activeCopyIndex') === 1 &&
        await page.evaluate('pieces.map(piece => piece.label).join()') === 'desk' &&
        await page.evaluate('draft === null'));
  check('and nothing jumps on screen: the desk is where it was',
        Math.abs(await page.evaluate('convertToScreen({x: 245, y: 125}).x') - deskScreen[0]) < 1 &&
        Math.abs(await page.evaluate('convertToScreen({x: 245, y: 125}).y') - deskScreen[1]) < 1);
  current = await labels();
  check('the marked name follows', current.map(label => label.isActive).join() === 'false,true', JSON.stringify(current));

  // What happens in a copy stays in it, undo included.
  await page.evaluate(`pieces.push(${JSON.stringify(piece('chair', 20, 20, 45, 45))}); draw()`);
  await page.click(await screenX(-400 + 150), await screenY(100));
  check('going back to the first copy keeps the change in the second',
        await page.evaluate('activeCopyIndex') === 0 &&
        await page.evaluate('pieces.map(piece => piece.label).join()') === 'bed' &&
        await page.evaluate('projects[openProjectId].copies[1].pieces.map(piece => piece.label).join()') === 'desk,chair');
  await page.press('z', {ctrl: true});
  check('undo in one copy does not undo what was done in another',
        await page.evaluate('pieces.map(piece => piece.label).join()') === 'bed' &&
        await page.evaluate('projects[openProjectId].copies[1].pieces.length') === 2);

  // --- + COPY ---
  await page.evaluate('addCopyButton.click()');
  current = await labels();
  check('+ COPY adds a copy of the active one at the end and activates it',
        current.map(label => label.text + (label.isActive ? '*' : '')).join('|') === 'copy 1|copy 2|copy 3*' &&
        await page.evaluate('pieces.map(piece => piece.label).join()') === 'bed', JSON.stringify(current));
  check('and the whole row is in view',
        current.every(label => label.left >= 0) &&
        await page.evaluate('convertToScreen({x: 300, y: 0}).x') <= await page.evaluate('canvas.clientWidth'),
        JSON.stringify(current));

  // --- the name menu ---
  await page.evaluate(`document.querySelectorAll('#copy-labels .copy-label')[1].click()`);
  check('a copy name opens its menu', await page.evaluate(`!document.getElementById('copy-menu').hidden`));
  await page.evaluate(`window.__promptAnswer = 'with desk'; ${menuButton('Rename')}.click()`);
  check('rename changes the name', (await labels())[1].text === 'with desk', JSON.stringify(await labels()));
  await page.evaluate(`document.querySelectorAll('#copy-labels .copy-label')[1].click(); ${menuButton('Duplicate')}.click()`);
  current = await labels();
  check('duplicate copies that copy, with a free name, to the end, and activates it',
        current.map(label => label.text + (label.isActive ? '*' : '')).join('|') === 'copy 1|with desk|copy 3|with desk 2*' &&
        await page.evaluate('pieces.map(piece => piece.label).join()') === 'desk,chair', JSON.stringify(current));
  await page.evaluate(`document.querySelectorAll('#copy-labels .copy-label')[3].click(); ${menuButton('Delete')}.click()`);
  current = await labels();
  check('delete removes the copy and activates another',
        current.map(label => label.text).join('|') === 'copy 1|with desk|copy 3' &&
        current.filter(label => label.isActive).length === 1, JSON.stringify(current));
  // Deleting the active first copy activates the next one, which must stay put.
  await page.evaluate('activateCopy(0)');
  const deskBefore = await page.evaluate('convertToScreen({x: 245 + getCopyLayout().stride, y: 125}).x');
  await page.evaluate(`document.querySelectorAll('#copy-labels .copy-label')[0].click(); ${menuButton('Delete')}.click()`);
  check('deleting the active first copy activates the next one without a jump',
        await page.evaluate('pieces.map(piece => piece.label).join()') === 'desk,chair' &&
        Math.abs(await page.evaluate('convertToScreen({x: 245, y: 125}).x') - deskBefore) < 1,
        await page.evaluate('convertToScreen({x: 245, y: 125}).x') + ' vs ' + deskBefore);
  await page.evaluate(`document.querySelectorAll('#copy-labels .copy-label')[0].click(); ${menuButton('Delete')}.click()`);
  await page.evaluate(`document.querySelectorAll('#copy-labels .copy-label')[0].click()`);
  check('the last copy cannot be deleted',
        (await labels()).length === 1 && await page.evaluate(`${menuButton('Delete')}.disabled`) === true);
  await page.press('Escape');

  // The copies are saved like everything else.
  await page.sleep(SAVE_WAIT);
  const stored = JSON.parse(await page.evaluate(`localStorage.getItem('tapesketch.v1')`)).projects[PROJECT_ID];
  check('the copies are saved', stored.copies.map(copy => copy.name).join('|') === 'copy 3', JSON.stringify(stored.copies.map(copy => copy.name)));
  // --- problems per copy and the PNG of all copies (task 3) ---
  // Copy 2 has a chair on its desk: one problem there, none in copy 1, and
  // each copy says so under its name whichever copy is active.
  const withProblem = JSON.parse(JSON.stringify(SAVE));
  withProblem.projects[PROJECT_ID].copies[1].pieces.push(piece('chair', 210, 110, 45, 45));
  await page.evaluate(`localStorage.setItem('tapesketch.v1', ${JSON.stringify(JSON.stringify(withProblem))}); 'ok'`);
  await page.reload();
  const problemCounts = () => page.evaluate(`[...document.querySelectorAll('#copy-labels .copy-label')].map(label => {
    const count = label.querySelector('.copy-problems');
    return count && !count.hidden ? count.textContent.trim() : ''; }).join('|')`);
  check('each copy shows its own problem count under its name', await problemCounts() === '|1 problem', await problemCounts());
  await page.evaluate('activateCopy(1)');
  check('and keeps showing it when another copy is active', await problemCounts() === '|1 problem', await problemCounts());
  check('findProblems takes any copy\'s walls and pieces',
        await page.evaluate('findProblems(projects[openProjectId].copies[0].walls, projects[openProjectId].copies[0].pieces).length') === 0 &&
        await page.evaluate('findProblems().length') === 1);

  // The shape of what a PNG shows: width over height of the box around every
  // pixel that differs from its top left corner (the background), leaving out
  // the bottom strip where the scale bar sits.
  const contentAspect = href => page.evaluate(`new Promise(resolve => {
    const image = new Image();
    image.onload = () => {
      const scratch = document.createElement('canvas');
      scratch.width = image.width; scratch.height = image.height;
      const context = scratch.getContext('2d');
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, image.width, image.height).data;
      let left = image.width, right = -1, top = image.height, bottom = -1;
      for (let y = 0; y < image.height*0.88; y++) for (let x = 0; x < image.width; x++){
        const offset = (y*image.width + x)*4;
        if ([0, 1, 2].some(channel => Math.abs(data[offset+channel] - data[channel]) > 24)){
          left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
      }
      resolve((right - left)/Math.max(1, bottom - top));
    };
    image.src = ${JSON.stringify(href)};
  })`);
  await page.evaluate('__downloads.length = 0; pngButton.click()');
  await page.evaluate(`document.getElementById('png-all-button').click()`);
  const downloads = await page.evaluate('__downloads.map(download => ({name: download.name, href: download.href}))');
  check('the export menu has a PNG of all copies, named apart',
        downloads.length === 2 && /^plan-copies-\d{4}-\d{2}-\d{2}\.png$/.test(downloads[1].name), JSON.stringify(downloads.map(download => download.name)));
  // One 3 x 2 m copy is about 1.5 times as wide as tall; two side by side
  // with a 1 m gap, about 3.5.
  const singleAspect = await contentAspect(downloads[0].href), allAspect = await contentAspect(downloads[1].href);
  check('the PNG of all copies shows them side by side, the plain PNG only the active one',
        singleAspect < 2 && allAspect > 2.5, singleAspect.toFixed(2) + ' vs ' + allAspect.toFixed(2));

  // --- found in review ---
  // The view is saved as seen from the first copy: reopening, which always
  // starts on the first copy, must put the row back where it was.
  await page.evaluate(`localStorage.setItem('tapesketch.v1', ${JSON.stringify(JSON.stringify(SAVE))}); 'ok'`);
  await page.reload();
  await page.evaluate('activateCopy(1); storeOpenProject(); saveProject()');
  await page.sleep(SAVE_WAIT);
  await page.reload();
  check('after working on a later copy, reopening puts the row where it was',
        Math.abs((await labels())[0].left - 100) < 1, JSON.stringify(await labels()));

  // Copy actions make the sample project yours, like drawing on it does:
  // otherwise creating a project deletes it, copies and all.
  for (const [action, run] of [
    ['+ COPY', 'addCopyButton.click()'],
    ['renaming a copy', `window.__promptAnswer = 'mine'; document.querySelector('#copy-labels .copy-label').click(); ${menuButton('Rename')}.click()`]]){
    await page.evaluate(`localStorage.clear(); localStorage.setItem('tapesketch.seen', '1'); 'ok'`);
    await page.reload();
    await page.evaluate(run);
    check(action + ' on the sample project makes it yours',
          await page.evaluate('projects[openProjectId].isSample') === false);
  }

  check('no page errors', page.exceptions.length === 0, page.exceptions.join(' | '));

  finish();
})();
