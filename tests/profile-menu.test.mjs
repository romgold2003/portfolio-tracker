/**
 * The profile button (November 2026): bottom left of the menu, in place of the
 * account's name, opening one panel for the account itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const html = read('index.html');
const panel = html.slice(html.indexOf('id="profilePop"'), html.indexOf('<main class="main">'));

test('the button sits at the foot of the menu and opens the panel', () => {
  const side = html.slice(html.indexOf('id="sidebarBot"'), html.indexOf('</aside>'));
  assert.match(side, /<button class="profile-btn" id="profileBtn" type="button" onclick="openProfile\(\)"/);
  assert.doesNotMatch(side, /id="settingsBtn"/, 'Settings moved into the panel');
  assert.match(read('src/app/actions.js'), /openProfile, closeProfile, profileGo,/);
});

test('the panel holds the account, imports and settings, what friends see, the password and signing out', () => {
  assert.match(panel, /id="acctSwitch"/);
  assert.match(panel, /onclick="profileGo\('import'\)"[\s\S]*Import files/);
  assert.match(panel, /id="settingsBtn" type="button" onclick="profileGo\('settings'\)"/);
  assert.match(panel, /What your friends see[\s\S]*id="profileShare"/);
  assert.match(panel, /Change password[\s\S]*id="pfPass"[\s\S]*id="pfPass2"/);
  assert.match(panel, /id="accountRow"[\s\S]*signOut\(\)/);
});

test('import opens the settings with the file importer; the password needs 8 characters and two matching entries', () => {
  const view = read('src/ui/views/profileMenu.js');
  assert.match(view, /if \(where === 'import'\) \{ window\.openSettings\?\.\(\); window\.openYearsPanel\?\.\(\); \}/);
  assert.match(view, /if \(a\.length < 8\)/);
  assert.match(view, /if \(a !== b\)/);
  assert.match(view, /await setPassword\(a\)/);
  assert.match(view, /await setShowing\(mode\)/);
});
