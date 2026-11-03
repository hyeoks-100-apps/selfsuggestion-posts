// State validation and the v1/v2 → v3 migration boundary. Run: node --test tests/studio-state.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const original = JSON.parse(fs.readFileSync(path.join(root, 'sajupinggye/campaigns.json')));
const copy = value => JSON.parse(JSON.stringify(value));

function api() {
  const records = new Map();
  const nodes = new Map();
  let writes = 0;
  const source = fs.readFileSync(path.join(root, 'sajupinggye/studio.js'), 'utf8');
  assert.equal(source.match(/  start\(\);/g)?.length, 1);
  const context = { URL, TextEncoder, window: {}, setTimeout: () => 0, clearTimeout() {},
    document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, { textContent: '', classList: { toggle() {} } }); return nodes.get(id); } },
    localStorage: { getItem: key => records.get(key) ?? null, setItem(key, value) { writes++; records.set(key, value); } }
  };
  context.testStorage = { records, nodes, writes: () => writes };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'sajupinggye/backgrounds.js'), 'utf8'), context);
  vm.runInContext(source.replace('  start();', `globalThis.boundary = {
    setup(value) { catalog = readCatalog(value); state = initialState(); },
    readBackup, readCampaign, initialState, saveNow, saveSoon,
    storage: testStorage,
    keys: [STORE_KEY, PREVIOUS_STORE_KEY, LEGACY_STORE_KEY]
  };`), context);
  const sample = copy(original.campaigns[0]);
  sample.id = 'v2-state-test'; sample.category = 'crush'; sample.artwork = 'inyeon';
  for (const locale of ['ko', 'ja', 'en']) sample.locales[locale].slides = [0, 2, 4].map(index => sample.locales[locale].slides[index]);
  context.boundary.setup({ ...original, version: 2, campaigns: [sample, ...original.campaigns] });
  return context.boundary;
}

function legacyBackup() {
  const campaign = original.campaigns[0];
  const locale = campaign.locales.en;
  return {
    app: 'sajupinggye-instagram-studio', version: 1,
    settings: { campaignId: campaign.id, locale: 'en', slideIndex: 4, template: 'muk', format: 'story' },
    campaigns: [], topics: { [campaign.id]: 'My edited topic' },
    edits: { [`${campaign.id}:en`]: { label: 'My edited title', caption: 'My edited caption', hashtags: ['#saju'], hashtagText: '#saju #draft #six #tags #remain #here', slides: locale.slides.map(({ title, body, note }, index) => ({ title: `Edited ${index}: ${title}`, body, note })) } },
    posted: { [`${campaign.id}:en`]: '2026-11-03T01:00:00.000Z' }
  };
}

test('v1 edits, raw hashtag draft, all five pages and posted dates survive', () => {
  const a = api(), old = legacyBackup(), restored = a.readBackup(old);
  assert.equal(restored.version, 3);
  assert.equal(restored.settings.slideIndex, 4);
  assert.equal(restored.settings.artwork, 'auto');
  for (const key of ['topics', 'edits', 'posted']) assert.equal(JSON.stringify(restored[key]), JSON.stringify(old[key]));
  assert.equal(old.version, 1, 'input backup is never mutated');
});

test('new and old browser storage use separate keys', () => {
  assert.deepEqual(Array.from(api().keys), ['spg_ig_studio_v3', 'spg_ig_studio_v2', 'spg_ig_studio_v1']);
});

test('three-page v2 backups round-trip custom campaigns and artwork', () => {
  const a = api(), backup = copy(a.initialState());
  const custom = copy(original.campaigns[1]); custom.id = 'local-three'; custom.category = 'naming'; custom.artwork = 'hanji';
  for (const locale of ['ko', 'ja', 'en']) custom.locales[locale].slides = custom.locales[locale].slides.slice(0, 3);
  backup.campaigns.push(custom);
  backup.settings = { campaignId: custom.id, locale: 'ja', slideIndex: 2, template: 'inyeon', artwork: 'muk', format: 'feed' };
  const restored = a.readBackup(backup);
  assert.equal(restored.campaigns[0].locales.ja.slides.length, 3);
  assert.equal(restored.settings.artwork, 'muk');
  assert.equal(restored.settings.slideIndex, 2);
});

test('a three-page campaign cannot restore a fourth or fifth page', () => {
  const a = api(), backup = copy(a.initialState()); backup.settings.slideIndex = 4;
  assert.throws(() => a.readBackup(backup), /페이지/);
});

test('import rejects truncated legacy edits instead of discarding pages', () => {
  const a = api(), backup = legacyBackup(); backup.edits[`${original.campaigns[0].id}:en`].slides.pop();
  assert.throws(() => a.readBackup(backup), /슬라이드 수/);
});

