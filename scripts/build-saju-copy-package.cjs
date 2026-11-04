#!/usr/bin/env node
'use strict';

// Rebuild the public starter kit from the three unchanged editorial catalogs.
// The browser's personal edits are exported separately by the studio UI.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const exchange = require('../sajupinggye/copy-exchange.js');

const ROOT = path.resolve(__dirname, '..');
const BASE = path.join(ROOT, 'sajupinggye');
const OUTPUT = path.join(BASE, 'downloads');
const SOURCES = ['campaigns-300.json', 'campaigns-v2.json', 'campaigns.json'];
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');

function collectRows(base = BASE) {
  const campaigns = SOURCES.flatMap(file => {
    const value = JSON.parse(fs.readFileSync(path.join(base, file), 'utf8'));
    if (!Array.isArray(value.campaigns)) throw new Error(`${file}: campaigns is required`);
    return value.campaigns;
  });
  const ids = new Set();
  for (const campaign of campaigns) {
    if (ids.has(campaign.id)) throw new Error(`Duplicate campaign id: ${campaign.id}`);
    ids.add(campaign.id);
  }
  return campaigns.flatMap(campaign => exchange.LOCALES.map(locale => {
    const source = campaign.locales[locale];
    if (!source) throw new Error(`Missing locale: ${campaign.id}/${locale}`);
    return {
      id: campaign.id,
      locale,
      topic: source.topic || campaign.topic,
      label: source.label,
      imageBrief: source.imageBrief || '',
      slides: source.slides.map(({ eyebrow, title, body, note }) => ({ eyebrow, title, body, note })),
      caption: source.caption,
      hashtags: [...source.hashtags]
    };
  }));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

// Standard ZIP/DEFLATE, without a shell or third-party dependencies. A fixed
// timestamp makes --check useful and avoids committing time-only binary diffs.
function zipArchive(entries) {
  const localChunks = [], centralChunks = [];
  let offset = 0;
  const dosDate = ((2026 - 1980) << 9) | (11 << 5) | 4;
  for (const entry of entries) {
    if (!/^[a-z0-9][a-z0-9./_-]*$/i.test(entry.name) || entry.name.includes('..')) throw new Error('Unsafe ZIP entry');
    const name = Buffer.from(entry.name, 'utf8');
    const bytes = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes, 'utf8');
    const packed = zlib.deflateRawSync(bytes, { level: 9 });
    const checksum = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6); // UTF-8 names.
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    localChunks.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const central = Buffer.concat(centralChunks);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localChunks, central, end]);
}

function build() {
  const rows = collectRows();
  const output = new Map();
  const locales = {};
  const allEnvelope = exchange.makeEnvelope(rows);
  const allBytes = json(allEnvelope);
  exchange.parse(allBytes.toString('utf8'));
  output.set('all-posts.json', allBytes);
  const entries = [{ name: 'all-posts.json', bytes: allBytes }];
  for (const locale of exchange.LOCALES) {
    const localRows = rows.filter(row => row.locale === locale);
    // Preserve the old standalone URLs for compatibility, but exclude these
    // duplicates from the default ZIP: GPT receives one unambiguous input file.
    const localBytes = json(exchange.makeEnvelope(localRows));
    exchange.parse(localBytes.toString('utf8'));
    output.set(`${locale}-all.json`, localBytes);
    locales[locale] = { posts: localRows.length };
  }
  const manifest = {
    format: 'sajupinggye-instagram-copy-kit',
    version: 1,
    copyFormat: exchange.FORMAT,
    copyVersion: exchange.VERSION,
    source: 'published-starter-catalogs',
    sourceFiles: SOURCES,
    posts: rows.length,
    locales,
    files: [{ file: 'all-posts.json', posts: rows.length, kind: 'all-locales' }],
    expectedOutput: 'all-posts-edited.json',
    note: 'Edit every row in all-posts.json across all locales. Keep every id, locale, baseRevision and slide count. Starter data excludes personal browser edits and images.'
  };
  entries.push({ name: 'copy-editing-prompt.txt', bytes: fs.readFileSync(path.join(BASE, 'copy-editing-prompt.txt')) });
  entries.push({ name: 'copy-format-guide.txt', bytes: fs.readFileSync(path.join(BASE, 'copy-format-guide.txt')) });
  entries.push({ name: 'manifest.json', bytes: json(manifest) });
  output.set('sajupinggye-gpt-copy-kit.zip', zipArchive(entries));
  return { output, manifest, entries };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--check')) throw new Error('Usage: node scripts/build-saju-copy-package.cjs [--check]');
  const { output, manifest, entries } = build();
  if (!args.includes('--check')) fs.mkdirSync(OUTPUT, { recursive: true });
  for (const [name, bytes] of output) {
    const target = path.join(OUTPUT, name);
    if (args.includes('--check')) {
      if (!fs.existsSync(target) || !fs.readFileSync(target).equals(bytes)) throw new Error(`Outdated package: ${path.relative(ROOT, target)}`);
    } else {
      fs.writeFileSync(target, bytes);
    }
  }
  console.log(`${args.includes('--check') ? 'Checked' : 'Built'} ${manifest.posts} posts, ${Object.keys(manifest.locales).length} locales, ${entries.length} ZIP entries (${output.get('sajupinggye-gpt-copy-kit.zip').length.toLocaleString()} bytes).`);
}

module.exports = { collectRows, zipArchive, build };
