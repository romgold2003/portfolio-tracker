/**
 * The bar that says a button will not work.
 *
 * It is the first script on the page, outside the bundle, so it still runs when
 * the bundle itself is what broke. That makes it the one thing a person sees
 * when nothing else works, and the reason it has to be right about what it
 * claims.
 *
 * It was not. A browser extension injects its own script into every page it is
 * allowed to see, and when that script throws, the page it happens to be
 * standing in is the one that gets the error. A wallet extension failing to
 * reach its own wallet reported "Failed to connect to MetaMask" against this
 * app, and the person reading the bar had every reason to believe the app had
 * broken. It had not, and there was nothing here that could have fixed it.
 *
 * The filter is read out of index.html rather than copied, so this test cannot
 * quietly pass against a version of it the page no longer uses.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const match = html.match(/function fromExtension\(text\) \{([\s\S]*?)\n {2}\}/);
/* eslint-disable no-new-func */
const fromExtension = match ? new Function('text', match[1]) : null;

describe('errors an extension caused are not the app\'s', () => {
  test('the filter is still in the page at all', () => {
    assert.ok(fromExtension, 'fromExtension has gone from index.html, so nothing is being filtered');
  });

  test('the report that prompted this is ignored', () => {
    const real = 'at Object.connect (chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/scripts/inpage.js:7:84292)';
    assert.equal(!!fromExtension(real), true);
  });

  test('so are the other browsers\' extensions', () => {
    for (const url of [
      'chrome-extension://abcdefghijklmnop/inpage.js',
      'moz-extension://1234-5678/content.js:12:3',
      'safari-extension://com.example.wallet/inject.js',
      'ms-browser-extension://abc/background.js',
    ]) {
      assert.equal(!!fromExtension(url), true, url);
    }
  });
});

describe('but the app\'s own failures still get through', () => {
  test('a stack inside the bundle', () => {
    assert.equal(!!fromExtension('https://riskbook.vercel.app/index.html:4821'), false);
  });

  test('a plain message with no url at all', () => {
    assert.equal(!!fromExtension('TypeError: Cannot read properties of null (reading qty)'), false);
  });

  test('the charting library, which is third-party but is ours to have chosen', () => {
    assert.equal(!!fromExtension('https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js:2:1'), false);
  });

  test('and nothing is not something', () => {
    for (const empty of ['', null, undefined]) assert.equal(!!fromExtension(empty), false);
  });

  test('a message that merely mentions extensions is not one', () => {
    assert.equal(!!fromExtension('could not reach the extension store'), false);
    assert.equal(!!fromExtension('chrome-extension is not a protocol we use'), false);
  });
});

describe('the rest of the bar is untouched', () => {
  test('an opaque cross-origin error is still swallowed', () => {
    assert.match(html, /script error/i, 'the "Script error." guard has gone');
  });

  test('it still offers the details to copy', () => {
    assert.match(html, /Copy details/);
    assert.match(html, /buildStamp/, 'the report has to say which build it came from');
  });
});
