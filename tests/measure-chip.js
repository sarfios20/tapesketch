// The thickness field in the floating measure chip, in a real Chrome browser.
//
// The chip lives inside `#readout`, which is fully rewritten on every `draw()`,
// ignores clicks, and shares its keyboard with global shortcuts. Each of
// these three things can break the field independently, so each is checked.
const { open, createChecker } = require('./cdp.js');

const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const APP_URL = process.env.APP_URL || 'http://localhost:8080/';

const THICKNESS_INPUT = `readoutPanel.querySelector('.thickness-input')`;

(async () => {
  const page = await open(CDP_PORT, APP_URL);
  const { check, finish } = createChecker();

  // A wall 300 cm long and 10 cm thick with its segment selected, which
  // is when the chip appears.
  await page.evaluate(`
    localStorage.clear();
    walls.length = 0; pieces.length = 0;
    walls.push([{x:0,y:0,thickness:10,openings:[]},{x:300,y:0,thickness:10,openings:[]}]);
    selectedWallSegment = {type:'wall-segment', wall:walls[0], index:1};
    selection = {pieces:[], walls:[walls[0]]};
    draw(); 'ready'
  `);

  const inputBounds = await page.evaluate(`
    (() => { const inputElement = ${THICKNESS_INPUT};
      if (!inputElement) return null;
      const bounds = inputElement.getBoundingClientRect();
      return {x:bounds.x + bounds.width/2, y:bounds.y + bounds.height/2, w:bounds.width, value:inputElement.value}; })()
  `);
  check('the chip contains a thickness field', inputBounds !== null && inputBounds.w > 0, JSON.stringify(inputBounds));
  if (!inputBounds) finish();
  check('the field starts with the current thickness', inputBounds.value === '10', 'value=' + inputBounds.value);

  // The whole chip ignores mouse input; only the field should receive clicks.
  await page.click(inputBounds.x, inputBounds.y);
  check('clicking focuses the field, so pointer-events is scoped',
            await page.evaluate(`document.activeElement.classList.contains('thickness-input')`));

  await page.evaluate(`${THICKNESS_INPUT}.select(); 'ok'`);

  // Backspace would delete the whole selection and digits would go into the
  // measurement buffer if the global shortcut did not yield the keyboard to the field.
  await page.press('Backspace');
  check('Backspace inside the field does not delete the wall',
            await page.evaluate(`walls.length`) === 1);

  for (const key of ['1','1','.','5']) await page.press(key);
  check('digits go to the field rather than the measurement buffer',
            await page.evaluate(`typed`) === '' && await page.evaluate(`${THICKNESS_INPUT}.value`) === '11.5',
            'typed=' + JSON.stringify(await page.evaluate(`typed`)) +
            ' field=' + JSON.stringify(await page.evaluate(`${THICKNESS_INPUT}.value`)));

  // `draw()` rewrites the whole chip; it must leave the focused field alone.
  await page.evaluate(`draw(); draw(); 'ok'`);
  check('repainting does not destroy the field while typing',
            await page.evaluate(`document.activeElement.classList.contains('thickness-input')`) &&
            await page.evaluate(`${THICKNESS_INPUT}.value`) === '11.5');

  await page.press('Enter');
  await page.sleep(200);
  const thickness = await page.evaluate(`walls[0][0].thickness`);
  check('Enter applies fractional thickness', thickness === 11.5, 'thickness=' + thickness);
  check('focus returns to the canvas',
            await page.evaluate(`document.activeElement.id`) === 'canvas',
            'activeElement=' + await page.evaluate(`document.activeElement.id`));

  await page.evaluate(`increaseThickness(1); draw(); 'ok'`);
  check('Ctrl+arrow still increments the new value',
            await page.evaluate(`walls[0][0].thickness`) === 12.5, 'thickness=' + await page.evaluate(`walls[0][0].thickness`));

  await page.evaluate(`const inputElement = ${THICKNESS_INPUT}; inputElement.focus(); inputElement.value = 'invalid'; inputElement.blur(); 'ok'`);
  check('non-numeric input is discarded',
            await page.evaluate(`walls[0][0].thickness`) === 12.5, 'thickness=' + await page.evaluate(`walls[0][0].thickness`));

  check('no uncaught page exceptions', page.exceptions.length === 0,
            page.exceptions.join(' | '));

  page.close();
  finish();
})().catch(error => { console.error('CRASH: ' + error.message); process.exit(2); });
