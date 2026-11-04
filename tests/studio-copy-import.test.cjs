'use strict';
// Real studio integration boundary: browser persistence stays atomic and text-only.
// Run: node --test tests/studio-copy-import.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const draft = JSON.parse(fs.readFileSync(path.join(root, 'sajupinggye/campaigns-300.json'), 'utf8'));
const assetId = 'img_12345678-1234-1234-1234-123456789abc';
const html = fs.readFileSync(path.join(root, 'sajupinggye/index.html'), 'utf8');

function harness() {
  const records = new Map(), nodes = new Map();
  let writes = 0, failWrite = false, beforeWrite;
  function node(tag = 'div') {
    return { tagName: tag.toUpperCase(), textContent: '', value: '', open: false, hidden: false,
      checked: false, disabled: false, children: [], listeners: new Map(),
      classList: { toggle() {} }, setAttribute() {}, focus() {},
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      addEventListener(type, listener) { this.listeners.set(type, listener); },
      querySelectorAll() { return []; },
      showModal() { this.open = true; }
    };
  }
  const context = { URL, TextEncoder, setTimeout: () => 0, clearTimeout() {},
    document: { createElement: node, getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, node());
      return nodes.get(id);
    } },
    localStorage: {
      getItem: key => records.get(key) ?? null,
      setItem(key, value) {
        if (beforeWrite) beforeWrite(key, value);
        if (failWrite) throw new Error('QuotaExceededError');
        writes++; records.set(key, value);
      }
    }
  };
  // Module, window and studio share one realm, as they do in a real browser.
  context.window = context;
  vm.createContext(context);
  for (const file of ['backgrounds.js', 'copy-exchange.js']) vm.runInContext(fs.readFileSync(path.join(root, 'sajupinggye', file), 'utf8'), context);
  const source = fs.readFileSync(path.join(root, 'sajupinggye/studio.js'), 'utf8');
  assert.equal(source.match(/  start\(\);/g)?.length, 1);
  vm.runInContext(source.replace('  start();', `globalThis.boundary = {
    setup(value) { catalog = readCatalog(value); state = initialState(); },
    initialState, readCampaign, copyRows, persistCopyPlan,
    checkCopyCoverage, stageCopyPreview, invalidateCopyPreview, applyCopyImport, openCopyExchange,
    pending() { return copyPending ? clone(copyPending) : null; },
    undo() { return copyUndo ? clone(copyUndo) : null; },
    quietUi() { renderAll = () => {}; copyTextsPromise = Promise.resolve(['prompt', 'guide']); },
    primeEditor() {
      const content = localeContent(), slide = content.slides[state.settings.slideIndex];
      for (const key of ['eyebrow', 'title', 'body', 'note']) $('edit-' + key).value = slide[key];
      for (const key of ['label', 'caption']) $('edit-' + key).value = content[key];
      $('edit-topic').value = topicOf(selectedCampaign());
      $('edit-image-brief').value = content.imageBrief || '';
      $('edit-hashtags').value = content.hashtags.join(' ');
    },
    snapshot() { return clone(state); }, source() { return clone(catalog); },
    raw() { return lastSavedRaw; }, flags() { return {dirty, storageFailed, storageConflict}; },
    setFlags(value) { if ('dirty' in value) dirty = value.dirty; if ('storageConflict' in value) storageConflict = value.storageConflict; },
    mutate(callback) { callback(state); },
    seed(value) { state = readBackup(JSON.parse(JSON.stringify(value))); dirty = true; if (!saveNow()) throw new Error('fixture save failed'); return lastSavedRaw; },
    save() { dirty = true; return saveNow(); },
    exchange: window.SajuCopyExchange,
    key: STORE_KEY
  };`), context);
  const api = context.boundary;
  const campaigns = clone(draft.campaigns.slice(0, 2));
  campaigns[0].locales.ko.visualSourceId = 'source-visual';
  campaigns[0].locales.ko.artwork = 'inyeon';
  api.setup({ ...draft, campaigns });
  const backup = clone(api.initialState());
  const custom = clone(campaigns[0]); custom.id = 'my-custom'; custom.category = 'custom';
  backup.campaigns.push(custom);
  backup.settings = { campaignId: campaigns[1].id, locale: 'ja', slideIndex: 2, template: 'muk', artwork: 'inyeon', format: 'story' };
  backup.backgrounds[`${campaigns[0].id}:ko`] = [{ assetId, x: 20, y: 80, zoom: 1.75, wash: 12 }, null, null];
  backup.posted[`${campaigns[0].id}:ko`] = '2026-11-04T01:00:00.000Z';
  backup.posted['my-custom:ja'] = '2026-11-04T02:00:00.000Z';
  backup.topics[campaigns[0].id] = 'Previously edited topic';
  api.seed(backup);
  api.quietUi();
  const control = id => context.document.getElementById(id);
  control('copy-export-scope').value = 'all';
  const completenessMarkup = html.match(/<input\b[^>]*\bid="copy-require-complete"[^>]*>/)?.[0] || '';
  control('copy-require-complete').checked = /\bchecked(?:\s|>|=)/.test(completenessMarkup);
  return { api, records, campaigns, control, writes: () => writes,
    failWrites: value => { failWrite = value; },
    beforeWrite: callback => { beforeWrite = callback; } };
}