test('three languages must have matching page counts', () => {
  const a = api(), campaign = copy(original.campaigns[0]); campaign.locales.ja.slides = campaign.locales.ja.slides.slice(0, 3);
  assert.throws(() => a.readCampaign(campaign), /세 언어/);
});

test('duplicate IDs and unsafe artwork settings fail without mutating the input', () => {
  const a = api(), duplicate = legacyBackup(); duplicate.campaigns.push(copy(original.campaigns[0]));
  assert.throws(() => a.readBackup(duplicate), /중복/);
  const unsafe = copy(a.initialState()); unsafe.settings.artwork = 'https://external.example/image.png';
  assert.throws(() => a.readBackup(unsafe), /이미지/);
  unsafe.settings.artwork = 'hanji'; unsafe.settings.unexpected = 'ignored';
  assert.throws(() => a.readBackup(unsafe), /지원하지 않는/);
});

test('the larger seed library can preserve a previously full v1 workspace', () => {
  const a = api(), backup = legacyBackup();
  for (let index = 0; index < 94; index++) {
    const campaign = copy(original.campaigns[0]); campaign.id = `local-old-${index}`; backup.campaigns.push(campaign);
  }
  assert.equal(a.readBackup(backup).campaigns.length, 94);
});


test('v3 preserves per-page photo crops and per-language image briefs', () => {
  const a = api(), backup = copy(a.initialState());
  const id = 'img_12345678-1234-1234-1234-123456789abc';
  backup.backgrounds['v2-state-test:ko'] = [{ assetId: id, x: 20, y: 80, zoom: 1.75, wash: 12 }, null, null];
  const result = a.readBackup(backup);
  assert.deepEqual(copy(result.backgrounds), backup.backgrounds);
  assert.deepEqual(copy(a.readBackup(legacyBackup()).backgrounds), {});
});

test('photo references reject unknown campaigns, page truncation and unsafe coordinates', () => {
  const a = api(), backup = copy(a.initialState());
  backup.backgrounds['unknown:ko'] = [null, null, null];
  assert.throws(() => a.readBackup(backup), /사진 설정/);
  backup.backgrounds = { 'v2-state-test:ko': [null] };
  assert.throws(() => a.readBackup(backup), /페이지/);
  for (const field of ['assetId', 'x', 'y', 'zoom', 'wash']) {
    const setting = { assetId: 'img_12345678-1234-1234-1234-123456789abc', x: 50, y: 50, zoom: 1, wash: 0 };
    setting[field] = field === 'assetId' ? 'https://external.example/photo.jpg' : Infinity;
    backup.backgrounds = { 'v2-state-test:ko': [setting, null, null] };
    assert.throws(() => a.readBackup(backup), /사진/);
  }
});

test('backups reject active image content and duplicate asset IDs', () => {
  const a = api(), backup = copy(a.initialState());
  const asset = { id: 'img_12345678-1234-1234-1234-123456789abc', name: 'sample.jpg', width: 1080, height: 1080, dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' };
  backup.assets = [asset];
  assert.throws(() => a.readBackup(backup), /JPEG/);
  asset.dataUrl = 'data:image/jpeg;base64,/9j/AAAA';
  backup.assets = [asset, asset];
  assert.throws(() => a.readBackup(backup), /중복/);
});


test('closing an unchanged old tab never overwrites a newer stored workspace', () => {
  const a = api(), key = a.keys[0];
  a.storage.records.set(key, 'newer-tab-workspace');
  assert.equal(a.saveNow(), true);
  assert.equal(a.storage.records.get(key), 'newer-tab-workspace');
  assert.equal(a.storage.writes(), 0);
});

test('a dirty stale tab refuses to overwrite newer photos, drafts and posting records', () => {
  const a = api(), key = a.keys[0];
  a.saveSoon();
  a.storage.records.set(key, 'newer-tab-workspace');
  assert.equal(a.saveNow(), false);
  assert.equal(a.storage.records.get(key), 'newer-tab-workspace');
  assert.match(a.storage.nodes.get('save-status').textContent, /다른 탭/);
  assert.equal(a.storage.writes(), 0);
});

test('a fresh changed workspace saves once and repeated idle saves preserve it', () => {
  const a = api(), key = a.keys[0];
  a.saveSoon(); assert.equal(a.saveNow(), true);
  const saved = a.storage.records.get(key);
  assert.equal(JSON.parse(saved).version, 3);
  assert.equal(a.storage.writes(), 1);
  assert.equal(a.saveNow(), true);
  assert.equal(a.storage.records.get(key), saved);
  assert.equal(a.storage.writes(), 1);
});
