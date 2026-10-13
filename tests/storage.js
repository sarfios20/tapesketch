const {open, createChecker, FULL_STORAGE, RECORD_DOWNLOADS} = require('./cdp.js');

const {check, finish} = createChecker();

const SAVED_PROJECTS = {
  openProjectId: '22222222-2222-4222-8222-222222222222',
  projects: {
    '11111111-1111-4111-8111-111111111111': {
      name:'house', formatVersion:1, isSample:false,
      walls: [[{x:0, y:0, thickness:10, openings:[]}, {x:100, y:0, thickness:10, openings:[]}]], pieces: [],
      view:{offsetX:0, offsetY:0, pxPerCm:0.9}, modifiedAt:'2026-08-01T10:00:00.000Z',
    },
    '22222222-2222-4222-8222-222222222222': {
      name:'garage', formatVersion:1, isSample:false,
      walls: [], pieces: [{x:0, y:0, w:50, h:50, angle:0, shape:'rect', label:'car'}],
      view:{offsetX:0, offsetY:0, pxPerCm:0.9}, modifiedAt:'2026-08-02T10:00:00.000Z',
    },
  },
};

const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-/;

async function main(){
  const page = await open(process.env.CDP_PORT, process.env.APP_URL, {
    beforeLoad: 'window.__dialogs = [];' +
           'window.alert = message => window.__dialogs.push(message);' +
           'window.confirm = () => true;' +
           'window.__projectCount = 0;' +
           'window.prompt = () => "project " + (++window.__projectCount);' +
           FULL_STORAGE + RECORD_DOWNLOADS,
  });

  // Keep only the supplied localStorage keys and restart the app with them.
  const restartApp = async keys => {
    await page.evaluate('localStorage.clear()');
    for (const [key, value] of Object.entries(keys))
      await page.evaluate(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`);
    await page.reload();
  };

  // --- clean startup ---
  await restartApp({});
  check('without saved data, starts with one project',
            await page.evaluate('Object.keys(projects).length') === 1);
  check('startup project uses an id rather than its name as the key',
            PROJECT_ID_PATTERN.test(await page.evaluate('openProjectId')));
  check('startup project is named "example kitchen"',
            await page.evaluate('projects[openProjectId].name') === 'example kitchen');
  // The first thing every visitor sees: buyers install kitchens rather than
  // furnish bedrooms.
  check('it is a kitchen with a counter and a fridge',
            await page.evaluate(`pieces.some(piece => piece.label === 'counter') &&
                             pieces.some(piece => piece.label === 'fridge')`));
  // First-time visitors cannot discover openings, pieces or rotation on a blank
  // canvas: that is what the sample project is for.
  check('startup includes a drawn project rather than an empty canvas',
            await page.evaluate('walls.length === 1 && pieces.length > 3'));
  check('the sample project shows an opening in the wall',
            await page.evaluate('walls[0].some(point => point.openings.length)'));
  check('the sample project is marked for removal when the first user project is created',
            await page.evaluate('projects[openProjectId].isSample') === true);
  await page.evaluate('pieces.push({x:0,y:0,w:10,h:10,angle:0,shape:"rect",label:""}); draw()');
  check('editing it clears the sample project flag',
            await page.evaluate('projects[openProjectId].isSample') === false);

  // The format version travels with the project: if `captureProject` drops it or
  // the duplication handler in `renderProjectList` omits it, an imported project
  // cannot identify its format. This only becomes apparent once two formats exist.
  check('the saved project carries the format version',
            await page.evaluate('projects[openProjectId].formatVersion') === 2);
  check('the format version is also included in the file contents',
            await page.evaluate('projects[openProjectId].formatVersion') === 2);

  for (const formatVersion of [undefined, 3]){
    const project = {...SAVED_PROJECTS.projects[SAVED_PROJECTS.openProjectId], formatVersion};
    const errorMessage = await page.evaluate(`(() => {
      try { validateProject(${JSON.stringify(project)}); return 'ACCEPTED'; }
      catch (error){ return error.message; }
    })()`);
    check('formatVersion ' + formatVersion + ' is rejected with a message naming it',
              errorMessage.includes('formatVersion') &&
              (formatVersion === undefined || errorMessage.includes('3')), errorMessage);
  }

  // --- format 2: copies (contracts/5-copies.md) ---
  // A version 1 project becomes one copy named "copy 1", with nothing shared
  // and nothing left at the top level: a migration that kept `walls` beside
  // `copies` would be rejected as unknown fields on the next load.
  const garage = SAVED_PROJECTS.projects[SAVED_PROJECTS.openProjectId];
  const migrated = await page.evaluate(`validateProject(${JSON.stringify(garage)})`);
  // Field order is not part of the format: compare with sorted keys.
  const canonical = value => JSON.stringify(value, (key, field) => field && typeof field === 'object' && !Array.isArray(field)
    ? Object.fromEntries(Object.entries(field).sort(([first], [second]) => first < second ? -1 : 1)) : field);
  check('a version 1 project migrates to one copy named "copy 1"',
            canonical(migrated) === canonical({name: 'garage', formatVersion: 2,
              copies: [{name: 'copy 1', walls: garage.walls, pieces: garage.pieces}],
              shared: {points: [], pieces: []}, view: garage.view, modifiedAt: garage.modifiedAt, isSample: false}),
            JSON.stringify(migrated));

  const twoCopies = {...migrated, copies: [migrated.copies[0],
    {name: 'copy 2', walls: [], pieces: [{x:5, y:5, w:20, h:20, angle:0, shape:'ellipse', label:'lamp'}]}]};
  const errorFor = project => page.evaluate(`(() => {
    try { validateProject(${JSON.stringify(project)}); return 'ACCEPTED'; }
    catch (error){ return error.message; } })()`);
  check('a version 2 project with two copies is accepted', await errorFor(twoCopies) === 'ACCEPTED', await errorFor(twoCopies));
  const withoutCopyLabel = JSON.parse(JSON.stringify(twoCopies));
  delete withoutCopyLabel.copies[1].pieces[0].label;
  check('a field missing inside a copy is named with its copy',
            await errorFor(withoutCopyLabel) === 'The project is missing "copies[1].pieces[0].label".', await errorFor(withoutCopyLabel));
  const withoutPointLabel = {...twoCopies, shared: {points: [{x: 1, y: 2}], pieces: []}};
  check('a shared point is {x, y, label}, all required',
            await errorFor(withoutPointLabel) === 'The project is missing "shared.points[0].label".', await errorFor(withoutPointLabel));
  const copyWithExtraField = JSON.parse(JSON.stringify(twoCopies));
  copyWithExtraField.copies[0].view = {};
  check('a field outside the format inside a copy is rejected',
            await errorFor(copyWithExtraField) === 'Unknown project field "copies[0].view".', await errorFor(copyWithExtraField));
  check('a project needs at least one copy',
            await errorFor({...twoCopies, copies: []}) === 'Invalid project field "copies".', await errorFor({...twoCopies, copies: []}));
  check('a version 2 project with walls at the top level is rejected',
            await errorFor({...twoCopies, walls: []}) === 'Unknown project field "walls".', await errorFor({...twoCopies, walls: []}));

  // A stored version 1 save opens on its first copy and is written back as
  // version 2 on the next save.
  await restartApp({'tapesketch.v1': JSON.stringify(SAVED_PROJECTS)});
  check('a stored version 1 save opens on the canvas as before',
            await page.evaluate('pieces.length === 1 && pieces[0].label === "car" && walls.length === 0'));
  await page.evaluate('saveProject()');
  await page.sleep(400);
  const storedAfterSave = JSON.parse(await page.evaluate('localStorage.getItem("tapesketch.v1")'));
  check('and it is stored as version 2 after a save',
            Object.values(storedAfterSave.projects).every(project => project.formatVersion === 2 && project.copies.length === 1),
            JSON.stringify(storedAfterSave).slice(0, 300));

  // Only the first copy is edited for now: saving must keep the others.
  const twoCopiesResult = await page.evaluate(`(() => {
    try { importProject('two copies', ${JSON.stringify(JSON.stringify(twoCopies))}); return 'ACCEPTED'; }
    catch (error){ return error.message; } })()`);
  await page.evaluate('pieces.push({x:50, y:50, w:10, h:10, angle:0, shape:"rect", label:"box"}); draw(); storeOpenProject()');
  check('a project with two copies opens on the first, and saving keeps the second untouched',
            twoCopiesResult === 'ACCEPTED' &&
            await page.evaluate('projects[openProjectId].copies.length') === 2 &&
            await page.evaluate('projects[openProjectId].copies[0].pieces.length') === 2 &&
            canonical(await page.evaluate('projects[openProjectId].copies[1]')) === canonical(twoCopies.copies[1]),
            twoCopiesResult);

  const projectWithoutThickness = JSON.parse(JSON.stringify(Object.values(SAVED_PROJECTS.projects)[0]));
  delete projectWithoutThickness.walls[0][1].thickness;
  const thicknessError = await page.evaluate(`(() => {
    try { validateProject(${JSON.stringify(projectWithoutThickness)}); return 'ACCEPTED'; }
    catch (error){ return error.message; }
  })()`);
  check('a wall missing thickness is rejected with a message naming it',
            thicknessError.includes('walls[0][1].thickness'), thicknessError);

  const projectWithoutLabel = JSON.parse(JSON.stringify(SAVED_PROJECTS.projects[SAVED_PROJECTS.openProjectId]));
  delete projectWithoutLabel.pieces[0].label;
  const labelError = await page.evaluate(`(() => {
    try { validateProject(${JSON.stringify(projectWithoutLabel)}); return 'ACCEPTED'; }
    catch (error){ return error.message; }
  })()`);
  check('a piece missing label is rejected with a message naming it',
            labelError === 'The project is missing "pieces[0].label".', labelError);

  // A field outside the format would otherwise ride along into storage and
  // every export: it is rejected where it sits, at any depth.
  const projectWithExtraField = {...SAVED_PROJECTS.projects[SAVED_PROJECTS.openProjectId], rects: []};
  const extraFieldError = await page.evaluate(`(() => {
    try { validateProject(${JSON.stringify(projectWithExtraField)}); return 'ACCEPTED'; }
    catch (error){ return error.message; }
  })()`);
  check('a field outside the format is rejected with a message naming it',
            extraFieldError === 'Unknown project field "rects".', extraFieldError);

  await restartApp({'tapesketch.v1': JSON.stringify(SAVED_PROJECTS)});
  const previousId = await page.evaluate('openProjectId');
  await page.reload();
  check('the id survives a reload',
            await page.evaluate('openProjectId') === previousId,
            await page.evaluate('openProjectId'));

  // --- renaming is why the id exists ---
  await restartApp({'tapesketch.v1': JSON.stringify(SAVED_PROJECTS)});
  const id = await page.evaluate('Object.entries(projects).find(([, project]) => project.name === "house")[0]');
  await page.evaluate(`renameProject(${JSON.stringify(id)}, 'new house')`);
  check('renaming preserves the id',
            await page.evaluate(`!!projects[${JSON.stringify(id)}]`));
  check('renaming changes the name',
            await page.evaluate(`projects[${JSON.stringify(id)}].name`) === 'new house');
  check('renaming preserves the contents',
            await page.evaluate(`projects[${JSON.stringify(id)}].copies[0].walls[0].length`) === 2);
  check('renaming does not create an extra project',
            await page.evaluate('Object.keys(projects).length') === 2);

  const openId = await page.evaluate('openProjectId');
  await page.evaluate(`renameProject(openProjectId, 'new garage')`);
  check('renaming the open project keeps it open',
            await page.evaluate('openProjectId') === openId);

  check('a duplicate name is still rejected',
            await page.evaluate(`(() => { try { renameProject(${JSON.stringify(id)}, 'new garage');` +
                            ` return 'no error'; } catch (error){ return 'error'; } })()`) === 'error');

  // --- unreadable saved data ---
  await restartApp({'tapesketch.v1': 'this is not json'});
  check('corrupt saved data is set aside under its original key',
            await page.evaluate('localStorage.getItem("tapesketch.v1.corrupt")') === 'this is not json');
  // The key is cleared and a fresh startup writes the sample project again:
  // corrupt data must not remain there.
  check('corrupt saved data is removed from the active key',
            await page.evaluate('localStorage.getItem("tapesketch.v1")') !== 'this is not json');
  check('corrupt saved data triggers one alert',
            await page.evaluate('__dialogs.length') === 1);
  check('after corrupt saved data, startup creates one project',
            await page.evaluate('Object.keys(projects).length') === 1);

  // A save whose open project points nowhere is corrupt, not something to
  // patch up: it goes aside like any other, and startup does not crash.
  await restartApp({'tapesketch.v1': JSON.stringify({...SAVED_PROJECTS, openProjectId: 'nowhere'})});
  check('a save pointing at a missing project is set aside',
            JSON.parse(await page.evaluate('localStorage.getItem("tapesketch.v1.corrupt")')).openProjectId === 'nowhere' &&
            await page.evaluate('Object.keys(projects).length') === 1);
  await restartApp({'tapesketch.v1': JSON.stringify({openProjectId: 'x', projects: []})});
  check('a save whose projects are not an object is set aside',
            await page.evaluate('localStorage.getItem("tapesketch.v1.corrupt")') ===
              JSON.stringify({openProjectId: 'x', projects: []}) &&
            await page.evaluate('Object.keys(projects).length') === 1);

  // With the storage full, the copy under ".corrupt" fails. The app still
  // starts, and the save survives as a download instead of staying in a key
  // that the first save of the sample would overwrite.
  await page.evaluate('sessionStorage.setItem("__failWrites", "tapesketch.v1.corrupt")');
  await restartApp({'tapesketch.v1': 'this is not json'});
  check('a corrupt save that cannot be copied does not stop startup',
            await page.evaluate('Object.keys(projects).length') === 1, page.exceptions.join(' '));
  check('and it is downloaded instead, with the alert saying so',
            await page.evaluate(`__downloads.length === 1 && __downloads[0].name === 'tapesketch.v1.corrupt.json' &&
              __downloads[0].blob.text()`) === 'this is not json' &&
            /downloaded file/.test(await page.evaluate('__dialogs.join(" ")')));
  await page.evaluate('sessionStorage.removeItem("__failWrites")');

  // A save that fails because the storage is full is said out loud, once,
  // and stays visible until a save gets through.
  await restartApp({'tapesketch.v1': JSON.stringify(SAVED_PROJECTS)});
  await page.evaluate(`window.__dialogs = []; window.__realSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); }`);
  await page.evaluate('pieces.push({x:0, y:0, w:10, h:10, angle:0, shape:"rect", label:"box"}); saveProject()');
  await page.sleep(400);
  await page.evaluate('saveProject()');
  await page.sleep(400);
  check('a save the full storage refuses is shown in the status bar, with one alert',
            await page.evaluate('!saveFailedNotice.hidden && localSaveNotice.hidden') &&
            await page.evaluate('__dialogs.length') === 1, await page.evaluate('__dialogs.join(" ")'));
  await page.evaluate('Storage.prototype.setItem = __realSetItem; saveProject()');
  await page.sleep(400);
  check('the notice goes when a save gets through, and the save has what was drawn',
            await page.evaluate('saveFailedNotice.hidden && !localSaveNotice.hidden') &&
            JSON.parse(await page.evaluate('localStorage.getItem("tapesketch.v1")'))
              .projects[SAVED_PROJECTS.openProjectId].copies[0].pieces.length === 2);

  // --- unlimited projects ---
  // Catch any restriction on creating, duplicating or importing, and incorrect
  // removal of an edited sample project or retention of an untouched one.
  await page.evaluate('localStorage.clear()');
  await page.reload();
  await page.evaluate('window.__dialogs = []');
  check('startup contains only the sample project',
            await page.evaluate('Object.keys(projects).length') === 1 &&
            await page.evaluate('projects[openProjectId].isSample') === true);

  await page.evaluate('newProjectButton.click()');
  await page.sleep(200);
  check('with the sample project untouched, the first user project is created without alerts',
            await page.evaluate('Object.keys(projects).length') === 1 &&
            await page.evaluate('__dialogs.length') === 0);
  check('the sample project disappears from the list',
            await page.evaluate('Object.values(projects).some(project => project.isSample)') === false);

  await page.evaluate('newProjectButton.click()');
  await page.sleep(200);
  check('the second project is created without alerts',
            await page.evaluate('Object.keys(projects).length') === 2 &&
            await page.evaluate('__dialogs.length') === 0);

  await page.evaluate(`openProjectManager();
    [...projectList.querySelectorAll('button')].find(button => button.textContent === 'DUPLICATE').click()`);
  await page.sleep(200);
  check('duplicating in the project manager creates the third project without alerts',
            await page.evaluate('Object.keys(projects).length') === 3 &&
            await page.evaluate('__dialogs.length') === 0);

  const importResult = await page.evaluate(`(() => {
    try { importProject('imported project', JSON.stringify({name:'imported project', formatVersion:1, walls:[], pieces:[], view:{offsetX:0, offsetY:0, pxPerCm:0.9}, modifiedAt:'2026-08-01T10:00:00.000Z', isSample:false})); return 'ACCEPTED'; }
    catch (error){ return error.message; } })()`);
  check('importing creates the fourth project without alerts',
            importResult === 'ACCEPTED' && await page.evaluate('Object.keys(projects).length') === 4 &&
            await page.evaluate('__dialogs.length') === 0, importResult);

  check('drawing and saving still work',
            await page.evaluate('pieces.push({x:0,y:0,w:10,h:10,angle:0,shape:"rect",label:""}); ' +
                            'draw(); storeOpenProject(); projects[openProjectId].copies[0].pieces.length') === 1);

  // An edited sample project is no longer the sample project and is kept.
  await page.evaluate('localStorage.clear()');
  await page.reload();
  const editedSampleId = await page.evaluate('openProjectId');
  await page.evaluate('renameProject(openProjectId, "edited sample project")');
  await page.evaluate('window.__dialogs = []; newProjectButton.click()');
  await page.sleep(200);
  check('the edited sample project is kept when another is created without alerts',
            await page.evaluate('Object.keys(projects).length') === 2 &&
            await page.evaluate(`projects[${JSON.stringify(editedSampleId)}].name`) === 'edited sample project' &&
            await page.evaluate('__dialogs.length') === 0);
  await page.evaluate('closeProjectManager()');

  // --- the first minute ---
  // The three steps appear once per browser, disappear as soon as something is
  // drawn and never return. Catch dismissal caused by opening an existing
  // project with walls rather than by drawing.
  await page.evaluate('localStorage.clear()');
  await page.reload();
  check('the three first steps appear on the first visit',
            await page.evaluate('firstStepsPanel.hidden') === false);
  await page.evaluate('openProjectManager(); closeProjectManager(); storeOpenProject(); draw()');
  check('opening the project manager or saving does not dismiss them',
            await page.evaluate('firstStepsPanel.hidden') === false);

  await page.evaluate('pieces.push({x:0,y:0,w:50,h:50,angle:0,shape:"rect",label:""}); draw(); draw()');
  check('drawing dismisses them immediately', await page.evaluate('firstStepsPanel.hidden') === true);
  await page.reload();
  check('they do not return after reloading', await page.evaluate('firstStepsPanel.hidden') === true);

  check('no uncaught page exceptions', !page.exceptions.length, page.exceptions.join(' | '));
  page.close();
  finish();
}

main();
