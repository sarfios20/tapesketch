// Drive headless Chrome through the DevTools protocol to test the actual
// interface: clicks, keys and page responses.
// No dependencies; node provides `fetch` and `WebSocket`.
//
//   const { open, createChecker } = require('./cdp.js');
//   const page = await open(9222, 'http://localhost:8080/');
//   await page.evaluate('walls.length');
//   await page.click(100, 200);
//   await page.press('b');
//   page.close();

// Codes Chrome needs for keys that do not produce text.
const KEY_CODES = {Backspace: 8, Enter: 13, Escape: 27};

// Time to wait for the page to finish loading, in ms.
const PAGE_LOAD_WAIT = 1500;

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

// Connect to the first tab in Chrome listening on `port`, navigate to `url`,
// and return its controls. Throw if Chrome is unavailable.
//
// `beforeLoad` runs on every load before the page's code to set up what the
// app will encounter (for example, override `alert`, which otherwise hangs
// a test in headless Chrome).
async function open(port, url, {beforeLoad} = {}){
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = tabs.find(tab => tab.type === 'page');
  if (!page) throw new Error('No tab in Chrome on port ' + port);

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', () => reject(new Error('Cannot connect to ' + page.webSocketDebuggerUrl)));
  });

  let id = 0;
  const pending = new Map();
  const exceptions = [];
  socket.addEventListener('message', message => {
    const data = JSON.parse(message.data);
    if (pending.has(data.id)){ pending.get(data.id)(data); pending.delete(data.id); }
    if (data.method === 'Runtime.exceptionThrown')
      exceptions.push(data.params.exceptionDetails.text + ' ' +
                      (data.params.exceptionDetails.exception?.description || ''));
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, data => data.error ? reject(new Error(method + ': ' + data.error.message)) : resolve(data.result));
    socket.send(JSON.stringify({id: requestId, method, params}));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  if (beforeLoad) await send('Page.addScriptToEvaluateOnNewDocument', {source: beforeLoad});

  const navigate = async () => {
    await send('Page.navigate', {url});
    await sleep(PAGE_LOAD_WAIT);
  };
  await navigate();

  return {
    exceptions,
    // Reload the app from scratch using the current localStorage contents.
    reload: navigate,
    // Evaluate a page expression and return its value. A page exception
    // throws here with the expression included in the message.
    async evaluate(expression){
      const response = await send('Runtime.evaluate',
                                  {expression, returnByValue: true, awaitPromise: true});
      if (response.exceptionDetails)
        throw new Error(expression + '\n' + JSON.stringify(response.exceptionDetails.exception));
      return response.result.value;
    },
    async click(x, y){
      for (const type of ['mousePressed', 'mouseReleased'])
        await send('Input.dispatchMouseEvent', {type, x, y, button: 'left', clickCount: 1});
    },
    // Press at one point, move in a few steps and release at another.
    async drag(fromX, fromY, toX, toY){
      await send('Input.dispatchMouseEvent', {type: 'mousePressed', x: fromX, y: fromY, button: 'left', clickCount: 1});
      for (let step = 1; step <= 4; step++)
        await send('Input.dispatchMouseEvent', {type: 'mouseMoved', button: 'left',
          x: fromX + (toX-fromX)*step/4, y: fromY + (toY-fromY)*step/4});
      await send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: toX, y: toY, button: 'left', clickCount: 1});
    },
    async press(key, {ctrl = false} = {}){
      const modifiers = ctrl ? 2 : 0;
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown', key, modifiers,
        text: key.length === 1 ? key : undefined,
        windowsVirtualKeyCode: KEY_CODES[key] || 0,
      });
      await send('Input.dispatchKeyEvent', {type: 'keyUp', key, modifiers});
    },
    sleep,
    close(){ socket.close(); },
  };
}

// `beforeLoad` pieces shared by suites.
// A full storage, switched on by a flag that survives the reload: every
// localStorage write whose key starts with sessionStorage "__failWrites" throws
// the error a browser throws when its storage is full.
const FULL_STORAGE =
  'const __failingPrefix = sessionStorage.getItem("__failWrites");' +
  'if (__failingPrefix){ const realSetItem = Storage.prototype.setItem;' +
  '  Storage.prototype.setItem = function(key, value){' +
  '    if (this === localStorage && key.startsWith(__failingPrefix))' +
  '      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");' +
  '    return realSetItem.call(this, key, value); }; }';
// Downloads are recorded in `__downloads` as {name, blob, href} instead of
// saved; `blob` is there for addresses made with URL.createObjectURL.
const RECORD_DOWNLOADS =
  'window.__downloads = []; const __blobs = new Map();' +
  'const realCreateObjectURL = URL.createObjectURL;' +
  'URL.createObjectURL = blob => { const address = realCreateObjectURL(blob); __blobs.set(address, blob); return address; };' +
  'HTMLAnchorElement.prototype.click = function(){' +
  '  __downloads.push({name: this.download, blob: __blobs.get(this.href), href: this.href}); };';

// Track checks and determine the exit code.
function createChecker(){
  let failures = 0;
  return {
    check(name, isPassing, details = ''){
      if (isPassing) console.log('OK   ' + name);
      else { failures++; console.log('FAIL ' + name + (details ? '  ->  ' + details : '')); }
    },
    finish(){
      console.log(failures ? '\n' + failures + ' failure(s)' : '\nall OK');
      process.exit(failures ? 1 : 0);
    },
  };
}

module.exports = {open, createChecker, FULL_STORAGE, RECORD_DOWNLOADS};
