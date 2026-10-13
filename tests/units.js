// The metric-to-imperial switch in a real Chrome browser.
//
// Projects are ALWAYS saved in centimetres: feet and inches are used only
// for display and typed input. Breaking this silently corrupts existing
// projects until someone measures with a ruler. Check both sides: display
// and input use the selected units, while project data stays independent.
//
// Also check that rounding to 1/16 inch loses no millimetres on a round trip,
// invalid measurements throw instead of being partially parsed, snapping
// changes with the units, and imperial PDFs use Letter and a true
// 1/4 inch = 1 foot scale measured on paper.
const {open, createChecker} = require('./cdp.js');

const {check, finish} = createChecker();

const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const APP_URL = process.env.APP_URL || 'http://localhost:8080/';

// Dialogs would hang a headless Chrome test. The language that determines
// the initial units is read from localStorage: headless Chrome always reports
// en-US, and tests need to change it between reloads without a new browser.
const STUBS = 'window.__dialogs = [];' +
              'window.alert = message => window.__dialogs.push(message);' +
              'window.confirm = () => true;' +
              'window.prompt = () => window.__email;' +
              "Object.defineProperty(navigator, 'language', " +
              "{get: () => localStorage.getItem('__language') || 'es-ES'});";

// One centimetre and one inch on paper in PDF units (1/72 inch).
const PDF_UNITS_PER_CM = 72/2.54;
const PDF_UNITS_PER_INCH = 72;

const IMPERIAL_SNAP_STEP = 2.54/8;   // imperial snap step in cm
const TOLERANCE = 0.001;

// Time for `saveProject()` to write localStorage, plus a small margin.
const SAVE_WAIT = 500;

// A single 300 cm wall with its segment selected: this allows typing a
// measurement and displays the chip with the thickness.
const WALL_SEGMENT = `
  walls.length = 0; pieces.length = 0;
  walls.push([{x:0,y:0,thickness:10,openings:[]},{x:300,y:0,thickness:10,openings:[]}]);
  selectedWallSegment = {type:'wall-segment', wall:walls[0], index:1};
  selection = {pieces:[], walls:[walls[0]]};
  draft = null; typed = '';
  history.length = 0; redoHistory.length = 0; snapshot = captureSnapshot();
  draw(); 'ready'`;

const getStream = pdf => pdf.slice(pdf.indexOf('stream\n') + 7, pdf.indexOf('\nendstream'));

// Lengths of the two-point lines drawn by the PDF, in PDF units. A two-point
// wall face is exactly such a line, so these are the lengths a ruler measures.
const getLineLengths = pdf =>
  [...getStream(pdf).matchAll(/([-\d.]+) ([-\d.]+) m\n([-\d.]+) ([-\d.]+) l\nS/g)]
    .map(match => Math.hypot(+match[3] - +match[1], +match[4] - +match[2]));

const hasLength = (pdf, expected) => getLineLengths(pdf).some(value => Math.abs(value - expected) < TOLERANCE);