function changedPlan(api, rows = api.copyRows().slice(0, 3)) {
  const envelope = api.exchange.makeEnvelope(rows);
  envelope.posts[0].label = '새로 고친 기획 이름';
  envelope.posts[0].slides[0].title = '답장 하나에 마음이 바뀐다면';
  envelope.posts[0].hashtags = ['#사주핑계', '#연애'];
  return { envelope, plan: api.exchange.plan([envelope], api.copyRows()) };
}

function makeRollback(api, plan) {
  // Serializing the file puts it back through the same browser JSON realm.
  return api.exchange.parse(JSON.stringify({ format: api.exchange.FORMAT, version: api.exchange.VERSION,
    posts: plan.changes.map(change => ({ id: change.id, locale: change.locale,
      baseRevision: api.exchange.revision(change.after), ...clone(change.before) })) }));
}

test('a quota failure never replaces the live state, last raw or saved workspace', () => {
  const h = harness(), { api } = h;
  const { plan } = changedPlan(api), before = clone(api.snapshot()), raw = api.raw(), writes = h.writes();
  h.failWrites(true);
  assert.throws(() => api.persistCopyPlan(plan, raw), /저장 공간|저장.*차단/);
  assert.deepEqual(clone(api.snapshot()), before);
  assert.equal(api.raw(), raw);
  assert.equal(h.records.get(api.key), raw);
  assert.equal(h.writes(), writes);
  assert.equal(api.flags().dirty, false);
});

test('the full candidate is persisted once before the live state is replaced', () => {
  const h = harness(), { api } = h;
  const { plan } = changedPlan(api), before = clone(api.snapshot()), raw = api.raw(), writes = h.writes();
  let observed = false;
  h.beforeWrite((key, value) => {
    observed = true;
    assert.equal(key, api.key);
    assert.deepEqual(clone(api.snapshot()), before, 'memory still contains the old workspace at the write boundary');
    assert.equal(api.raw(), raw);
    assert.equal(JSON.parse(value).edits[`${plan.changes[0].id}:ko`].label, '새로 고친 기획 이름');
  });
  const saved = api.persistCopyPlan(plan, raw);
  assert.equal(observed, true);
  assert.equal(h.writes(), writes + 1);
  assert.equal(h.records.get(api.key), saved);
  assert.equal(api.raw(), saved);
  assert.deepEqual(clone(api.flags()), { dirty: false, storageFailed: false, storageConflict: false });
});

for (const condition of ['stale storage', 'stale preview raw', 'dirty editor', 'storage conflict']) test(`${condition} blocks applying an already inspected plan`, () => {
  const h = harness(), { api } = h, { plan } = changedPlan(api);
  const before = clone(api.snapshot()), raw = api.raw(), writes = h.writes();
  let expected = raw;
  if (condition === 'stale storage') h.records.set(api.key, 'newer-workspace-in-another-tab');
  if (condition === 'stale preview raw') expected = 'outdated-preview';
  if (condition === 'dirty editor') api.setFlags({ dirty: true });
  if (condition === 'storage conflict') api.setFlags({ storageConflict: true });
  assert.throws(() => api.persistCopyPlan(plan, expected), /작업이 바뀌었어/);
  assert.deepEqual(clone(api.snapshot()), before);
  assert.equal(api.raw(), raw);
  assert.equal(h.writes(), writes);
});

