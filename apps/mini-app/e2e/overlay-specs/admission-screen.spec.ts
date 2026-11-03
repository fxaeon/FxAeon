import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { AdmissionAction, AdmissionScreenProps, AdmissionScreenState } from '../../src/components/admission/AdmissionScreen';

const app = resolve(__dirname, '../..');
const esbuild = createRequire(createRequire(resolve(app, 'package.json')).resolve('tsx/package.json'))('esbuild') as {
  build: (options: Record<string, unknown>) => Promise<{
    outputFiles: Array<{ path: string; text: string }>;
    metafile: { inputs: Record<string, unknown> };
  }>;
};
let script = '';
let css = '';
type Harness = typeof globalThis & {
  admission: { render: (props: Partial<AdmissionScreenProps>) => void; actions: AdmissionAction[] };
};

test.beforeAll(async () => {
  const bundle = await esbuild.build({
    stdin: { contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import './src/app/globals.css';
      import {AdmissionScreen} from './src/components/admission/AdmissionScreen';
      const root = createRoot(document.getElementById('root'));
      let props = {state:'full',email:'',supportHref:'mailto:help@example.com'};
      const actions = [];
      const render = next => {
        props = {...props,...next};
        root.render(<AdmissionScreen {...props} onAction={action => actions.push(action)}
          onEmailChange={email => render({email})} />);
      };
      globalThis.admission = {render,actions};
      render({});`, loader: 'tsx', resolveDir: app },
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic',
    outdir: resolve(app, 'test-results/admission-harness'), absWorkingDir: app,
    loader: { '.module.css': 'local-css' }, external: ['/fonts/*'], metafile: true,
  });
  expect(Object.keys(bundle.metafile.inputs).join('\n')).not.toMatch(/@privy|telegramAdmission|PrivyClientProvider|lib\/telegram/);
  script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  css = bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text;
});

async function mount(page: Page) {
  await page.route('**/*', route => route.abort());
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Early access is full.');
}
async function show(page: Page, props: Partial<AdmissionScreenProps>) {
  await page.evaluate(props => (globalThis as Harness).admission.render(props), props);
  const expected = props.state === 'waiting' && props.notificationPermission === 'denied' ? 'alerts-off' : props.state;
  if (expected) await expect(page.getByRole('main')).toHaveAttribute('data-admission-state', expected);
}
const actions = (page: Page) => page.evaluate(() => (globalThis as Harness).admission.actions);

const cases: Array<[AdmissionScreenState, string | null, AdmissionAction | null, string?, AdmissionAction?]> = [
  ['intro', 'Join', 'join', 'Use FxAeon on the web', 'open-web'],
  ['full', 'Join the waitlist', 'join', 'Use FxAeon on the web', 'open-web'],
  ['waiting', 'Done', 'done', 'Get an email invite', 'add-email'],
  ['alerts-off', 'Allow Telegram invites', 'allow-notifications', 'Use email instead', 'add-email'],
  ['email', 'Send confirmation link', 'submit-email', 'Skip for now', 'back-to-waitlist'],
  ['verify', 'Check email status', 'check-email-status', 'Back to the waitlist', 'back-to-waitlist'],
  ['verified', 'Done', 'done', 'Change email', 'add-email'],
  ['invited', 'Set up my wallet', 'setup-wallet', 'Set up later', 'defer-setup'],
  ['passkey', 'Create passkey', 'create-passkey', 'Back', 'back-to-invitation'],
  ['ready', 'Open FxAeon', 'open-app'],
  ['setup-error', 'Try setup again', 'retry-setup', 'Set up later', 'defer-setup'],
  ['join-error', 'Try again', 'retry-join', 'Use FxAeon on the web', 'open-web'],
  ['checking', null, null],
];

for (const colorScheme of ['light', 'dark'] as const) {
  for (const width of [320, 390]) {
    test(`all states fit ${width}px in device ${colorScheme} theme`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 640 });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await mount(page);
      await page.screenshot({ path: testInfo.outputPath('full.png') });
      for (const [state] of cases) {
        await show(page, { state });
        if (state === 'waiting') await page.screenshot({ path: testInfo.outputPath('waiting.png') });
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
        expect(await page.getByRole('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        const background = await page.getByRole('main').evaluate(el => getComputedStyle(el).backgroundColor);
        expect(background).toBe(colorScheme === 'light' ? 'rgb(250, 250, 249)' : 'rgb(11, 12, 14)');
        for (const control of await page.locator('button, input, footer a').all()) {
          await control.scrollIntoViewIfNeeded();
          const box = (await control.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.y + box.height).toBeLessThanOrEqual(640);
        }
      }
    });
  }
}

test('actions only call the parent; clicks never advance admission', async ({ page }) => {
  await mount(page);
  const expected: AdmissionAction[] = [];
  for (const [state, primary, action, secondary, secondaryAction] of cases) {
    await show(page, { state, email: 'person@example.com' });
    if (primary && action) {
      await page.getByRole('button', { name: primary, exact: true }).click();
      expected.push(action);
    }
    if (secondary && secondaryAction) {
      await page.getByRole('button', { name: secondary, exact: true }).click();
      expected.push(secondaryAction);
    }
    expect(await actions(page)).toEqual(expected);
    await expect(page.getByRole('main')).toHaveAttribute('data-admission-state', state);
  }
});

test('email supports native validation, Enter submission, skipping, and busy protection', async ({ page }) => {
  await mount(page);
  await show(page, { state: 'email' });
  const field = page.getByRole('textbox', { name: 'Email address' });
  const submit = page.getByRole('button', { name: 'Send confirmation link' });
  await submit.click();
  expect(await actions(page)).toEqual([]);
  await field.fill('invalid');
  await field.press('Enter');
  expect(await actions(page)).toEqual([]);
  await page.getByRole('button', { name: 'Skip for now' }).click();
  expect(await actions(page)).toEqual(['back-to-waitlist']);
  await field.fill('person@example.com');
  await field.press('Enter');
  expect(await actions(page)).toEqual(['back-to-waitlist', 'submit-email']);
  await expect(field).toHaveValue('person@example.com');
  await show(page, { busy: true });
  await expect(field).toBeDisabled();
  await expect(submit).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Skip for now' })).toBeDisabled();
  // Even a programmatic submit while pending cannot emit a duplicate request.
  await page.getByRole('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(await actions(page)).toHaveLength(2);
});

test('notification permission changes delivery copy and the available action', async ({ page }) => {
  await mount(page);
  await show(page, { state: 'waiting', notificationPermission: 'unknown' });
  await expect(page.getByText('Your invite will arrive in this Telegram chat.')).toHaveCount(0);
  await show(page, { state: 'waiting', notificationPermission: 'granted' });
  await expect(page.getByText('Your invite will arrive in this Telegram chat.')).toBeVisible();
  await show(page, { state: 'waiting', notificationPermission: 'denied' });
  await expect(page.getByText('Your invite will arrive in this Telegram chat.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Allow Telegram invites' }).click();
  expect(await actions(page)).toEqual(['allow-notifications']);
  await expect(page.getByRole('main')).toHaveAttribute('data-admission-state', 'alerts-off');
});

test('keyboard focus and reduced motion work with enlarged text and a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 420 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(page);
  await page.keyboard.press('Tab');
  const join = page.getByRole('button', { name: 'Join the waitlist' });
  await expect(join).toBeFocused();
  expect(await join.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
  expect(await join.evaluate(el => getComputedStyle(el).transitionProperty)).toBe('none');
  await page.keyboard.press('Enter');
  expect(await actions(page)).toEqual(['join']);
  await show(page, { state: 'email' });
  await page.addStyleTag({ content: 'main h1 {font-size:68px!important} main p, main label, main button, main input {font-size:30px!important}' });
  expect(await page.getByRole('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Skip for now' }).click();
  expect(await actions(page)).toEqual(['join', 'back-to-waitlist']);
});
