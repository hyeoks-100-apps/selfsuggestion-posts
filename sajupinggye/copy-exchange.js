'use strict';

// Text-only round trips for the Instagram studio. This module never reads storage or renders HTML.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SajuCopyExchange = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const FORMAT = 'sajupinggye-instagram-copy';
  const VERSION = 1;
  const MAX_BYTES = 8 * 1024 * 1024;
  const MAX_POSTS = 1500;
  const LOCALES = Object.freeze(['ko', 'ja', 'en']);
  const LIMITS = Object.freeze({ topic: 100, label: 160, imageBrief: 1200, eyebrow: 180, title: 180, body: 1400, note: 360, caption: 2200, hashtags: 5, hashtag: 80 });
  const COPY_KEYS = ['topic', 'label', 'imageBrief', 'slides', 'caption', 'hashtags'];
  const ROW_KEYS = ['id', 'locale', ...COPY_KEYS];
  const IMPORT_KEYS = ['id', 'locale', 'baseRevision', ...COPY_KEYS];
  const SLIDE_KEYS = ['eyebrow', 'title', 'body', 'note'];
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const size = text => new TextEncoder().encode(text).length;
  const clone = value => JSON.parse(JSON.stringify(value));
  const keyOf = row => `${row.id}:${row.locale}`;

  function fail(issues) {
    const error = new Error(issues.map(issue => `${issue.id ? `${issue.id}/${issue.locale || '?'} · ` : ''}${issue.field}: ${issue.message}`).join('\n'));
    error.name = 'CopyExchangeError';
    error.issues = issues;
    throw error;
  }
  function issue(issues, row, field, message) {
    issues.push({ id: typeof row?.id === 'string' ? row.id : null, locale: typeof row?.locale === 'string' ? row.locale : null, field, message });
  }
  function keys(value, required, issues, row, field) {
    if (!plain(value)) { issue(issues, row, field, 'JSON 객체여야 해.'); return false; }
    for (const name of required) if (!own(value, name)) issue(issues, row, field ? `${field}.${name}` : name, '필수 항목이 없어.');
    for (const name of Object.keys(value)) if (!required.includes(name)) issue(issues, row, field ? `${field}.${name}` : name, '지원하지 않는 항목이야. 원고 필드만 넣어 줘.');
    return true;
  }
  function string(value, field, max, row, issues, required = false) {
    if (typeof value !== 'string') issue(issues, row, field, '문자열이어야 해.');
    else if (value.length > max) issue(issues, row, field, `${max}자를 넘었어.`);
    else if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) issue(issues, row, field, '사용할 수 없는 제어 문자가 있어.');
    else if (required && !value.trim()) issue(issues, row, field, '빈칸으로 둘 수 없어.');
  }
  function validateCopy(row, issues) {
    for (const field of ['topic', 'label', 'imageBrief', 'caption']) string(row[field], field, LIMITS[field], row, issues, field === 'label');
    if (!Array.isArray(row.slides) || ![3, 5].includes(row.slides.length)) issue(issues, row, 'slides', '슬라이드는 3장 또는 기존 형식의 5장이어야 해.');
    else row.slides.forEach((slide, index) => {
      const field = `slides[${index}]`;
      if (keys(slide, SLIDE_KEYS, issues, row, field)) for (const name of SLIDE_KEYS) string(slide[name], `${field}.${name}`, LIMITS[name], row, issues);
    });
    if (!Array.isArray(row.hashtags) || row.hashtags.length > LIMITS.hashtags) issue(issues, row, 'hashtags', '해시태그는 문자열 배열로 최대 5개야.');
    else row.hashtags.forEach((tag, index) => {
      const field = `hashtags[${index}]`;
      string(tag, field, LIMITS.hashtag, row, issues, true);
      if (typeof tag === 'string' && (!tag.startsWith('#') || tag.length < 2 || /\s/.test(tag))) issue(issues, row, field, '#으로 시작하는 공백 없는 해시태그를 넣어 줘.');
    });
    if (typeof row.caption === 'string' && Array.isArray(row.hashtags) && row.hashtags.every(tag => typeof tag === 'string')) {
      const combined = [row.caption.trim(), row.hashtags.join(' ')].filter(Boolean).join('\n\n');
      if (combined.length > LIMITS.caption) issue(issues, row, 'caption', '캡션과 해시태그를 합쳐 2200자 이내로 줄여 줘.');
    }
  }
  function validateRow(row, imported, issues) {
    if (!keys(row, imported ? IMPORT_KEYS : ROW_KEYS, issues, row, '')) return;
    if (typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(row.id) || ['__proto__', 'constructor', 'prototype'].includes(row.id)) issue(issues, row, 'id', '작업실에서 받은 기획 ID를 그대로 써 줘.');
    if (!LOCALES.includes(row.locale)) issue(issues, row, 'locale', 'ko, ja, en 중 원래 언어를 그대로 써 줘.');
    if (imported && (typeof row.baseRevision !== 'string' || !/^[0-9a-f]{16}$/.test(row.baseRevision))) issue(issues, row, 'baseRevision', '내보낸 16자리 수정 기준값을 그대로 써 줘.');
    validateCopy(row, issues);
  }
  function copyOf(row) {
    return { topic: row.topic, label: row.label, imageBrief: row.imageBrief, slides: row.slides.map(slide => Object.fromEntries(SLIDE_KEYS.map(name => [name, slide[name]]))), caption: row.caption, hashtags: [...row.hashtags] };
  }
  function canonical(row) { return JSON.stringify(copyOf(row)); }

  // Two deterministic 32-bit checksums, solely to detect accidental stale edits.
  // The revision is not a signature, password or authentication mechanism.
  function revision(copyOrRow) {
    const issues = [];
    if (!plain(copyOrRow)) fail([{ id: null, locale: null, field: 'copy', message: '원고는 JSON 객체여야 해.' }]);
    validateCopy(copyOrRow, issues);
    if (issues.length) fail(issues);
    let a = 0x811c9dc5, b = 0x9e3779b9;
    for (const byte of new TextEncoder().encode(canonical(copyOrRow))) {
      a = Math.imul(a ^ byte, 0x01000193) >>> 0;
      b = Math.imul(b ^ byte, 0x85ebca6b) >>> 0;
    }
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
  }
  function checkBytes(value, field = 'file') {
    let encoded;
    try { encoded = JSON.stringify(value); } catch { fail([{ id: null, locale: null, field, message: 'JSON으로 읽을 수 없는 값이야.' }]); }
    if (typeof encoded !== 'string' || size(encoded) > MAX_BYTES) fail([{ id: null, locale: null, field, message: '원고 JSON은 전체 8 MiB 이내로 나눠 올려 줘.' }]);
    return encoded;
  }
  function parse(text) {
    if (typeof text !== 'string' || size(text) > MAX_BYTES) fail([{ id: null, locale: null, field: 'file', message: '원고 JSON 파일은 8 MiB 이내여야 해.' }]);
    try { return JSON.parse(text); } catch { fail([{ id: null, locale: null, field: 'file', message: 'JSON 문법이 맞지 않아. 코드 블록 없이 JSON 파일로 받아 줘.' }]); }
  }
  function validateRows(rows, issues) {
    if (!Array.isArray(rows) || !rows.length || rows.length > MAX_POSTS) { issue(issues, null, 'posts', `원고는 1~${MAX_POSTS}개여야 해.`); return; }
    const seen = new Set();
    rows.forEach(row => {
      validateRow(row, false, issues);
      if (plain(row)) {
        const key = keyOf(row);
        if (seen.has(key)) issue(issues, row, 'id', '같은 ID와 언어가 중복됐어.');
        seen.add(key);
      }
    });
  }
  function makeEnvelope(rows) {
    const issues = [];
    validateRows(rows, issues);
    if (issues.length) fail(issues);
    const result = { format: FORMAT, version: VERSION, posts: rows.map(row => ({ id: row.id, locale: row.locale, baseRevision: revision(row), ...copyOf(row) })) };
    checkBytes(result);
    return result;
  }
  function changedFields(before, after) {
    const result = [];
    for (const field of COPY_KEYS) {
      if (field === 'slides') {
        for (let index = 0; index < before.slides.length; index++) for (const name of SLIDE_KEYS) {
          if (before.slides[index][name] !== after.slides[index][name]) result.push(`slides[${index}].${name}`);
        }
      } else if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) result.push(field);
    }
    return result;
  }
  function plan(envelopes, currentRows) {
    const issues = [];
    validateRows(currentRows, issues);
    if (issues.length) fail(issues);
    if (!Array.isArray(envelopes) || !envelopes.length) fail([{ id: null, locale: null, field: 'files', message: '원고 JSON 파일을 하나 이상 골라 줘.' }]);
    checkBytes(envelopes);
    const current = new Map(currentRows.map(row => [keyOf(row), row]));
    const seen = new Set(), changes = [], counts = { ko: 0, ja: 0, en: 0 };
    let unchanged = 0, total = 0;
    envelopes.forEach((envelope, fileIndex) => {
      if (!keys(envelope, ['format', 'version', 'posts'], issues, null, `files[${fileIndex}]`)) return;
      if (envelope.format !== FORMAT) issue(issues, null, `files[${fileIndex}].format`, '사주핑계 원고 교환 파일이 아니야.');
      if (envelope.version !== VERSION) issue(issues, null, `files[${fileIndex}].version`, '지원하지 않는 원고 규격 버전이야.');
      if (!Array.isArray(envelope.posts) || !envelope.posts.length || envelope.posts.length > MAX_POSTS) { issue(issues, null, `files[${fileIndex}].posts`, `원고는 1~${MAX_POSTS}개여야 해.`); return; }
      envelope.posts.forEach(row => {
        total++;
        const start = issues.length;
        validateRow(row, true, issues);
        if (!plain(row)) return;
        const key = keyOf(row);
        if (seen.has(key)) issue(issues, row, 'id', '업로드한 파일에 같은 ID와 언어가 중복됐어.');
        seen.add(key);
        const before = current.get(key);
        if (!before) issue(issues, row, 'id', '현재 작업실에 없는 ID 또는 언어야. ID와 언어를 바꾸지 마.');
        if (issues.length !== start) return;
        if (row.slides.length !== before.slides.length) { issue(issues, row, 'slides', '내보낸 슬라이드 수를 바꾸지 마.'); return; }
        const oldCopy = copyOf(before), newCopy = copyOf(row);
        counts[row.locale]++;
        if (canonical(oldCopy) === canonical(newCopy)) { unchanged++; return; }
        if (row.baseRevision !== revision(before)) { issue(issues, row, 'baseRevision', '내보낸 뒤 작업실 원고가 바뀌었어. 최신 원고를 다시 받아 수정해 줘.'); return; }
        changes.push({ id: row.id, locale: row.locale, before: oldCopy, after: newCopy, fields: changedFields(oldCopy, newCopy) });
      });
    });
    if (total > MAX_POSTS) issue(issues, null, 'posts', `한 번에 ${MAX_POSTS}개까지 올릴 수 있어.`);
    if (issues.length) fail(issues);
    return { changes: clone(changes), unchanged, total, counts, warnings: [] };
  }
  // Compare exact ID/language pairs with the selected export scope. Matching
  // language totals alone must never make a partial or substituted file complete.
  function coverage(envelopes, expectedRows) {
    const issues = [];
    validateRows(expectedRows, issues);
    if (issues.length) fail(issues);
    if (!Array.isArray(envelopes) || !envelopes.length) fail([{ id: null, locale: null, field: 'files', message: '원고 JSON 파일을 하나 이상 골라 줘.' }]);
    checkBytes(envelopes);
    const expected = { ko: 0, ja: 0, en: 0 }, received = { ko: 0, ja: 0, en: 0 };
    const expectedPairs = new Map(expectedRows.map(row => [keyOf(row), { id: row.id, locale: row.locale }]));
    const receivedPairs = new Map();
    let totalReceived = 0;
    expectedRows.forEach(row => { expected[row.locale]++; });
    envelopes.forEach((envelope, fileIndex) => {
      if (!keys(envelope, ['format', 'version', 'posts'], issues, null, `files[${fileIndex}]`)) return;
      if (envelope.format !== FORMAT) issue(issues, null, `files[${fileIndex}].format`, '사주핑계 원고 교환 파일이 아니야.');
      if (envelope.version !== VERSION) issue(issues, null, `files[${fileIndex}].version`, '지원하지 않는 원고 규격 버전이야.');
      if (!Array.isArray(envelope.posts) || !envelope.posts.length || envelope.posts.length > MAX_POSTS) { issue(issues, null, `files[${fileIndex}].posts`, `원고는 1~${MAX_POSTS}개여야 해.`); return; }
      envelope.posts.forEach(row => {
        totalReceived++;
        const start = issues.length;
        validateRow(row, true, issues);
        if (!plain(row)) return;
        const key = keyOf(row);
        if (receivedPairs.has(key)) issue(issues, row, 'id', '업로드한 파일에 같은 ID와 언어가 중복됐어.');
        if (issues.length !== start) return;
        receivedPairs.set(key, { id: row.id, locale: row.locale });
        received[row.locale]++;
      });
    });
    if (totalReceived > MAX_POSTS) issue(issues, null, 'posts', `한 번에 ${MAX_POSTS}개까지 올릴 수 있어.`);
    if (issues.length) fail(issues);
    const missing = [...expectedPairs].filter(([key]) => !receivedPairs.has(key)).map(([, pair]) => pair);
    const unexpected = [...receivedPairs].filter(([key]) => !expectedPairs.has(key)).map(([, pair]) => pair);
    return { expected, received, missing, unexpected, complete: !missing.length && !unexpected.length, totalExpected: expectedRows.length, totalReceived };
  }
  return Object.freeze({ FORMAT, VERSION, MAX_BYTES, MAX_POSTS, LIMITS, LOCALES, revision, makeEnvelope, parse, plan, coverage });
});