test('multiple language changes touch edits only and preserve all pictures, metadata, settings and posting records', () => {
  const h = harness(), { api } = h;
  const before = clone(api.snapshot()), originalSource = clone(api.source());
  const rows = api.copyRows(), ko = api.exchange.makeEnvelope([rows[0]]), en = api.exchange.makeEnvelope([rows[2]]);
  ko.posts[0].slides[1].body = '한국어 본문을 고쳤어.';
  en.posts[0].caption = 'A concrete English caption.';
  en.posts[0].imageBrief = '기존 사진을 유지하고 그림 메모만 수정';
  const plan = api.exchange.plan([ko, en], api.copyRows());
  assert.equal(plan.changes.length, 2);
  api.persistCopyPlan(plan, api.raw());
  const after = clone(api.snapshot());
  for (const field of ['backgrounds', 'posted', 'settings', 'campaigns', 'topics']) assert.deepEqual(after[field], before[field], field);
  assert.deepEqual(clone(api.source()), originalSource, 'catalogue artwork and visualSourceId remain unchanged');
  assert.deepEqual(Object.keys(after.edits).sort(), [`${rows[0].id}:en`, `${rows[0].id}:ko`].sort());
  assert.equal(after.edits[`${rows[0].id}:ko`].slides[1].body, '한국어 본문을 고쳤어.');
  assert.equal(after.edits[`${rows[0].id}:en`].caption, 'A concrete English caption.');
  assert.equal(after.edits[`${rows[0].id}:en`].imageBrief, '기존 사진을 유지하고 그림 메모만 수정');
  assert.deepEqual(clone(api.copyRows().find(row => row.id === rows[1].id && row.locale === 'ja')), clone(rows[1]), 'unaffected Japanese text is identical');
  assert.deepEqual(clone(api.copyRows().filter(row => row.id === 'my-custom')), clone(rows.filter(row => row.id === 'my-custom')), 'custom campaign copy is identical');
});

test('effective export includes legacy topic overrides, text edits and normalized raw hashtag drafts', () => {
  const { api, campaigns } = harness(), id = campaigns[0].id;
  const first = api.copyRows().find(row => row.id === id && row.locale === 'ko');
  assert.equal(first.topic, 'Previously edited topic');
  api.mutate(state => {
    state.edits[`${id}:ko`] = { ...clone(first), label: '직접 편집한 이름', topic: '지금 한국 주제', hashtagText: '＃새태그 #두번째 #새태그' };
    delete state.edits[`${id}:ko`].id; delete state.edits[`${id}:ko`].locale;
  });
  const exported = api.copyRows().find(row => row.id === id && row.locale === 'ko');
  assert.equal(exported.topic, '지금 한국 주제');
  assert.equal(exported.label, '직접 편집한 이름');
  assert.deepEqual(Array.from(exported.hashtags), ['#새태그', '#두번째']);
  assert.equal(api.copyRows('selected').length, 3);
  assert.equal(api.copyRows('drafts').length, 6);
  assert.equal(api.copyRows('all').length, 9);
});

test('invalid raw hashtag drafts stop export rather than silently falling back to old tags', () => {
  const { api } = harness(), first = api.copyRows()[0];
  api.mutate(state => { state.edits[`${first.id}:ko`] = { ...clone(first), hashtagText: '#a #b #c #d #e #f' }; });
  assert.throws(() => api.copyRows(), /해시태그 초안/);
  assert.equal(api.snapshot().edits[`${first.id}:ko`].hashtagText, '#a #b #c #d #e #f');
});

test('text rollback remains valid after a later photo change and preserves the new photo crop', () => {
  const { api } = harness(), originalRows = clone(api.copyRows());
  const { plan } = changedPlan(api), rollback = makeRollback(api, plan);
  api.persistCopyPlan(plan, api.raw());
  const key = `${plan.changes[0].id}:ko`;
  api.mutate(state => {
    state.backgrounds[key][0] = { assetId, x: 91, y: 13, zoom: 2.25, wash: 20 };
    state.posted[key] = '2026-11-04T03:00:00.000Z';
    state.settings.format = 'feed';
  });
  assert.equal(api.save(), true);
  const changedState = clone(api.snapshot());
  const undoPlan = api.exchange.plan([rollback], api.copyRows());
  api.persistCopyPlan(undoPlan, api.raw());
  const after = clone(api.snapshot());
  for (const field of ['backgrounds', 'posted', 'settings', 'campaigns']) assert.deepEqual(after[field], changedState[field], field);
  assert.deepEqual(clone(api.copyRows()), originalRows, 'only the imported text returns to its prior content');
});

