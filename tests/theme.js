// The light theme in a real Chrome browser.
//
// The theme changes colors, including the canvas, but is a view setting and
// must leave the project alone. Check this boundary because failures can go
// unnoticed: it must stay out of `tapesketch.v1` and exported files, and
// changing it must neither add an undo entry nor change the timestamp that
// determines which project wins during synchronization.
const { open, createChecker } = require('./cdp.js');

const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const APP_URL = process.env.APP_URL || 'http://localhost:8080/';

// Canvas background color read from the bitmap: this verifies repainting
// of the drawing itself as well as the surrounding HTML. With the test view,
// (3,3) lies on clear background, away from the grid and walls.
const CANVAS_BACKGROUND = `(() => {
  const pixelData = ctx.getImageData(3, 3, 1, 1).data;
  return '#' + [pixelData[0], pixelData[1], pixelData[2]].map(value => value.toString(16).padStart(2, '0')).join('');
})()`;

const GROUND_COLOR = `getComputedStyle(document.documentElement)
                      .getPropertyValue('--ground').trim()`;

// Time for `saveProject()` to write localStorage, plus a small margin.
const SAVE_WAIT = 600;

(async () => {
  const page = await open(CDP_PORT, APP_URL);
  const { check, finish } = createChecker();

  // Start from scratch without saved data to check the initial theme.
  await page.evaluate(`localStorage.clear(); 'ok'`);
  await page.reload();

  check('without saved data, starts in dark mode',
            await page.evaluate(`document.documentElement.dataset.theme`) === 'dark');
  check('the button shows that the light theme is off',
            await page.evaluate(`themeButton.getAttribute('aria-pressed')`) === 'false');

  // A wall and a piece, with the view set manually to locate the grid.
  // Clear history just before drawing.
  await page.evaluate(`
    walls.length = 0; pieces.length = 0;
    walls.push([{x:0,y:0,thickness:10,openings:[]},{x:300,y:0,thickness:10,openings:[]}]);
    pieces.push({x:100, y:60, w:60, h:40, angle:0, shape:'rect', label:''});
    view.offsetX = 200; view.offsetY = 300; view.pxPerCm = 1;
    selection = {pieces:[], walls:[]}; selectedWallSegment = null; draft = null;
    history.length = 0; redoHistory.length = 0; snapshot = captureSnapshot();
    draw(); 'ready'
  `);
  await page.sleep(SAVE_WAIT);

  const darkCanvasBackground = await page.evaluate(CANVAS_BACKGROUND);
  check('in dark mode, the canvas uses the theme background',
            darkCanvasBackground === await page.evaluate(GROUND_COLOR),
            'canvas=' + darkCanvasBackground + ' css=' + await page.evaluate(GROUND_COLOR));

  const darkBodyBackground = await page.evaluate(`getComputedStyle(document.body).backgroundColor`);
  const historyLength = await page.evaluate(`history.length`);
  const modifiedAt = await page.evaluate(`projects[openProjectId].modifiedAt`);

  // Click the button as a user would, with the mouse over it. Settings live
  // in the `···` menu, so open it first as someone looking for them would.
  await page.evaluate(`moreButton.click(); 'ok'`);
  const buttonBounds = JSON.parse(await page.evaluate(`JSON.stringify(themeButton.getBoundingClientRect())`));
  const viewport = JSON.parse(await page.evaluate(`JSON.stringify([innerWidth, innerHeight])`));
  if (buttonBounds.left < 0 || buttonBounds.top < 0 || buttonBounds.right > viewport[0] || buttonBounds.bottom > viewport[1])
    throw new Error('the theme button is outside the viewport ' + viewport.join('x') +
                    ': ' + JSON.stringify(buttonBounds));
  await page.click((buttonBounds.left + buttonBounds.right)/2, (buttonBounds.top + buttonBounds.bottom)/2);

  check('the button switches to the light theme',
            await page.evaluate(`document.documentElement.dataset.theme`) === 'light');
  check('the button reflects the state',
            await page.evaluate(`themeButton.getAttribute('aria-pressed')`) === 'true');

  const lightBodyBackground = await page.evaluate(`getComputedStyle(document.body).backgroundColor`);
  check('the body background actually changes', lightBodyBackground !== darkBodyBackground,
            'before=' + darkBodyBackground + ' now=' + lightBodyBackground);

  const lightCanvasBackground = await page.evaluate(CANVAS_BACKGROUND);
  check('the canvas is repainted with the new color as well as the HTML',
            lightCanvasBackground !== darkCanvasBackground && lightCanvasBackground === await page.evaluate(GROUND_COLOR),
            'before=' + darkCanvasBackground + ' now=' + lightCanvasBackground +
            ' css=' + await page.evaluate(GROUND_COLOR));
  check('the canvas colors come from the selected theme',
            await page.evaluate(`colors.ground`) === await page.evaluate(GROUND_COLOR) &&
            await page.evaluate(`colors.line`) !== '',
            'colors.ground=' + await page.evaluate(`colors.ground`));

  // There is deliberately no letter shortcut: a selected piece owns the
  // keyboard and would consume it. Catch any shortcut added later.
  await page.press('t');
  check('no letter key changes the theme',
            await page.evaluate(`document.documentElement.dataset.theme`) === 'light');

  // --- the theme is separate from the project ---
  await page.sleep(SAVE_WAIT);

  check('changing the theme does not add a history entry',
            await page.evaluate(`history.length`) === historyLength,
            'before=' + historyLength + ' now=' + await page.evaluate(`history.length`));
  check('changing the theme preserves the project timestamp',
            await page.evaluate(`projects[openProjectId].modifiedAt`) === modifiedAt,
            'before=' + modifiedAt + ' now=' + await page.evaluate(`projects[openProjectId].modifiedAt`));

  check('the theme has its own storage key',
            await page.evaluate(`localStorage.getItem('tapesketch.theme')`) === 'light');
  check('the theme is not included in tapesketch.v1',
            !(await page.evaluate(`localStorage.getItem('tapesketch.v1')`)).includes('theme'),
            (await page.evaluate(`localStorage.getItem('tapesketch.v1')`)).slice(0, 200));

  // The same contents as `exportProject`, without downloading the file.
  const exportedProject = await page.evaluate(
    `(storeOpenProject(), JSON.stringify(projects[openProjectId], null, 1))`);
  check('the theme is not included in exported JSON',
            !exportedProject.includes('theme'), exportedProject.slice(0, 200));

  // --- the setting survives a reload ---
  await page.reload();
  check('the selected theme survives a reload',
            await page.evaluate(`document.documentElement.dataset.theme`) === 'light');
  check('the canvas is repainted in light mode',
            await page.evaluate(CANVAS_BACKGROUND) === await page.evaluate(GROUND_COLOR),
            'canvas=' + await page.evaluate(CANVAS_BACKGROUND));

  // Switching back also works. Settings live in the `···` menu, so open it
  // first as someone looking for them would.
  await page.evaluate(`moreButton.click(); 'ok'`);
  const secondButtonBounds = JSON.parse(await page.evaluate(`JSON.stringify(themeButton.getBoundingClientRect())`));
  await page.click((secondButtonBounds.left + secondButtonBounds.right)/2, (secondButtonBounds.top + secondButtonBounds.bottom)/2);
  check('switching back to dark mode saves the setting',
            await page.evaluate(`document.documentElement.dataset.theme`) === 'dark' &&
            await page.evaluate(`localStorage.getItem('tapesketch.theme')`) === 'dark');

  check('no uncaught page exceptions', page.exceptions.length === 0,
            page.exceptions.join(' | '));

  page.close();
  finish();
})().catch(error => { console.error('CRASH: ' + error.message); process.exit(2); });
