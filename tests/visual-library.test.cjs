const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const base = path.join(root, 'sajupinggye');
const references = JSON.parse(fs.readFileSync(path.join(base, 'visual-references.json')));
const manifest = JSON.parse(fs.readFileSync(path.join(base, 'visual-assets.json')));
const copy = value => JSON.parse(JSON.stringify(value));

function boundary() {
  const source = fs.readFileSync(path.join(base, 'visuals.js'), 'utf8');
  const marker = 'Object.freeze({ ready, assetsReady,';
  assert.equal(source.split(marker).length, 2);
  const context = { URL, AbortController, window: {}, document: { getElementById: () => ({ addEventListener() {} }) },
    setTimeout: () => 0, clearTimeout() {}, fetch: () => new Promise(() => {}) };
  vm.createContext(context);
  vm.runInContext(source.replace(marker, 'Object.freeze({ readData, readAssets, ready, assetsReady,'), context);
  return context.window.SajuVisuals;
}

test('all 300 drafts have no more than three valid image recommendations', () => {
  const parsed = boundary().readData(copy(references));
  assert.equal(parsed.assignments.length, 300);
  for (const locale of ['ko', 'ja', 'en']) assert.equal(parsed.assignments.filter(item => item.locale === locale).length, 100);
  for (const item of parsed.assignments) assert.ok(item.referenceIds.length >= 1 && item.referenceIds.length <= 3);
  const excessive = copy(references);
  excessive.assignments[0].referenceIds = excessive.references.slice(0, 4).map(ref => ref.id);
  assert.throws(() => boundary().readData(excessive), /최대 3개/);
  assert.equal(excessive.assignments[0].referenceIds.length, 4, 'validation never silently drops a recommendation');
});

test('reference records reject active URLs, credentials and duplicate mappings', () => {
  for (const value of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'https://user:password@example.com/photo.jpg']) {
    const unsafe = copy(references); unsafe.references[0].imageUrl = value;
    assert.throws(() => boundary().readData(unsafe), /출처/);
  }
  const duplicate = copy(references); duplicate.assignments.push(copy(duplicate.assignments[0]));
  assert.throws(() => boundary().readData(duplicate), /원고별/);
});

test('every reference has a byte-verified local raster asset and original provenance', () => {
  const assets = boundary().readAssets(copy(manifest));
  assert.equal(assets.size, references.references.length);
  assert.equal(manifest.errors.length, 0);
  for (const ref of references.references) {
    const asset = assets.get(ref.id); assert.ok(asset, ref.id);
    assert.equal(asset.imageUrl, ref.imageUrl); assert.equal(asset.sourceUrl, ref.sourceUrl);
    assert.equal(asset.creator, ref.creator);
    const bytes = fs.readFileSync(path.join(base, asset.path));
    assert.equal(bytes.length, asset.bytes, ref.id + ' byte count');
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), asset.sha256, ref.id + ' content hash');
    const detected = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' :
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png' :
      bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
    assert.equal(detected, asset.type, ref.id + ' raster magic');
  }
});

test('asset manifest rejects traversal, remote paths, active formats and oversized files', () => {
  const id = Object.keys(manifest.assets)[0];
  for (const changes of [{ path: '../outside.jpg' }, { path: 'https://example.com/photo.jpg' }, { type: 'image/svg+xml' }, { bytes: 20 * 1024 * 1024 + 1 }, { sha256: '<script>' }]) {
    const unsafe = copy(manifest); Object.assign(unsafe.assets[id], changes);
    assert.throws(() => boundary().readAssets(unsafe), /사진 라이브러리/);
  }
});