test('text rollback rejects an intervening manual edit to the affected copy', () => {
  const { api } = harness(), { plan } = changedPlan(api), rollback = makeRollback(api, plan);
  api.persistCopyPlan(plan, api.raw());
  api.mutate(state => { state.edits[`${plan.changes[0].id}:ko`].caption = 'A new manual edit must survive.'; });
  api.save();
  assert.throws(() => api.exchange.plan([rollback], api.copyRows()), /내보낸 뒤 작업실 원고가 바뀌었어/);
  assert.equal(api.snapshot().edits[`${plan.changes[0].id}:ko`].caption, 'A new manual edit must survive.');
});

test('the checked whole-selection default rejects a Korean-only response and identifies missing Japanese and English rows', () => {
  const h = harness(), { api } = h;
  assert.equal(h.control('copy-require-complete').checked, true, 'the real HTML defaults to full coverage');
  const ko = api.exchange.makeEnvelope(api.copyRows().filter(row => row.locale === 'ko'));
  ko.posts[0].label = '한국어만 고친 응답';
  const before = clone(api.snapshot()), raw = api.raw(), writes = h.writes();
  assert.throws(() => api.checkCopyCoverage([ko]), error => {
    assert.match(error.issues[0].message, /9개 중 3개/);
    assert.match(error.issues[0].message, /한국어 3\/3/);
    assert.match(error.issues[0].message, /日本語 0\/3/);
    assert.match(error.issues[0].message, /English 0\/3/);
    assert.match(error.issues[1].message, /누락 6개/);
    return true;
  });
  assert.throws(() => api.stageCopyPreview([ko]), /전체 원고가 모이지 않았어/);
  assert.equal(api.pending(), null);
  api.applyCopyImport();
  assert.deepEqual(clone(api.snapshot()), before);
  assert.equal(api.raw(), raw);
  assert.equal(h.writes(), writes);
});

test('an intentionally unchecked partial import shows its missing coverage and updates only that language', () => {
  const h = harness(), { api } = h;
  h.control('copy-require-complete').checked = false;
  const all = clone(api.copyRows()), ko = api.exchange.makeEnvelope(api.copyRows().filter(row => row.locale === 'ko'));
  ko.posts[0].label = '일부만 의도적으로 수정';
  const coverage = api.checkCopyCoverage([ko]);
  assert.equal(coverage.complete, false);
  assert.equal(coverage.missing.length, 6);
  api.stageCopyPreview([ko]);
  assert.match(h.control('copy-import-summary').textContent, /일부 원고만 포함 · 누락 6개/);
  assert.equal(h.control('copy-import-apply').disabled, false);
  assert.equal(api.pending().requireComplete, false);
  api.applyCopyImport();
  assert.equal(api.pending(), null);
  assert.equal(api.copyRows()[0].label, '일부만 의도적으로 수정');
  assert.deepEqual(clone(api.copyRows().filter(row => row.locale !== 'ko')), all.filter(row => row.locale !== 'ko'));
  assert.equal(h.control('copy-import-errors').hidden, true);
});

test('all exact ID-language pairs can be staged and applied across separate response files', () => {
  const h = harness(), { api } = h, rows = api.copyRows();
  const files = ['ko', 'ja', 'en'].map(locale => api.exchange.makeEnvelope(rows.filter(row => row.locale === locale)));
  for (const file of files) file.posts[0].caption = `${file.posts[0].locale} revised caption`;
  const coverage = api.checkCopyCoverage(files);
  assert.equal(coverage.complete, true);
  assert.equal(coverage.totalExpected, 9);
  assert.equal(coverage.totalReceived, 9);
  api.stageCopyPreview(files);
  assert.match(h.control('copy-import-summary').textContent, /선택한 원고 모두 포함/);
  assert.match(h.control('copy-import-summary').textContent, /9개 확인 · 3개 변경 · 6개 동일/);
  const writes = h.writes();
  api.applyCopyImport();
  assert.equal(h.writes(), writes + 1);
  for (const locale of ['ko', 'ja', 'en']) assert.equal(api.copyRows().find(row => row.id === rows[0].id && row.locale === locale).caption, `${locale} revised caption`);
});

