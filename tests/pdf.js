// PDF export tests.
//
// Scale is the main concern: the sheet is printed and measured with a ruler,
// so a 100 cm wall segment at 1:50 must measure exactly 2 cm. Mixing up
// millimetres and points, applying scale twice or fitting the project to the
// page produces a plausible drawing with unusable dimensions. Also check
// that oversized projects warn instead of being clipped, author data stays
// out of the project and exporting does not count as drawing.
const {open, createChecker} = require('./cdp.js');

const {check, finish} = createChecker();

// One centimetre on paper in PDF units (1/72 inch).
const PDF_UNITS_PER_CM = 72/2.54;

// Thousandths: the sheet writes rounded coordinates rather than exact values.
const TOLERANCE = 0.001;

// A single wall segment 100 cm long and 10 cm thick produces two parallel
// wall faces, each the length of the segment, with no other lines to confuse them.
const WALL_SEGMENT = `walls.length = 0; pieces.length = 0;
               walls.push([{x:0, y:0, thickness:10, openings:[]}, {x:100, y:0, thickness:10, openings:[]}]);
               draw()`;

const generatePdf = (scale, orientation, author = "{name:'', company:''}") =>
  `exportProjectToPdf({scale:${JSON.stringify(scale)}, orientation:'${orientation}', author:${author}})`;

// Like the helper above, but return the error message rather than throwing.
const tryExpression = expression => `(() => { try { ${expression}; return 'GENERATED'; }
                                   catch (error){ return error.message; } })()`;

const getStream = pdf => pdf.slice(pdf.indexOf('stream\n') + 7, pdf.indexOf('\nendstream'));

// Lengths of the two-point lines drawn by the PDF, in PDF units. A two-point
// wall face is exactly such a line, so these are the lengths a ruler measures.
function getLineLengths(pdf){
  const segments = [...getStream(pdf).matchAll(/([-\d.]+) ([-\d.]+) m\n([-\d.]+) ([-\d.]+) l\nS/g)];
  return segments.map(match => Math.hypot(+match[3] - +match[1], +match[4] - +match[2]));
}

const hasLength = (pdf, expected) => getLineLengths(pdf).some(value => Math.abs(value - expected) < TOLERANCE);