async function main(){
  const page = await open(CDP_PORT, APP_URL, {beforeLoad: STUBS});

  // Type and apply a measurement using actual keyboard events.
  const typeMeasurement = async text => {
    for (const key of text) await page.press(key);
    await page.press('Enter');
  };

  // Restart the app from scratch with the supplied language.
  const restartWithLanguage = async (language, units) => {
    await page.evaluate(`localStorage.clear();` +
                    `localStorage.setItem('__language', ${JSON.stringify(language)});` +
                    (units ? `localStorage.setItem('tapesketch.units', '${units}');` : '') +
                    `'ok'`);
    await page.reload();
  };

  // --- initial units ---
  await restartWithLanguage('en-US');
  check('an en-US browser starts in feet and inches',
            await page.evaluate('unitSystem') === 'imperial',
            await page.evaluate('unitSystem'));
  check('the button reflects the units',
            await page.evaluate(`unitsButton.getAttribute('aria-pressed')`) === 'true');

  await restartWithLanguage('es-ES');
  check('other browser languages start in centimetres',
            await page.evaluate('unitSystem') === 'metric',
            await page.evaluate('unitSystem'));

  await restartWithLanguage('en-US', 'metric');
  check('the saved setting overrides the language',
            await page.evaluate('unitSystem') === 'metric',
            await page.evaluate('unitSystem'));

  // --- clicking the button as a user would ---
  // Settings live in the `···` menu, so open it first as someone looking for
  // them would.
  await page.evaluate(`moreButton.click(); 'ok'`);
  const buttonBounds = JSON.parse(await page.evaluate(`JSON.stringify(unitsButton.getBoundingClientRect())`));
  const viewport = JSON.parse(await page.evaluate(`JSON.stringify([innerWidth, innerHeight])`));
  if (buttonBounds.left < 0 || buttonBounds.top < 0 || buttonBounds.right > viewport[0] || buttonBounds.bottom > viewport[1])
    throw new Error('the units button is outside the viewport ' + viewport.join('x') +
                    ': ' + JSON.stringify(buttonBounds));
  await page.click((buttonBounds.left + buttonBounds.right)/2, (buttonBounds.top + buttonBounds.bottom)/2);
  check('the button switches to feet and inches',
            await page.evaluate('unitSystem') === 'imperial' &&
            await page.evaluate(`unitsButton.getAttribute('aria-pressed')`) === 'true');
  check('the units have their own storage key',
            await page.evaluate(`localStorage.getItem('tapesketch.units')`) === 'imperial');

  await page.reload();
  check('the units survive a reload',
            await page.evaluate('unitSystem') === 'imperial');

  // --- formatting: feet and inches rounded to 1/16 inch ---
  // Sixteenths are the finest mark on a tape measure. Decimal inches, eighths
  // or unsimplified fractions would change these results.
  for (const [cm, text] of [[30.48, `1'`], [100, `3' 3 3/8"`],
                             [24.13, `9 1/2"`], [0.3175, `1/8"`], [0.15875, `1/16"`],
                             [34.766, `1' 1 11/16"`]]){
    const result = await page.evaluate(`formatLength(${cm})`);
    check(`${cm} cm is formatted as ${text}`, result === text, result);
  }
  check('area is displayed in square feet',
            await page.evaluate('formatArea(400*300)') === '129.17 ft²',
            await page.evaluate('formatArea(400*300)'));

  // --- parsing each format ---
  // Catch a parser that keeps only the first number, as parseFloat does:
  // with that parser, 12 feet 6 inches would measure 12.
  for (const [text, cm] of [[`12'6"`, 381], [`12' 6"`, 381], [`12'`, 365.76],
                           [`150"`, 381], [`6 1/2"`, 16.51],
                           [`12' 6 1/2"`, 382.27], [`12.5'`, 381],
                           [`90`, 228.6]]){
    const result = await page.evaluate(`requireMeasurement(${JSON.stringify(text)})`);
    check(`${text} equals ${cm} cm`, Math.abs(result - cm) < 1e-9, String(result));
  }

  // --- invalid measurements throw with the input ---
  const errorMessage = await page.evaluate(
    `(() => { try { requireMeasurement("12''6\\""); return 'DID NOT THROW'; }
              catch (error){ return error.message; } })()`);
  check('invalid measurements throw with the typed input in the message',
            errorMessage.includes(`12''6"`), errorMessage);

  // The same applies to keyboard input: invalid input must not stretch the wall.
  await page.evaluate(WALL_SEGMENT);
  await typeMeasurement(`12''6"`);
  check('an invalid measurement does not move the wall',
            await page.evaluate('walls[0][1].x') === 300,
            await page.evaluate('walls[0][1].x'));
  check('the typed input is kept for correction',
            await page.evaluate('typed') === `12''6"`,
            await page.evaluate('typed'));
  check('the console reports the error', page.exceptions.length === 1,
            page.exceptions.join(' | '));
  page.exceptions.length = 0;
  await page.evaluate(`typed = ''; draw(); 'ok'`);

  // --- typing feet and inches ---
  await page.evaluate(WALL_SEGMENT);
  await typeMeasurement(`12' 6"`);
  check('typing 12 feet 6 inches sets the wall to exactly 381 cm',
            await page.evaluate('walls[0][1].x') === 381,
            await page.evaluate('walls[0][1].x'));
  check('the dimension reads 12 feet 6 inches again',
            await page.evaluate(`formatLength(walls[0][1].x)`) === `12' 6"`,
            await page.evaluate(`formatLength(walls[0][1].x)`));

  // --- round trip: rounding loses nothing ---
  const drawing = await page.evaluate('JSON.stringify(walls)');
  await page.evaluate(`unitsButton.click(); 'ok'`);
  check('in metric, the same wall measures 3.81 m',
            await page.evaluate(`formatLength(walls[0][1].x)`) === '3.81 m',
            await page.evaluate(`formatLength(walls[0][1].x)`));
  // A typed millimetre is shown, above a metre too, and a whole number of
  // centimetres keeps two decimals. 123.4 cm read as 1.23 m before.
  for (const [cm, text] of [[95.3, '95.3 cm'], [123.4, '1.234 m'], [99.96, '1.00 m']]){
    const result = await page.evaluate(`formatLength(${cm})`);
    check(`in metric, ${cm} cm is formatted as ${text}`, result === text, result);
  }
  await page.evaluate(`unitsButton.click(); 'ok'`);
  check('switching to metric and back preserves every centimetre of the project',
            await page.evaluate('JSON.stringify(walls)') === drawing,
            await page.evaluate('JSON.stringify(walls)'));
  check('the dimension remains the same',
            await page.evaluate(`formatLength(walls[0][1].x)`) === `12' 6"`);

  // --- the chip uses the selected units ---
  check('the chip displays the dimension in feet and inches',
            (await page.evaluate('readoutPanel.textContent')).startsWith(`12' 6"`),
            await page.evaluate('readoutPanel.textContent'));
  check('the wall thickness uses feet and inches too',
            (await page.evaluate(`readoutPanel.querySelector('.thickness-input').value`)) === `3 15/16"`,
            await page.evaluate(`readoutPanel.querySelector('.thickness-input').value`));
  await page.press('9');
  check('typed input is not labeled as centimetres',
            (await page.evaluate('readoutPanel.textContent')).startsWith('9') &&
            !(await page.evaluate('readoutPanel.textContent')).includes('cm'),
            await page.evaluate('readoutPanel.textContent'));
  await page.press('Escape');

  // The chip input accepts an imperial measurement: 6 inches equals 15.24 cm.
  await page.evaluate(`const thicknessInput = readoutPanel.querySelector('.thickness-input');` +
                  `thicknessInput.focus(); thicknessInput.value = '6"'; thicknessInput.blur(); 'ok'`);
  check('the thickness input accepts inches',
            Math.abs(await page.evaluate('walls[0][0].thickness') - 15.2) < 0.05,
            await page.evaluate('walls[0][0].thickness'));

  // --- the project stays independent of units ---
  await page.evaluate('draw()');
  await page.sleep(SAVE_WAIT);
  const savedProject = await page.evaluate(`localStorage.getItem('tapesketch.v1')`);
  const historyLength    = await page.evaluate('history.length');
  const modifiedAt   = await page.evaluate('projects[openProjectId].modifiedAt');

  await page.evaluate(`unitsButton.click(); 'ok'`);
  await page.sleep(SAVE_WAIT);
  check('changing units preserves every byte of the saved project',
            await page.evaluate(`localStorage.getItem('tapesketch.v1')`) === savedProject);
  check('changing units does not add a history entry',
            await page.evaluate('history.length') === historyLength,
            'before=' + historyLength + ' now=' + await page.evaluate('history.length'));
  check('or change the timestamp used for synchronization',
            await page.evaluate('projects[openProjectId].modifiedAt') === modifiedAt);
  const exportedProject = await page.evaluate(
    `(storeOpenProject(), JSON.stringify(projects[openProjectId], null, 1))`);
  check('the units are not included in exported JSON',
            !exportedProject.includes('unit') && !exportedProject.includes('imperial'),
            exportedProject.slice(0, 200));
  await page.evaluate(`unitsButton.click(); 'ok'`);   // back to imperial

  // --- snapping changes with units ---
  // Dragging a piece in imperial units must place it at a multiple of 1/8 inch,
  // otherwise dimensions have fractions that are impossible to read.
  await page.evaluate(`
    walls.length = 0; pieces.length = 0;
    pieces.push({x:0, y:0, w:50, h:50, angle:0, shape:'rect', label:''});
    selection = {pieces:[pieces[0]], walls:[]}; selectedWallSegment = null; draft = null;
    view.offsetX = 0; view.offsetY = 0; view.pxPerCm = 1;
    const dispatchMouseEvent = (type, x, y) => canvas.dispatchEvent(
      new MouseEvent(type, {clientX:x, clientY:y, bubbles:true, button:0}));
    dispatchMouseEvent('mousedown', 25, 25); dispatchMouseEvent('mousemove', 62, 38); dispatchMouseEvent('mouseup', 62, 38);
    JSON.stringify([pieces[0].x, pieces[0].y])`);
  const position = JSON.parse(await page.evaluate('JSON.stringify([pieces[0].x, pieces[0].y])'));
  const isOnEighthStep = value => Math.abs(value/IMPERIAL_SNAP_STEP - Math.round(value/IMPERIAL_SNAP_STEP)) < 1e-9;
  check('dragging in imperial units snaps to 1/8 inch',
            position[0] > 0 && isOnEighthStep(position[0]) && isOnEighthStep(position[1]),
            JSON.stringify(position));
  check('this is not a multiple of the metric snap step of 0.5 cm',
            Math.abs(position[0]/0.5 - Math.round(position[0]/0.5)) > 1e-6,
            JSON.stringify(position));

  // --- the PDF ---
  // Eight feet at 1/4 inch = 1 foot measures two inches on paper: 8 feet is 96
  // inches, and a quarter inch per foot gives two inches on paper.
  await page.evaluate(`
    walls.length = 0; pieces.length = 0;
    walls.push([{x:0, y:0, thickness:10, openings:[]}, {x:${8*30.48}, y:0, thickness:10, openings:[]}]);
    selection = {pieces:[], walls:[]}; selectedWallSegment = null;
    draw(); 'ready'`);
  const pdf = await page.evaluate(
    `exportProjectToPdf({scale:48, orientation:'portrait', author:{name:'', company:''}})`);
  check('8 feet at 1/4 inch = 1 foot measures 2 inches on paper',
            hasLength(pdf, 2*PDF_UNITS_PER_INCH),
            getLineLengths(pdf).join(' '));
  check('the imperial sheet is Letter rather than A4',
            /MediaBox\[0 0 612 792\]/.test(pdf),
            (/MediaBox\[[^\]]*\]/.exec(pdf) || [''])[0]);
  check('the title block displays the scale in feet',
            getStream(pdf).includes(`(Scale 1/4" = 1'`),
            (/\(Scale[^)]*\)/.exec(getStream(pdf)) || [''])[0]);
  const halfScalePdf = await page.evaluate(
    `exportProjectToPdf({scale:96, orientation:'portrait', author:{name:'', company:''}})`);
  check('at 1/8 inch = 1 foot it measures half as much',
            hasLength(halfScalePdf, PDF_UNITS_PER_INCH) && !hasLength(halfScalePdf, 2*PDF_UNITS_PER_INCH),
            getLineLengths(halfScalePdf).join(' '));
  check('the dialog offers imperial scales and the Letter sheet',
            await page.evaluate(`[...pdfScaleSelect.options].map(option => option.value).join()`) === 'fit,48,96' &&
            (await page.evaluate(`pdfSheetSelect.options[0].textContent`)) === 'Letter portrait',
            await page.evaluate(`[...pdfScaleSelect.options].map(option => option.textContent).join(' | ')`));
  const invalidScaleResult = await page.evaluate(
    `(() => { try { exportProjectToPdf({scale:50, orientation:'portrait',
                               author:{name:'', company:''}}); return 'GENERATED'; }
              catch (error){ return error.message; } })()`);
  check('a metric scale is rejected in imperial units', invalidScaleResult !== 'GENERATED', invalidScaleResult);

  // Metric still uses A4 and 1:50, preserving existing behavior.
  await page.evaluate(`unitsButton.click(); 'ok'`);
  const metricPdf = await page.evaluate(
    `exportProjectToPdf({scale:50, orientation:'portrait', author:{name:'', company:''}})`);
  check('in metric, the sheet returns to A4 and the scale to 1:50',
            /MediaBox\[0 0 595.2756 841.8898\]/.test(metricPdf) &&
            getStream(metricPdf).includes('(Scale 1:50'));
  await page.evaluate(`unitsButton.click(); 'ok'`);

  // --- the piece catalog ---
  // These are different pieces: a 135 cm bed in metric and a queen bed in
  // imperial. Check that inches in the American catalog reach the project
  // in centimetres, which are the only units the project stores.
  const readCatalog = () =>
    page.evaluate(`[...furnitureMenu.querySelectorAll('button')].map(button => button.textContent).join('|')`);

  await page.evaluate('applyUnits("metric")');
  const metricCatalog = await readCatalog();
  check('in metric, the catalog contains metric pieces',
            /bed 135135×190/.test(metricCatalog) && !/queen/.test(metricCatalog), metricCatalog);

  await page.evaluate('applyUnits("imperial")');
  const imperialCatalog = await readCatalog();
  check('in imperial, it contains American pieces',
            /queen bed60×80"/.test(imperialCatalog) && !/bed 135/.test(imperialCatalog), imperialCatalog);
  check('including the king bed absent from the metric catalog',
            /king bed76×80"/.test(imperialCatalog), imperialCatalog);

  await page.evaluate('walls.length = 0; pieces.length = 0; draw()');
  await page.evaluate(`[...furnitureMenu.querySelectorAll('button')]
    .find(button => button.textContent.startsWith('queen bed')).click()`);
  const bed = await page.evaluate('JSON.stringify([pieces.length, pieces[0].w, pieces[0].h, pieces[0].label])');
  check('a queen bed is added to the project in centimetres',
            JSON.parse(bed)[1] === 60*2.54 && JSON.parse(bed)[2] === 80*2.54, bed);
  check('with the requested name',
            JSON.parse(bed)[3] === 'queen bed', bed);
  check('its dimension is displayed correctly in feet',
            await page.evaluate('formatLength(pieces[0].h)') === `6' 8"`,
            await page.evaluate('formatLength(pieces[0].h)'));

  await page.evaluate('pieces.length = 0; applyUnits("metric"); draw()');

  check('no uncaught page exceptions', page.exceptions.length === 0,
            page.exceptions.join(' | '));

  page.close();
  finish();
}

main().catch(error => { console.error('CRASH: ' + error.message); process.exit(2); });