test('matching language counts cannot substitute another campaign for the currently selected scope', () => {
  const h = harness(), { api } = h;
  h.control('copy-export-scope').value = 'current';
  const selected = api.snapshot().settings.campaignId;
  const wrongRows = api.copyRows().filter(row => row.id === h.campaigns[0].id);
  assert.notEqual(wrongRows[0].id, selected);
  const wrong = api.exchange.makeEnvelope(wrongRows);
  wrong.posts[0].label = '범위 밖 같은 개수';
  assert.throws(() => api.checkCopyCoverage([wrong]), error => {
    assert.match(error.issues[0].message, /3개 중 3개/);
    assert.match(error.issues[1].message, /누락 3개/);
    assert.match(error.issues[2].message, /범위 밖의 원고 3개/);
    return true;
  });
  assert.throws(() => api.stageCopyPreview([wrong]), /전체 원고가 모이지 않았어/);
  const correct = api.exchange.makeEnvelope(api.copyRows('current'));
  assert.equal(api.checkCopyCoverage([correct]).complete, true);
});

test('undo bypasses whole-selection coverage and restores its affected row even if the scope changed', () => {
  const h = harness(), { api } = h, original = clone(api.copyRows());
  const all = api.exchange.makeEnvelope(api.copyRows());
  all.posts[0].label = '되돌릴 한 줄';
  api.stageCopyPreview([all]); api.applyCopyImport();
  const undo = api.exchange.parse(JSON.stringify(api.undo()));
  assert.equal(undo.posts.length, 1);
  assert.equal(api.checkCopyCoverage([undo], 'undo'), null);
  api.stageCopyPreview([undo], 'undo');
  assert.match(h.control('copy-preview-heading').textContent, /되돌릴 문구/);
  h.control('copy-export-scope').value = 'current';
  h.control('copy-require-complete').checked = false;
  api.applyCopyImport();
  assert.deepEqual(clone(api.copyRows()), original);
  assert.equal(api.undo(), null);
});

for (const change of ['scope', 'completion checkbox']) test(`changing ${change} after preview blocks apply even without its DOM change event`, () => {
  const h = harness(), { api } = h;
  const envelope = api.exchange.makeEnvelope(api.copyRows()); envelope.posts[0].label = '적용되면 안 되는 제목';
  api.stageCopyPreview([envelope]);
  const before = clone(api.snapshot()), raw = api.raw(), writes = h.writes();
  if (change === 'scope') h.control('copy-export-scope').value = 'current';
  else h.control('copy-require-complete').checked = false;
  api.applyCopyImport();
  assert.deepEqual(clone(api.snapshot()), before);
  assert.equal(api.raw(), raw);
  assert.equal(h.writes(), writes);
  assert.equal(api.pending(), null);
  assert.equal(h.control('copy-import-apply').disabled, true);
  assert.equal(h.control('copy-import-errors').hidden, false);
  const errors = h.control('copy-import-errors').children[1].children.map(item => item.textContent).join('\n');
  assert.match(errors, /확인 범위가 바뀌었어/);
});

test('invalidating a preview hides old results, disables apply and discards the pending transaction', () => {
  const h = harness(), { api } = h;
  const envelope = api.exchange.makeEnvelope(api.copyRows()); envelope.posts[0].label = '대기하던 수정';
  api.stageCopyPreview([envelope]);
  const raw = api.raw(), writes = h.writes();
  assert.ok(api.pending());
  assert.equal(h.control('copy-import-preview').hidden, false);
  h.control('copy-import-errors').hidden = false;
  api.invalidateCopyPreview();
  assert.equal(api.pending(), null);
  assert.equal(h.control('copy-import-preview').hidden, true);
  assert.equal(h.control('copy-import-errors').hidden, true);
  assert.equal(h.control('copy-import-apply').disabled, true);
  assert.match(h.control('copy-exchange-status').textContent, /수정 JSON을 다시 골라/);
  api.applyCopyImport();
  assert.equal(api.raw(), raw);
  assert.equal(h.writes(), writes);
});

test('opening the exchange resets an earlier partial-import opt-out to whole-selection checking', async () => {
  const h = harness(), { api } = h;
  h.control('copy-require-complete').checked = false;
  api.primeEditor();
  api.openCopyExchange();
  await Promise.resolve();
  assert.equal(h.control('copy-require-complete').checked, true);
  assert.equal(h.control('copy-exchange-dialog').open, true);
  assert.equal(api.pending(), null);
});