async function main(){
  const page = await open(process.env.CDP_PORT, process.env.APP_URL, {
    beforeLoad: 'window.__dialogs = [];' +
           'window.alert = message => window.__dialogs.push(message);' +
           'window.confirm = () => true;',
  });

  await page.evaluate('localStorage.clear()');
  await page.reload();
  await page.evaluate(WALL_SEGMENT);

  // --- scale is the purpose of the PDF ---
  const scale50Pdf = await page.evaluate(generatePdf(50, 'portrait'));
  check('100 cm at 1:50 measures 2 cm on paper',
            hasLength(scale50Pdf, 2*PDF_UNITS_PER_CM),
            getLineLengths(scale50Pdf).join(' '));
  check('the 10 cm wall thickness is drawn to scale',
            Math.abs(getWallFaceDistance(scale50Pdf) - 0.2*PDF_UNITS_PER_CM) < TOLERANCE,
            String(getWallFaceDistance(scale50Pdf)));

  const scale100Pdf = await page.evaluate(generatePdf(100, 'portrait'));
  check('the same wall segment at 1:100 measures half as much',
            hasLength(scale100Pdf, PDF_UNITS_PER_CM) && !hasLength(scale100Pdf, 2*PDF_UNITS_PER_CM),
            getLineLengths(scale100Pdf).join(' '));

  const fittedPdf = await page.evaluate(generatePdf('fit', 'portrait'));
  check('"fit" chooses the largest scale that fits',
            hasLength(fittedPdf, 2*PDF_UNITS_PER_CM) && fittedPdf.includes('(Scale 1:50'));

  check('the sheet is A4 in portrait or landscape',
            /MediaBox\[0 0 595.2756 841.8898\]/.test(scale50Pdf) &&
            /MediaBox\[0 0 841.8898 595.2756\]/.test(await page.evaluate(generatePdf(50, 'landscape'))));

  // --- report projects that do not fit rather than clipping them ---
  await page.evaluate(`walls[0][1].x = 2000; draw()`);
  const errorMessage = await page.evaluate(tryExpression(generatePdf(50, 'portrait')));
  check('a project that does not fit cannot generate a PDF', errorMessage !== 'GENERATED', errorMessage);
  check('the alert states the project size and the available space',
            /2000/.test(errorMessage) && /40\.0/.test(errorMessage) && /18\.0/.test(errorMessage), errorMessage);
  check('"fit" also rejects a project that fits no scale',
            await page.evaluate(tryExpression(generatePdf('fit', 'portrait'))) !== 'GENERATED');

  await page.evaluate(`__dialogs.length = 0; openPdfDialog();` +
                  `pdfScaleSelect.value = '50'; pdfSheetSelect.value = 'portrait';` +
                  `pdfGenerateButton.click()`);
  check('generating with the button alerts when the project does not fit',
            (await page.evaluate('__dialogs.length')) === 1,
            await page.evaluate('JSON.stringify(__dialogs)'));
  check('the dialog stays open to change the scale',
            (await page.evaluate('pdfDialog.hidden')) === false);

  // --- author data belongs to the author rather than the project ---
  await page.evaluate(WALL_SEGMENT);
  await page.evaluate(`pdfAuthorNameInput.value = 'Ana Pérez'; pdfAuthorCompanyInput.value = 'Montajes Ñandú';` +
                  `pdfGenerateButton.click()`);
  const pdfWithAuthor = await page.evaluate(generatePdf(50, 'portrait', 'readAuthor()'));
  check('the author appears in the title block',
            pdfWithAuthor.includes('(Ana Pérez)') && pdfWithAuthor.includes('(Montajes Ñandú)'));
  check('the author is saved for the next project',
            (await page.evaluate(`JSON.parse(localStorage.getItem('tapesketch.author')).company`)) ===
            'Montajes Ñandú');
  check('the author is not included in the exported project',
            !(await page.evaluate('JSON.stringify(projects[openProjectId])')).includes('Ana'));
  await page.sleep(500);   // `saveProject()` writes asynchronously
  check('or in the saved projects',
            !(await page.evaluate(`localStorage.getItem('tapesketch.v1')`)).includes('Ana'));

  // --- exporting does not count as drawing ---
  await page.evaluate('draw()');
  await page.sleep(500);
  const before = await page.evaluate('JSON.stringify([projects[openProjectId].modifiedAt, history.length, snapshot])');
  await page.evaluate(`openPdfDialog(); pdfGenerateButton.click()`);
  await page.sleep(500);
  check('exporting preserves `modifiedAt` and history',
            (await page.evaluate('JSON.stringify([projects[openProjectId].modifiedAt, history.length, snapshot])')) === before,
            await page.evaluate('JSON.stringify([projects[openProjectId].modifiedAt, history.length])'));
  check('the dialog closes after generating',
            (await page.evaluate('pdfDialog.hidden')) === true);

  // --- the dialog consumes app keystrokes ---
  // Type a name with the dialog open: if the global `keydown` handler does not
  // yield, Backspace deletes the wall and "b" locks the walls.
  await page.evaluate(`openPdfDialog(); pdfAuthorNameInput.focus()`);
  await page.press('Backspace');
  await page.press('b');
  check('typing the name does not trigger project shortcuts',
            (await page.evaluate('walls[0].length')) === 2 &&
            (await page.evaluate('areWallsLocked')) === false);
  await page.press('Escape');
  check('Escape closes the dialog', (await page.evaluate('pdfDialog.hidden')) === true);

  // --- the file must open ---
  // An incorrect xref offset or /Length is otherwise invisible: the viewer
  // simply fails to open the file.
  const pdf = await page.evaluate(generatePdf(50, 'portrait'));
  check('the PDF has a valid beginning and end',
            pdf.startsWith('%PDF-1.4\n') && pdf.trimEnd().endsWith('%%EOF'));
  check('/Length matches the stream it measures',
            +/\/Length (\d+)/.exec(pdf)[1] === getStream(pdf).length);
  const xrefStart = +/startxref\n(\d+)/.exec(pdf)[1];
  const xref = [...pdf.slice(xrefStart).matchAll(/^(\d{10}) 00000 n $/gm)];
  check('the xref table points to each object',
            xref.length === 5 &&
            xref.every((match, index) => pdf.startsWith((index+1) + ' 0 obj', +match[1])),
            xref.map(match => match[1]).join(' '));
  check('startxref points to the table', pdf.startsWith('xref\n', xrefStart));

  // --- the sheet stays clean ---
  // No subscription plan adds a watermark: the sheet contains only the project
  // and its title block, and the scale stays unchanged.
  await page.evaluate(WALL_SEGMENT);
  const sheetPdf = await page.evaluate(generatePdf(50, 'portrait'));
  check('the sheet has no watermark',
            !getStream(sheetPdf).includes('Made with') && !getStream(sheetPdf).includes('0.82 g'),
            getStream(sheetPdf).slice(-260));
  check('100 cm still measures 2 cm on paper',
            hasLength(sheetPdf, 2*PDF_UNITS_PER_CM), getLineLengths(sheetPdf).join(' '));

  check('no uncaught page exceptions', !page.exceptions.length, page.exceptions.join(' | '));
  page.close();
  finish();
}

// Distance between the two wall faces in the test segment: both lines are
// parallel to the x axis, so comparing their heights is enough.
function getWallFaceDistance(pdf){
  const heights = [...new Set([...getStream(pdf).matchAll(/[-\d.]+ ([-\d.]+) m\n[-\d.]+ ([-\d.]+) l\nS/g)]
    .filter(match => match[1] === match[2]).map(match => +match[1]))];
  return heights.length === 2 ? Math.abs(heights[0] - heights[1]) : null;
}

main();
