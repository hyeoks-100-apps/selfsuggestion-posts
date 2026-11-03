'use strict';

// A reading board for source images. Reference pixels never enter the poster canvas.
(() => {
  const $ = id => document.getElementById(id);
  const LOCALES = ['ko', 'ja', 'en'];
  const CATEGORIES = { exam: '수능·시험', child: '자녀·진로', crush: '짝사랑·썸', reunion: '재회·이별', marriage: '결혼·배우자', family: '부부·가족', career: '직장·이직', wealth: '재물·사업', charm: '매력·인복', year: '신년·전환기', naming: '이름 작명' };
  let data, book = [], onEdit, context, selected, mode = 'current', search = '', kind = 'all', category = 'all';
  let refs = new Map(), assignments = new Map(), referenceCategories = new Map(), dialogOpener;
  const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const string = (v, max = 2400) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
  function url(value, image = false) {
    if (!string(value, 12000)) return null;
    try { const u = new URL(value); return (image ? u.protocol === 'https:' : ['https:', 'http:'].includes(u.protocol)) && !u.username && !u.password ? u.href : null; } catch (_) { return null; }
  }
  function readData(value) {
    if (!plain(value) || value.version !== 1 || !Array.isArray(value.references) || !value.references.length || value.references.length > 500 || !Array.isArray(value.assignments) || value.assignments.length > 1500) throw new Error('이미지 레퍼런스 목록 형식을 확인해 줘.');
    const ids = new Set(), pairs = new Set();
    const references = value.references.map(item => {
      if (!plain(item) || typeof item.id !== 'string' || !/^[a-z][a-z0-9-]{1,79}$/.test(item.id) || ids.has(item.id) || !string(item.title, 240) || !url(item.sourceUrl) || !url(item.imageUrl, true) || (item.thumbnailUrl !== undefined && !url(item.thumbnailUrl, true)) || !string(item.creator, 500) || !['photo', 'film', 'illustration'].includes(item.kind) || !Array.isArray(item.moods) || item.moods.length > 20 || item.moods.some(v => !string(v, 80)) || !string(item.whatToBorrow) || !/^\d{4}-\d{2}-\d{2}$/.test(item.checkedAt)) throw new Error('이미지의 출처·주소·참고 메모를 확인해 줘.');
      ids.add(item.id);
      return { ...item, sourceUrl: url(item.sourceUrl), imageUrl: url(item.imageUrl, true), ...(item.thumbnailUrl && url(item.thumbnailUrl, true) ? { thumbnailUrl: url(item.thumbnailUrl, true) } : {}) };
    });
    const mappings = value.assignments.map(item => {
      const key = `${item.campaignId}:${item.locale}`;
      if (!plain(item) || !/^draft-\d{3}$/.test(item.campaignId) || !LOCALES.includes(item.locale) || pairs.has(key) || !Array.isArray(item.referenceIds) || !item.referenceIds.length || item.referenceIds.length > 5 || new Set(item.referenceIds).size !== item.referenceIds.length || item.referenceIds.some(id => !ids.has(id)) || !string(item.reason) || !string(item.redrawDirection)) throw new Error('원고별 이미지 연결을 확인해 줘.');
      pairs.add(key); return { ...item };
    });
    return { version: 1, checkedAt: value.checkedAt, references, assignments: mappings };
  }
  const node = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
  const keyOf = pair => `${pair.campaignId}:${pair.locale}`;
  const sourceId = () => selected?.campaignId === context?.campaignId ? (context?.referenceCampaignId || selected?.campaignId) : selected?.campaignId;
  const campaign = () => book.find(item => item.id === sourceId());
  function link(label, href) { const a = node('a', 'visual-source-link', label); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
  function entryFor(id, locale) {
    const item = assignments.get(`${id}:${locale}`);
    return item ? { ...item, references: item.referenceIds.map(refId => refs.get(refId)) } : null;
  }
  function markdownFor(id, locale) {
    const entry = entryFor(id, locale);
    if (!entry) return '';
    return `\n\n### 이미지 레퍼런스\n\n선택 이유: ${entry.reason}\n\n재작화 방향: ${entry.redrawDirection}\n\n` + entry.references.map(ref => `- [${ref.title}](${ref.sourceUrl}) — ${ref.creator}\n  - 이미지: ${ref.imageUrl}\n  - 참고할 점: ${ref.whatToBorrow}`).join('\n');
  }
  function imageCard(ref) {
    const article = node('article', 'visual-card');
    const button = node('button', 'visual-image-button'); button.type = 'button'; button.setAttribute('aria-label', `${ref.title} 크게 보기`);
    const image = node('img'); image.src = ref.thumbnailUrl || ref.imageUrl; image.alt = ref.title; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
    const fallback = node('span', 'visual-image-fallback', '여기서 이미지가 보이지 않으면 아래 원본 이미지 링크를 열어 봐.'); fallback.hidden = true;
    image.addEventListener('error', () => { image.hidden = true; fallback.hidden = false; button.classList.add('image-unavailable'); });
    button.append(image, fallback); button.addEventListener('click', () => openImage(ref, button)); article.append(button);
    const info = node('div', 'visual-card-info');
    info.append(node('p', 'visual-kicker', `${{ photo: 'PHOTOGRAPH', film: 'FILM STILL', illustration: 'ILLUSTRATION' }[ref.kind]} · ${ref.moods.slice(0, 3).join(' / ')}`), node('h3', '', ref.title), node('p', 'visual-borrow', ref.whatToBorrow));
    const links = node('div', 'visual-card-links'); links.append(link('출처 열기 ↗', ref.sourceUrl), link('원본 이미지 ↗', ref.imageUrl));
    info.append(links, node('p', 'visual-credit', ref.creator)); article.append(info); return article;
  }
  function openImage(ref, opener) {
    dialogOpener = opener;
    $('visual-dialog-title').textContent = ref.title;
    $('visual-dialog-image').src = ref.imageUrl; $('visual-dialog-image').alt = ref.title; $('visual-dialog-image').hidden = false;
    $('visual-dialog-image-error').hidden = true;
    $('visual-dialog-image').onerror = () => { $('visual-dialog-image').hidden = true; $('visual-dialog-image-error').hidden = false; };
    $('visual-dialog-caption').textContent = ref.whatToBorrow;
    $('visual-dialog-links').replaceChildren(link('출처 열기 ↗', ref.sourceUrl), link('원본 이미지 ↗', ref.imageUrl), node('span', 'visual-credit', ref.creator));
    $('visual-dialog').showModal(); $('visual-dialog-close').focus();
  }
  function renderPicker() {
    if (!selected) return;
    $('visual-locale').value = selected.locale;
    const fragment = document.createDocumentFragment();
    if (context && !book.some(item => item.id === context.campaignId)) {
      const option = node('option', '', context.labels?.[selected.locale] || context.label || '내 기획'); option.value = context.campaignId; fragment.append(option);
    }
    for (const item of book) {
      const option = node('option', '', `${item.id.slice(-3)} · ${item.locales[selected.locale].label}`); option.value = item.id; fragment.append(option);
    }
    $('visual-campaign').replaceChildren(fragment); $('visual-campaign').value = selected.campaignId;
  }
  function render() {
    if (!selected) return;
    const item = campaign(), entry = entryFor(sourceId(), selected.locale);
    $('visual-current-title').textContent = selected.campaignId === context?.campaignId ? (context.labels?.[selected.locale] || context.label) : (item?.locales[selected.locale].label || '내 기획');
    $('visual-current-title').lang = selected.locale;
    $('visual-current-topic').textContent = item ? `${selected.locale.toUpperCase()} · ${CATEGORIES[item.category] || item.topic}` : selected.locale.toUpperCase();
    $('visual-context').hidden = mode !== 'current'; $('visual-library-filters').hidden = mode !== 'all';
    $('visual-grid').classList.toggle('visual-grid-current', mode === 'current');
    $('visual-mode-current').setAttribute('aria-pressed', String(mode === 'current'));
    $('visual-mode-all').setAttribute('aria-pressed', String(mode === 'all'));
    $('visual-reason').textContent = entry?.reason || '이 기획은 아직 이미지 연결이 없어. 전체 이미지에서 참고할 장면을 찾아 봐.';
    $('visual-direction').textContent = entry?.redrawDirection || item?.locales[selected.locale].imageBrief || context?.imageBrief || '';
    $('visual-edit-campaign').disabled = !item && selected.campaignId !== context?.campaignId;
    let items = mode === 'current' ? (entry?.references || []) : [...refs.values()].filter(ref => {
      const words = [ref.title, ref.creator, ...ref.moods, ref.whatToBorrow].join(' ').toLocaleLowerCase();
      return (kind === 'all' || kind === ref.kind) && (category === 'all' || referenceCategories.get(ref.id)?.has(category)) && (!search || words.includes(search));
    });
    const grid = document.createDocumentFragment(); for (const ref of items) grid.append(imageCard(ref)); $('visual-grid').replaceChildren(grid);
    $('visual-result-count').textContent = mode === 'current' ? `이 원고에 고른 이미지 ${items.length}개` : `${items.length} / ${refs.size}개 이미지`;
    $('visual-empty').hidden = items.length > 0;
  }
  function setContext(value) {
    context = { ...value };
    selected = { campaignId: value.campaignId, locale: value.locale };
    renderPicker(); render();
  }
  function showCurrent() { mode = 'current'; if (context) setContext(context); else render(); }
  function indexCategories() {
    referenceCategories = new Map();
    for (const item of data?.assignments || []) {
      const c = book.find(c => c.id === item.campaignId);
      for (const id of item.referenceIds) { if (!referenceCategories.has(id)) referenceCategories.set(id, new Set()); if (c) referenceCategories.get(id).add(c.category); }
    }
  }
  function init(options) {
    book = options.campaigns; onEdit = options.onEdit; indexCategories();
    renderPicker(); render();
  }
  function downloadList() {
    if (!data) return;
    const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
    const a = node('a'); a.href = href; a.download = 'sajupinggye-300-image-references.json'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(href), 10000);
  }
  $('visual-mode-current').addEventListener('click', showCurrent);
  $('visual-mode-all').addEventListener('click', () => { mode = 'all'; render(); });
  $('visual-locale').addEventListener('change', () => { selected.locale = $('visual-locale').value; renderPicker(); render(); });
  $('visual-campaign').addEventListener('change', () => { selected.campaignId = $('visual-campaign').value; render(); });
  $('visual-search').addEventListener('input', () => { search = $('visual-search').value.trim().toLocaleLowerCase(); render(); });
  $('visual-kind').addEventListener('change', () => { kind = $('visual-kind').value; render(); });
  $('visual-category').addEventListener('change', () => { category = $('visual-category').value; render(); });
  $('visual-edit-campaign').addEventListener('click', () => { if (campaign() || selected.campaignId === context?.campaignId) onEdit?.(selected.campaignId, selected.locale); });
  $('visual-download').addEventListener('click', downloadList);
  $('visual-dialog-close').addEventListener('click', () => $('visual-dialog').close());
  $('visual-dialog').addEventListener('click', event => { if (event.target === $('visual-dialog')) { const r = $('visual-dialog').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('visual-dialog').close(); } });
  $('visual-dialog').addEventListener('close', () => { $('visual-dialog-image').removeAttribute('src'); (dialogOpener?.isConnected ? dialogOpener : $('visual-mode-current')).focus({ preventScroll: true }); });
  const request = new AbortController(), requestTimer = setTimeout(() => request.abort(), 12000);
  const ready = fetch('visual-references.json', { cache: 'no-cache', signal: request.signal }).then(async response => {
    if (!response.ok) throw new Error('이미지 목록을 불러오지 못했어. 잠시 뒤 새로고침해 줘.');
    data = readData(await response.json()); refs = new Map(data.references.map(ref => [ref.id, ref])); assignments = new Map(data.assignments.map(item => [keyOf(item), item]));
    indexCategories();
    $('visual-loading').hidden = true;
    $('visual-summary').textContent = `${refs.size}개 실제 이미지 · ${assignments.size}개 원고에 연결 · ${data.checkedAt || ''} 확인`;
    $('visual-download').disabled = false; render(); return data;
  }).catch(error => { $('visual-loading').textContent = error.name === 'AbortError' ? '이미지 목록 응답이 늦어. 새로고침하면 다시 불러올 수 있어. 원고 저장은 계속할 수 있어.' : error.message; $('visual-loading').classList.add('error'); return null; }).finally(() => clearTimeout(requestTimer));
  window.SajuVisuals = Object.freeze({ ready, init, setContext, showCurrent, entryFor, markdownFor, bundle: () => data ? JSON.parse(JSON.stringify(data)) : null });
})();
