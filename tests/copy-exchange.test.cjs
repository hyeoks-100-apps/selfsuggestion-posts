'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const api = require('../sajupinggye/copy-exchange.js');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const libraries = ['campaigns-300.json', 'campaigns-v2.json', 'campaigns.json'];
const rows = libraries.flatMap(file => JSON.parse(fs.readFileSync(path.join(root, 'sajupinggye', file), 'utf8')).campaigns.flatMap(campaign => api.LOCALES.map(locale => {
  const copy = campaign.locales[locale];
  return { id: campaign.id, locale, topic: copy.topic ?? campaign.topic, label: copy.label, imageBrief: copy.imageBrief ?? '', slides: copy.slides.map(slide => ({ eyebrow: slide.eyebrow ?? '', title: slide.title, body: slide.body, note: slide.note })), caption: copy.caption, hashtags: copy.hashtags };
})));
const sample = () => clone(rows.slice(0, 3));
const changed = () => { const envelope = api.makeEnvelope(sample()); envelope.posts[0].slides[0].title = '새 제목'; return envelope; };
const issueAt = (fn, field) => assert.throws(fn, error => error.name === 'CopyExchangeError' && Array.isArray(error.issues) && error.issues.some(issue => issue.field === field && typeof issue.message === 'string'));

for (const file of libraries) test(`${file}: all three languages and 3/5 pages round-trip unchanged`, () => {
  const campaigns = JSON.parse(fs.readFileSync(path.join(root, 'sajupinggye', file), 'utf8')).campaigns;
  const subset = rows.filter(row => campaigns.some(campaign => campaign.id === row.id));
  const original = clone(subset), envelope = api.makeEnvelope(subset), plan = api.plan([api.parse(JSON.stringify(envelope))], subset);
  assert.equal(plan.total, campaigns.length * 3);
  assert.equal(plan.unchanged, subset.length);
  assert.deepEqual(plan.changes, []);
  assert.deepEqual(plan.counts, { ko: campaigns.length, ja: campaigns.length, en: campaigns.length });
  assert.deepEqual(subset, original);
  assert.ok(envelope.posts.every(row => /^[0-9a-f]{16}$/.test(row.baseRevision)));
});

test('all 417 rows export together without any picture or studio settings', () => {
  const envelope = api.makeEnvelope(rows);
  assert.equal(envelope.posts.length, 417);
  assert.ok(envelope.posts.every(row => !['artwork', 'backgrounds', 'posted', 'visualSourceId', 'settings'].some(key => key in row)));
  assert.equal(api.plan([envelope], rows).unchanged, 417);
});

test('only the changed locale is planned, with field-level paths and detached before/after copies', () => {
  const current = sample(), envelope = changed(), snapshot = JSON.stringify({ current, envelope });
  envelope.posts[0].label = '수정된 기획';
  envelope.posts[0].hashtags = ['#원고'];
  const frozenInput = JSON.stringify({ current, envelope });
  const plan = api.plan([envelope], current);
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.unchanged, 2);
  assert.equal(plan.changes[0].locale, 'ko');
  assert.deepEqual(plan.changes[0].fields, ['label', 'slides[0].title', 'hashtags']);
  assert.equal(plan.changes[0].before.slides[0].title, current[0].slides[0].title);
  assert.equal(plan.changes[0].after.slides[0].title, '새 제목');
  assert.equal(JSON.stringify({ current, envelope }), frozenInput);
  assert.notEqual(snapshot, frozenInput);
  plan.changes[0].after.slides[0].title = 'detached';
  assert.equal(envelope.posts[0].slides[0].title, '새 제목');
  assert.ok(!('id' in plan.changes[0].after));
});

test('multiple partial files merge atomically and do not change missing rows', () => {
  const current = sample();
  const ko = api.makeEnvelope([current[0]]), en = api.makeEnvelope([current[2]]);
  ko.posts[0].topic = '한국 주제'; en.posts[0].topic = 'English topic';
  const plan = api.plan([ko, en], current);
  assert.equal(plan.total, 2);
  assert.equal(plan.changes.length, 2);
  assert.deepEqual(plan.changes.map(change => change.locale), ['ko', 'en']);
  assert.deepEqual(plan.counts, { ko: 1, ja: 0, en: 1 });
  en.posts[0].slides[2].body = 42;
  issueAt(() => api.plan([ko, en], current), 'slides[2].body');
  assert.equal(current[0].topic, rows[0].topic, 'even valid first file is never applied by validation');
});

test('duplicate pairs are rejected inside a file and across uploaded files', () => {
  const envelope = api.makeEnvelope(sample()); envelope.posts.push(clone(envelope.posts[0]));
  issueAt(() => api.plan([envelope], sample()), 'id');
  const first = api.makeEnvelope([rows[0]]);
  issueAt(() => api.plan([first, clone(first)], sample()), 'id');
  issueAt(() => api.makeEnvelope([rows[0], rows[0]]), 'id');
});

test('changed stale drafts are conflicts, unchanged stale drafts are idempotent', () => {
  const current = sample(), envelope = changed();
  const staleCurrent = clone(current); staleCurrent[0].caption = '작업실에서 나중에 쓴 글';
  issueAt(() => api.plan([envelope], staleCurrent), 'baseRevision');
  const applied = clone(current); applied[0].slides[0].title = '새 제목';
  assert.equal(api.plan([envelope], applied).unchanged, 3);
  assert.equal(api.plan([envelope], applied).changes.length, 0);
});

