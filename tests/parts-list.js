// Parts list tests. Check that spreadsheet numbers use the unit stated
// in the header: a CSV saying "in" but containing centimetres leads
// to cutting the counter to the wrong size.
const {open, createChecker} = require('./cdp.js');

const {check, finish} = createChecker();

// A 400x300 rectangle with an 80-wide door, and a rotated table with a comma
// in its label, which breaks an incorrectly written CSV.
const PROJECT = `walls.length = 0; pieces.length = 0;
  walls.push([{x:0, y:0, thickness:10, openings:[{offset:100, swing:1, kind:'door', width:80}]},
              {x:400, y:0, thickness:10, openings:[]},
              {x:400, y:300, thickness:10, openings:[]},
              {x:0, y:300, thickness:10, openings:[]},
              {x:0, y:0, thickness:10, openings:[]}]);
  pieces.push({x:10, y:10, w:150, h:190, angle:Math.PI/2, shape:'rect', label:'bed, big'});
  draw()`;

const parseRows = csv => csv.trim().split('\r\n').map(line => line.split(','));

async function main(){
  // Language determines the initial format, and headless Chrome always
  // reports en-US: read from localStorage to change it between reloads.
  const page = await open(process.env.CDP_PORT, process.env.APP_URL, {
    beforeLoad: 'window.__dialogs = []; window.alert = message => window.__dialogs.push(message);' +
           "Object.defineProperty(navigator, 'language', " +
           "{get: () => localStorage.getItem('__language') || 'es-ES'});",
  });
  await page.evaluate('localStorage.clear()');
  await page.reload();
  await page.evaluate(PROJECT);

  // The parts list opens without restrictions or warnings.
  await page.evaluate('partsListButton.click()');
  check('the parts list offers CSV download without warnings',
            await page.evaluate('partsListDialog.hidden') === false &&
            await page.evaluate('__dialogs.length') === 0);
  await page.evaluate('closeCsvDialog()');

  // --- metric ---
  await page.evaluate("applyUnits('metric')");
  const metricRows = parseRows(await page.evaluate(`convertProjectToCsv('comma')`));
  check('the header states the unit of each column',
            metricRows[0].join() === 'type,name,width (cm),depth (cm),angle (deg),area (m2)',
            metricRows[0].join());
  check('the closed room includes its area in m2',
            metricRows[1].join() === 'room,,,,,12', metricRows[1].join());
  check('all four wall segments include length and thickness',
            metricRows.filter(row => row[0] === 'wall').length === 4 &&
            metricRows.filter(row => row[0] === 'wall')[0].join() === 'wall,,400,10,,',
            JSON.stringify(metricRows.filter(row => row[0] === 'wall')));
  check('the door includes its width',
            metricRows.filter(row => row[0] === 'door').join() === 'door,,80,,,',
            JSON.stringify(metricRows.filter(row => row[0] === 'door')));
  check('the piece includes dimensions, rotation in degrees and area',
            metricRows.at(-1).join() === 'furniture,"bed, big",150,190,90,2.85',
            metricRows.at(-1).join());
  check('the label with a comma is quoted without splitting the row',
            metricRows.at(-1).length === 7 && metricRows.at(-1)[1] === '"bed' && metricRows.at(-1)[2] === ' big"',
            JSON.stringify(metricRows.at(-1)));

  // --- imperial ---
  // The same project, still stored in centimetres, with the entire CSV in
  // inches: a missed conversion here is invisible on screen.
  await page.evaluate("applyUnits('imperial')");
  const imperialRows = parseRows(await page.evaluate(`convertProjectToCsv('comma')`));
  check('in imperial mode the header changes units',
            imperialRows[0].join() === 'type,name,width (in),depth (in),angle (deg),area (ft2)',
            imperialRows[0].join());
  check('a 400 cm wall is 157.48 inches',
            imperialRows.filter(row => row[0] === 'wall')[0].join() === 'wall,,157.48,3.94,,',
            JSON.stringify(imperialRows.filter(row => row[0] === 'wall')[0]));
  check('a 12 m2 room is 129.17 square feet',
            imperialRows[1].join() === 'room,,,,,129.17', imperialRows[1].join());

  await page.evaluate("applyUnits('metric')");

  // --- formats vary between locales ---
  // A Spanish spreadsheet puts a comma-separated CSV row into a single cell.
  // Choose the separator and decimal together, using the format appropriate
  // for the person drawing.
  // Check complete lines here, since splitting is exactly what differs
  // between formats.
  const getLines = async format => (await page.evaluate(`convertProjectToCsv('${format}')`)).trim().split('\r\n');

  const semicolonLines = await getLines('semicolon');
  check('semicolon format uses a decimal comma',
            semicolonLines.at(-1) === 'furniture;bed, big;150;190;90;2,85', semicolonLines.at(-1));
  check('a label with a comma needs no quotes when commas are not separators',
            !semicolonLines.at(-1).includes('"'), semicolonLines.at(-1));
  check('the header uses the same separator', semicolonLines[0].startsWith('type;name;'), semicolonLines[0]);

  const tabLines = await getLines('tab');
  check('tab format also works and uses a decimal point',
            tabLines.at(-1) === 'furniture\tbed, big\t150\t190\t90\t2.85',
            JSON.stringify(tabLines.at(-1)));

  const failure = await page.evaluate(`(() => { try { convertProjectToCsv('custom'); return 'PASS'; }
                                         catch (error){ return error.message; } })()`);
  check('an invented format fails with a descriptive message', failure === 'Unknown CSV format: "custom".',
            failure);

  // --- initial format ---
  const startInLanguage = async language => {
    await page.evaluate(`localStorage.clear();
      localStorage.setItem('__language', ${JSON.stringify(language)}); 'ok'`);
    await page.reload();
    await page.evaluate(PROJECT);
    await page.evaluate("partsListButton.click()");
  };

  await startInLanguage('es-ES');
  check('Spanish starts with semicolon format',
            await page.evaluate('partsListFormatSelect.value') === 'semicolon',
            await page.evaluate('partsListFormatSelect.value'));
  await startInLanguage('en-US');
  check('US English starts with comma format',
            await page.evaluate('partsListFormatSelect.value') === 'comma',
            await page.evaluate('partsListFormatSelect.value'));
  await startInLanguage('de-DE');
  check('German starts with semicolon format without a country list',
            await page.evaluate('partsListFormatSelect.value') === 'semicolon',
            await page.evaluate('partsListFormatSelect.value'));

  // The chosen format overrides the language from then on.
  await page.evaluate("partsListFormatSelect.value = 'tab'; partsListDownloadButton.click()");
  check('exporting closes the dialog', await page.evaluate('partsListDialog.hidden') === true);
  check('the chosen format is saved',
            await page.evaluate(`localStorage.getItem('tapesketch.csv')`) === 'tab');
  await page.evaluate('partsListButton.click()');
  check('the saved format is offered next time regardless of language',
            await page.evaluate('partsListFormatSelect.value') === 'tab');
  await page.evaluate('closeCsvDialog()');

  check('no uncaught exceptions', !page.exceptions.length, page.exceptions.join(' | '));
  page.close();
  finish();
}

main();
