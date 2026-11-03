import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AdmissionScreenProps, AdmissionScreenState } from '../src/components/admission/AdmissionScreen';

const globalReact = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globalReact.React;
globalReact.React = React;
const testRequire = createRequire(import.meta.url);
const previousCssLoader = testRequire.extensions['.css'];
const stylesPath = fileURLToPath(new URL('../src/components/admission/AdmissionScreen.module.css', import.meta.url)).toLowerCase();
testRequire.extensions['.css'] = (loadedModule, filename) => {
  if (filename.toLowerCase() !== stylesPath) {
    if (previousCssLoader) return previousCssLoader(loadedModule, filename);
    throw new Error(`Unexpected admission CSS import: ${filename}`);
  }
  const names = [...readFileSync(filename, 'utf8').matchAll(/\.([_a-zA-Z][\w-]*)/g)].map(match => match[1]);
  loadedModule.exports = Object.fromEntries([...new Set(names)].map(name => [name, name]));
};
after(() => {
  if (previousCssLoader) testRequire.extensions['.css'] = previousCssLoader;
  else delete testRequire.extensions['.css'];
  if (previousReact) globalReact.React = previousReact;
  else Reflect.deleteProperty(globalThis, 'React');
});

async function render(state: AdmissionScreenState, overrides: Partial<AdmissionScreenProps> = {}) {
  const { AdmissionScreen } = await import('../src/components/admission/AdmissionScreen');
  const props = { state, onAction: () => assert.fail('rendering must never dispatch an action'), email: '', onEmailChange: () => undefined, ...overrides } as AdmissionScreenProps;
  return renderToStaticMarkup(React.createElement(AdmissionScreen, props));
}

const states: Array<[AdmissionScreenState, string, string | null]> = [
  ['intro', 'Join early access.', 'Join'],
  ['full', 'Early access is full.', 'Join the waitlist'],
  ['waiting', 'You’re on the waitlist.', 'Done'],
  ['alerts-off', 'You’re on the waitlist.', 'Allow Telegram invites'],
  ['email', 'Your invite, by email.', 'Send confirmation link'],
  ['verify', 'Confirmation requested.', 'Check email status'],
  ['verified', 'You’re on the waitlist.', 'Done'],
  ['invited', 'Your place is ready.', 'Set up my wallet'],
  ['passkey', 'Secure your wallet.', 'Create passkey'],
  ['ready', 'You’re in.', 'Open FxAeon'],
  ['setup-error', 'Let’s try again.', 'Try setup again'],
  ['join-error', 'Let’s try again.', 'Try again'],
  ['checking', 'Checking your access.', null],
];

test('every admission state renders one named heading, FxLogo, and the correct next step', async () => {
  for (const [state, heading, action] of states) {
    const html = await render(state);
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, state);
    assert.ok(html.replace(/\s+/g, ' ').includes(`>${heading}</h1>`), state);
    assert.match(html, /<main[^>]*aria-labelledby="[^"]+-title"/);
    assert.match(html, /<svg[^>]*role="img" aria-label="FxAeon"/);
    assert.match(html, /aria-live="polite" aria-atomic="true"/);
    if (action) assert.ok(html.includes(action), state);
    else assert.doesNotMatch(html, /<button/);
    assert.doesNotMatch(html, /480|queue|\bETA\b|No marketing|second wallet|place is safe|Privy/);
  }
});

test('waiting copy is exact and Telegram delivery is permission-dependent', async () => {
  for (const permission of ['granted', 'denied', 'unknown', undefined] as const) {
    const html = await render('waiting', { notificationPermission: permission });
    const markup = html.replace(/\s+/g, ' ');
    assert.match(markup, /<h1\b[^>]*>You’re on the waitlist\.<\/h1>\s*<p\b[^>]*>We’ll send you an invite once you’re approved\.<\/p>/);
    assert.equal(markup.includes('Your invite will arrive in this Telegram chat.'), permission === 'granted');
    assert.equal(markup.includes('Allow Telegram invites'), permission === 'denied');
    if (permission === 'unknown' || permission === undefined) assert.ok(markup.includes('Check back here for your invitation.'));
    assert.doesNotMatch(markup, /email is confirmed|wallet is ready|You can close/);
  }
});

test('email collection is optional and confirmation appears only in the verified state', async () => {
  const email = await render('email', { email: 'person@example.com' });
  assert.match(email, /This is optional/);
  assert.match(email, /Skip for now/);
  assert.match(email, /<label for="([^"]+-email)">Email address<\/label><input id="\1"/);
  assert.match(email, /type="email" autoComplete="email"/);
  assert.match(email, /maxLength="254" required=""/);
  assert.match(email, /value="person@example.com"/);
  assert.match(email, /type="submit" form="[^"]+-email-form"/);
  for (const [state] of states) {
    const html = await render(state);
    assert.equal(html.includes('Your email is confirmed.'), state === 'verified', state);
    assert.equal(html.includes('Your wallet is ready.'), state === 'ready', state);
    assert.equal(html.includes('<input'), state === 'email', state);
  }
});

test('busy disables every action and email editing without claiming completion', async () => {
  for (const [state] of states) {
    const html = await render(state, { busy: true });
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /role="status">One moment…/);
    const controls = html.match(/<(?:button|input)\b[^>]*>/g) ?? [];
    assert.ok(controls.every(control => control.includes('disabled=""')), state);
  }
});

test('email request success claims acceptance only when the server reports it', async () => {
  for (const [emailDelivery, heading] of [
    ['unknown', 'Confirmation requested.'], ['pending', 'Email queued.'], ['accepted', 'Check your inbox.'],
    ['failed', 'Email couldn’t be sent.'], ['uncertain', 'Email status unconfirmed.'], ['expired', 'Confirmation link expired.'],
  ] as const) {
    const html = (await render('verify', { emailDelivery })).replace(/\s+/g, ' ');
    assert.ok(html.includes(`>${heading}</h1>`));
    assert.equal(html.includes('Check your inbox.'), emailDelivery === 'accepted');
    assert.doesNotMatch(html, /email is confirmed|email was delivered/i);
  }
});

test('parent errors are escaped and announced; support is supplied explicitly', async () => {
  for (const tag of ['script', 'SCRIPT', 'ScRiPt']) {
    const html = await render('join-error', { error: `Please retry <${tag} data-test="escape">alert(1)</${tag}>`, supportHref: 'mailto:help@example.com' });
    assert.match(html, /role="alert">Please retry &lt;/);
    assert.ok(html.includes(`&lt;${tag} data-test=&quot;escape&quot;&gt;alert(1)&lt;/${tag}&gt;`));
    assert.doesNotMatch(html, /<script\b/i);
    assert.match(html, /href="mailto:help@example.com"/);
  }
  assert.doesNotMatch(await render('full'), /Feedback &amp; reports|mailto:/);
});
