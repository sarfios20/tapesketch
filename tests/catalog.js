// The user's own furniture catalog (contracts/3-catalog.md).
//
// What matters is that a saved piece comes back exactly as it was saved,
// across reloads, and that a broken catalog never takes the app down with it.
const { open, createChecker, FULL_STORAGE, RECORD_DOWNLOADS } = require('./cdp.js');

const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const APP_URL = process.env.APP_URL || 'http://localhost:8080/';

// The menu buttons, found by the text people see.
const menuButton = text =>
  `[...furnitureMenu.querySelectorAll('button')].find(button => button.textContent.startsWith(${JSON.stringify(text)}))`;

(async () => {
  const page = await open(CDP_PORT, APP_URL, {
    beforeLoad: 'window.__dialogs = [];' +
                'window.alert = message => window.__dialogs.push(message);' +
                'window.confirm = () => true;' + FULL_STORAGE + RECORD_DOWNLOADS,
  });
  const { check, finish } = createChecker();

  const restartApp = async keys => {
    await page.evaluate('localStorage.clear()');
    for (const [key, value] of Object.entries(keys))
      await page.evaluate(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`);
    await page.reload();
  };
  const savedCatalog = async () =>
    JSON.parse(await page.evaluate(`localStorage.getItem('tapesketch.catalog')`));

  // --- saving a piece ---
  await restartApp({});
  page.exceptions.length = 0;   // what the previous suite left on unload is not ours
  const openMenu = `closeMenus(); furnitureButton.click();`;
  await page.evaluate(`selection = {pieces:[], walls:[]}; draw(); ${openMenu} 'ok'`);
  check('save is disabled with nothing selected',
        await page.evaluate(`${menuButton('Save selected piece')}.disabled`) === true);

  // An L-shaped desk, because the notch is what a sloppy copy would lose.
  await page.evaluate(`
    const desk = {x:0, y:0, w:160, h:140, angle:1.2, shape:'l-shape', notchW:100, notchH:80, label:'corner desk'};
    pieces.push(desk);
    selection = {pieces:[desk], walls:[]};
    draw(); ${openMenu}
    ${menuButton('Save selected piece')}.click(); 'ok'
  `);
  const catalog = await savedCatalog();
  const saved = catalog && catalog.pieces[0];
  check('the catalog is stored with formatVersion 1',
        catalog && catalog.formatVersion === 1 && catalog.pieces.length === 1, JSON.stringify(catalog));
  check('a saved piece is a template: no position, no angle',
        saved && JSON.stringify(Object.keys(saved).sort()) ===
          JSON.stringify(['h','id','label','notchH','notchW','shape','w']), JSON.stringify(saved));
  check('the L keeps its shape, size and notch',
        saved && saved.shape === 'l-shape' && saved.w === 160 && saved.h === 140 &&
        saved.notchW === 100 && saved.notchH === 80 && saved.label === 'corner desk', JSON.stringify(saved));

  await page.evaluate(`${openMenu} ${menuButton('Save selected piece')}.click(); 'ok'`);
  check('saving the same name again does not overwrite it',
        (await savedCatalog()).pieces.map(piece => piece.label).join('|') === 'corner desk|corner desk 2',
        JSON.stringify(await savedCatalog()));

  // --- after a reload ---
  await page.reload();
  await page.evaluate(`${openMenu} 'ok'`);
  check('the catalog survives a reload, under "Yours"',
        /Yours/.test(await page.evaluate('furnitureMenu.textContent')) &&
        await page.evaluate(`!!${menuButton('corner desk')}`) === true);
  await page.evaluate(`selection = {pieces:[], walls:[]}; ${menuButton('corner desk')}.click(); 'ok'`);
  const placed = JSON.parse(await page.evaluate('JSON.stringify(pieces[pieces.length - 1])'));
  check('placing it brings back the same shape, size and notch',
        placed.shape === 'l-shape' && placed.w === 160 && placed.h === 140 &&
        placed.notchW === 100 && placed.notchH === 80 && placed.label === 'corner desk', JSON.stringify(placed));
  check('the built-in pieces are still there',
        await page.evaluate(`!!${menuButton('wardrobe')}`) === true);

  // --- a broken catalog ---
  await restartApp({'tapesketch.catalog': 'not json'});
  check('an unreadable catalog is set aside',
        await page.evaluate(`localStorage.getItem('tapesketch.catalog.corrupt')`) === 'not json');
  await page.evaluate(`${openMenu} 'ok'`);
  check('and the app still starts, with projects and an empty catalog',
        await page.evaluate('Object.keys(projects).length') === 1 &&
        !/Yours/.test(await page.evaluate('furnitureMenu.textContent')));

  const extraField = JSON.stringify({formatVersion: 1, pieces: [
    {id: 'a', label: 'stool', shape: 'ellipse', w: 35, h: 35, x: 0}]});
  await restartApp({'tapesketch.catalog': extraField});
  check('a catalog piece with a field outside the format is rejected',
        await page.evaluate(`localStorage.getItem('tapesketch.catalog.corrupt')`) === extraField &&
        /pieces\[0\]\.x/.test(await page.evaluate('__dialogs.join(" ")')),
        await page.evaluate('__dialogs.join(" ")'));

  // --- the catalog manager ---
  // Rename, resize and delete, each the way a person does it: through the
  // menu, the dialog and its prompts.
  await restartApp({'tapesketch.catalog': JSON.stringify({formatVersion: 1, pieces: [
    {id: 'desk', label: 'desk', shape: 'rect', w: 120, h: 60},
    {id: 'stool', label: 'stool', shape: 'ellipse', w: 35, h: 35}]})});
  const answerPrompt = answer => page.evaluate(`window.prompt = () => ${JSON.stringify(answer)}; 'ok'`);
  const rowButton = (label, text) =>
    `[...catalogManager.querySelectorAll('button')].find(button => button.textContent === ${JSON.stringify(text)} &&
       button.closest('.catalog-row').textContent.includes(${JSON.stringify(label)}))`;
  const labels = async () => (await savedCatalog()).pieces.map(piece => piece.label).join('|');

  await page.evaluate(`${openMenu} ${menuButton('Manage catalog')}.click(); 'ok'`);
  check('Manage catalog opens the dialog', await page.evaluate('catalogManager.hidden') === false);

  await answerPrompt('work desk');
  await page.evaluate(`${rowButton('desk', 'RENAME')}.click(); 'ok'`);
  check('rename changes the label and keeps the rest',
        await labels() === 'work desk|stool' && (await savedCatalog()).pieces[0].w === 120, await labels());

  await page.evaluate('window.__dialogs = []');
  await answerPrompt('stool');
  await page.evaluate(`${rowButton('work desk', 'RENAME')}.click(); 'ok'`);
  check('a rename onto another piece name is refused',
        await labels() === 'work desk|stool' && await page.evaluate('__dialogs.length') === 1, await labels());

  await answerPrompt('150x70');
  await page.evaluate(`${rowButton('work desk', 'RESIZE')}.click(); 'ok'`);
  const resized = (await savedCatalog()).pieces[0];
  check('resize reads 150x70 like the canvas does', resized.w === 150 && resized.h === 70, JSON.stringify(resized));

  await page.evaluate('window.__dialogs = []');
  await answerPrompt('big');
  await page.evaluate(`${rowButton('work desk', 'RESIZE')}.click(); 'ok'`);
  check('a resize that is not two measurements is refused and changes nothing',
        (await savedCatalog()).pieces[0].w === 150 && await page.evaluate('__dialogs.length') === 1);

  await page.evaluate(`${rowButton('stool', 'DELETE')}.click(); 'ok'`);
  check('delete removes the piece', await labels() === 'work desk', await labels());

  // --- export and import ---
  // The export is caught at the Blob, so the file is the real one.
  await page.evaluate(`
    window.__exported = null;
    URL.createObjectURL = blob => { window.__exported = blob; return 'blob:test'; };
    URL.revokeObjectURL = () => {};
    downloadFile = (address, name) => { window.__exportedName = name; };
    [...catalogManager.querySelectorAll('button')].find(button => button.textContent.startsWith('EXPORT')).click(); 'ok'`);
  const exported = JSON.parse(await page.evaluate('window.__exported.text()'));
  check('export writes the catalog as it is stored',
        JSON.stringify(exported) === JSON.stringify(await savedCatalog()), JSON.stringify(exported));

  // Importing adds: a clash gets a free name and a fresh id, nothing is replaced.
  await page.evaluate(`importCatalog(${JSON.stringify(JSON.stringify({formatVersion: 1, pieces: [
    {id: 'desk', label: 'work desk', shape: 'rect', w: 90, h: 50},
    {id: 'lamp', label: 'lamp', shape: 'ellipse', w: 30, h: 30}]}))}); 'ok'`);
  const afterImport = (await savedCatalog()).pieces;
  check('import adds, renaming a clash instead of replacing it',
        afterImport.map(piece => piece.label + ':' + piece.w).join('|') === 'work desk:150|work desk 2:90|lamp:30',
        afterImport.map(piece => piece.label + ':' + piece.w).join('|'));
  check('every piece keeps a unique id after import',
        new Set(afterImport.map(piece => piece.id)).size === afterImport.length, JSON.stringify(afterImport));

  const importError = await page.evaluate(`(() => {
    try { importCatalog(${JSON.stringify(JSON.stringify({formatVersion: 1, pieces: [
      {id: 'z', label: 'shelf', shape: 'rect', w: 80, h: 30, angle: 0}]}))}); return 'ACCEPTED'; }
    catch (error){ return error.message; } })()`);
  check('an import with a field outside the format is refused, naming it, and changes nothing',
        /pieces\[0\]\.angle/.test(importError) && (await savedCatalog()).pieces.length === 3, importError);

  // --- a full storage ---
  // Setting a corrupt catalog aside writes a copy; if that write fails, the
  // app still has to start.
  await page.evaluate('sessionStorage.setItem("__failWrites", "tapesketch.catalog.corrupt")');
  await restartApp({'tapesketch.catalog': 'not json'});
  check('a corrupt catalog that cannot be set aside does not stop startup',
        await page.evaluate('typeof projects === "object" && Object.keys(projects).length') === 1 &&
        await page.evaluate('catalog.pieces.length') === 0, await page.evaluate('__dialogs.join(" ")'));
  check('and it is downloaded instead, freeing its key so a later save cannot overwrite it',
        await page.evaluate(`__downloads.length === 1 && __downloads[0].name === 'tapesketch.catalog.corrupt.json' &&
          __downloads[0].blob.text()`) === 'not json' &&
        await page.evaluate(`localStorage.getItem('tapesketch.catalog')`) === null);
  await page.evaluate('sessionStorage.removeItem("__failWrites")');

  // A change that cannot be saved is not made: the catalog in memory stays as
  // it was, so retrying later does not add the same pieces twice.
  await restartApp({'tapesketch.catalog': JSON.stringify({formatVersion: 1, pieces: [
    {id: 'desk', label: 'desk', shape: 'rect', w: 120, h: 60}]})});
  await page.evaluate('sessionStorage.setItem("__failWrites", "tapesketch.catalog")');
  await page.reload();
  const lampFile = JSON.stringify(JSON.stringify({formatVersion: 1, pieces: [
    {id: 'lamp', label: 'lamp', shape: 'ellipse', w: 30, h: 30}]}));
  const failedImport = await page.evaluate(`(() => { try { importCatalog(${lampFile}); return 'SAVED'; }
    catch (error){ return error.message; } })()`);
  check('an import that cannot be saved fails and leaves the catalog as it was',
        failedImport !== 'SAVED' && await page.evaluate('catalog.pieces.map(piece => piece.label).join("|")') === 'desk',
        await page.evaluate('catalog.pieces.map(piece => piece.label).join("|")'));
  await page.evaluate('sessionStorage.removeItem("__failWrites")');
  await page.reload();
  await page.evaluate(`importCatalog(${lampFile}); 'ok'`);
  check('retrying once storage works imports it once',
        (await savedCatalog()).pieces.map(piece => piece.label).join('|') === 'desk|lamp',
        JSON.stringify(await savedCatalog()));

  check('no stray exceptions', !page.exceptions.length, page.exceptions.join(' | '));
  page.close();
  finish();
})().catch(error => { console.error('CRASH:', error.message); process.exit(1); });