test('unsupported versions, missing fields and design/settings injections reject', () => {
  for (const [field, value] of [['format', 'wrong-format'], ['version', 2]]) {
    const envelope = changed(); envelope[field] = value;
    issueAt(() => api.plan([envelope], sample()), `files[0].${field}`);
  }
  for (const field of ['topic', 'label', 'imageBrief', 'slides', 'caption', 'hashtags', 'id', 'locale', 'baseRevision']) {
    const envelope = changed(); delete envelope.posts[0][field];
    issueAt(() => api.plan([envelope], sample()), field);
  }
  for (const field of ['backgrounds', 'artwork', 'posted', 'settings', 'photos', 'constructor', '__proto__']) {
    const envelope = changed(); Object.defineProperty(envelope.posts[0], field, { value: 'injected', enumerable: true });
    issueAt(() => api.plan([envelope], sample()), field);
  }
  const envelope = changed(); envelope.posts[0].slides[0].html = '<b>no</b>';
  issueAt(() => api.plan([envelope], sample()), 'slides[0].html');
  const extra = changed(); extra.metadata = {};
  issueAt(() => api.plan([extra], sample()), 'files[0].metadata');
});

test('identity, known IDs, revision and original slide count are mandatory', () => {
  for (const [field, value] of [['id', 'not-in-this-studio'], ['locale', 'fr'], ['baseRevision', '123'], ['id', '__proto__']]) {
    const envelope = changed(); envelope.posts[0][field] = value;
    issueAt(() => api.plan([envelope], sample()), field);
  }
  const envelope = changed(); envelope.posts[0].slides.push(clone(envelope.posts[0].slides[0]), clone(envelope.posts[0].slides[0]));
  issueAt(() => api.plan([envelope], sample()), 'slides');
});

test('every text cap, required label, control characters and hashtag rules reject', () => {
  for (const field of ['topic', 'label', 'imageBrief', 'caption']) {
    const envelope = changed(); envelope.posts[0][field] = 'x'.repeat(api.LIMITS[field] + 1);
    issueAt(() => api.plan([envelope], sample()), field);
  }
  for (const field of ['eyebrow', 'title', 'body', 'note']) {
    const envelope = changed(); envelope.posts[0].slides[0][field] = 'x'.repeat(api.LIMITS[field] + 1);
    issueAt(() => api.plan([envelope], sample()), `slides[0].${field}`);
  }
  for (const label of ['', '   ', 'bad\u0000text']) {
    const envelope = changed(); envelope.posts[0].label = label;
    issueAt(() => api.plan([envelope], sample()), 'label');
  }
  for (const tags of [['plain'], ['#'], ['#two words'], ['#' + 'a'.repeat(80)], ['#1', '#2', '#3', '#4', '#5', '#6'], 'not-array']) {
    const envelope = changed(); envelope.posts[0].hashtags = tags;
    assert.throws(() => api.plan([envelope], sample()), error => error.issues.some(issue => issue.field.startsWith('hashtags')));
  }
  const envelope = changed(); envelope.posts[0].caption = 'x'.repeat(2198); envelope.posts[0].hashtags = ['#x'];
  issueAt(() => api.plan([envelope], sample()), 'caption');
});

test('raw UTF-8 bytes, aggregate import bytes and invalid JSON are bounded', () => {
  issueAt(() => api.parse(' '.repeat(api.MAX_BYTES + 1)), 'file');
  issueAt(() => api.parse('가'.repeat(Math.ceil(api.MAX_BYTES / 3))), 'file');
  issueAt(() => api.parse('```json\n{}\n```'), 'file');
  const envelope = changed(); envelope.unwanted = 'a'.repeat(api.MAX_BYTES);
  issueAt(() => api.plan([envelope], sample()), 'file');
  const left = changed(), right = changed(); left.unwanted = right.unwanted = 'a'.repeat(api.MAX_BYTES / 2);
  issueAt(() => api.plan([left, right], sample()), 'file');
  issueAt(() => api.plan([], sample()), 'files');
});

test('revision is deterministic across object order and preserves exact text differences', () => {
  const row = clone(rows[0]), reordered = Object.fromEntries(Object.entries(row).reverse());
  assert.equal(api.revision(row), api.revision(reordered));
  row.slides[0].title += ' ';
  assert.notEqual(api.revision(row), api.revision(rows[0]));
  assert.equal(api.revision(rows[0]).length, 16);
});

test('HTML-shaped prose remains inert literal text; module has no DOM or storage capability', () => {
  const envelope = changed(), value = '<img src=x onerror=alert(1)> & "quotes" </script>';
  envelope.posts[0].slides[0].body = value;
  const plan = api.plan([envelope], sample());
  assert.equal(plan.changes[0].after.slides[0].body, value);
  assert.equal(envelope.posts[0].slides[0].body, value);
  const source = fs.readFileSync(path.join(root, 'sajupinggye/copy-exchange.js'), 'utf8');
  assert.doesNotMatch(source, /\b(?:document|localStorage|indexedDB|innerHTML|fetch)\b/);
  const context = vm.createContext({ TextEncoder });
  vm.runInContext(source, context);
  assert.equal(context.SajuCopyExchange.FORMAT, api.FORMAT);
  assert.equal(context.SajuCopyExchange.VERSION, 1);
});
