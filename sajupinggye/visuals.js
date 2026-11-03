'use strict';

// Reference library. Explicit selections are handed to the local-photo workflow.
(() => {
  const $ = id => document.getElementById(id);
  const LOCALES = ['ko', 'ja', 'en'];
  const CATEGORIES = { exam: '수능·시험', child: '자녀·진로', crush: '짝사랑·썸', reunion: '재회·이별', marriage: '결혼·배우자', family: '부부·가족', career: '직장·이직', wealth: '재물·사업', charm: '매력·인복', year: '신년·전환기', naming: '이름 작명' };
  let data, book = [], onEdit, onApplyReference, onUpload, context, selected, mode = 'current', search = '', kind = 'all', category = 'all';
  let refs = new Map(), assignments = new Map(), referenceCategories = new Map(), localAssets = new Map(), dialogOpener;
  let applying = false, applyingId, feedback;
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
      if (!plain(item) || !/^draft-\d{3}$/.test(item.campaignId) || !LOCALES.includes(item.locale) || pairs.has(key) || !Array.isArray(item.referenceIds) || !item.referenceIds.length || item.referenceIds.length > 3 || new Set(item.referenceIds).size !== item.referenceIds.length || item.referenceIds.some(id => !ids.has(id)) || !string(item.reason) || !string(item.redrawDirection)) throw new Error('원고별 추천 이미지는 최대 3개까지 연결할 수 있어.');
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
    return item ? { ...item, references: item.referenceIds.slice(0, 3).map(refId => refs.get(refId)) } : null;
  }
  function readAssets(value) {
    if (!plain(value) || value.version !== 1 || !plain(value.assets) || Object.keys(value.assets).length > 500) throw new Error('사진 라이브러리 파일 목록을 확인해 줘.');
    const result = new Map();
    for (const [id, item] of Object.entries(value.assets)) {
      if (!/^[a-z][a-z0-9-]{1,79}$/.test(id) || !plain(item) || !['image/jpeg', 'image/png', 'image/webp'].includes(item.type) || !Number.isInteger(item.bytes) || item.bytes < 1 || item.bytes > 20 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('사진 라이브러리 파일 형식을 확인해 줘.');
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[item.type];
      if (item.path !== `assets/references/${id}.${extension}`) throw new Error('사진 라이브러리 경로를 확인해 줘.');
      result.set(id, { ...item });
    }
    return result;
  }
  function assetFor(idOrRef) { const item = localAssets.get(typeof idOrRef === 'string' ? idOrRef : idOrRef?.id); return item ? { ...item } : null; }
  function assetUrlFor(idOrRef) { const asset = assetFor(idOrRef); return asset ? `${asset.path}?v=${asset.sha256.slice(0, 16)}` : null; }
  function displayUrl(ref) { return assetUrlFor(ref.id) || ref.thumbnailUrl || ref.imageUrl; }
  function target() {
    if (!selected) return null;
    const same = selected.campaignId === context?.campaignId && selected.locale === context?.locale;
    return { campaignId: selected.campaignId, locale: selected.locale, slideIndex: same && Number.isInteger(context.slideIndex) ? context.slideIndex : 0 };
  }
  function targetLabel() {
    const value = target(); if (!value) return '';
    const title = selected.campaignId === context?.campaignId ? (context.labels?.[selected.locale] || context.label) : campaign()?.locales[selected.locale]?.label;
    return `${title || '내 기획'} · ${selected.locale.toUpperCase()} · ${value.slideIndex + 1}번째 장`;
  }
  function actionButton(label, className, callback) {
    const button = node('button', `button ${className}`, label); button.type = 'button'; button.addEventListener('click', callback); return button;
  }
  function upload(targetValue = target()) {
    if (applying || !onUpload || !targetValue) return;
    // Keep this callback synchronous so the file picker retains the click gesture.
    if ($('visual-dialog').open) $('visual-dialog').close();
    try {
      const result = onUpload({ ...targetValue });
      if (result?.catch) result.catch(error => { feedback = { message: error.message, error: true }; renderFeedback(); });
    } catch (error) { feedback = { message: error.message, error: true }; renderFeedback(); }
  }
  function renderFeedback() {
    for (const prefix of ['visual-apply', 'visual-dialog-apply']) {
      const status = $(prefix + '-status'), fallback = $(prefix + '-fallback');
      if (!status || !fallback) continue;
      status.textContent = feedback?.message || '';
      status.classList.toggle('error', Boolean(feedback?.error));
      fallback.hidden = !feedback?.fallback;
      fallback.replaceChildren();
      if (feedback?.fallback) {
        fallback.append(node('p', '', '원본 이미지를 기기에 저장한 다음 올려 줘. 선택한 원고의 같은 장에 적용할게.'), link('원본 이미지 열기 ↗', feedback.ref.imageUrl));
        const button = actionButton('저장한 사진 업로드', 'secondary small', () => upload(feedback.target));
        button.dataset.referenceUpload = ''; button.disabled = applying || !onUpload; fallback.append(button);
      }
    }
    for (const button of document.querySelectorAll('[data-reference-apply]')) {
      button.disabled = applying || !onApplyReference;
      button.textContent = applying && button.dataset.referenceApply === applyingId ? '사진 불러오는 중…' : '이 사진 쓰기';
    }
    for (const button of document.querySelectorAll('[data-reference-upload]')) button.disabled = applying || !onUpload;
  }
  async function apply(ref) {
    const destination = target();
    if (applying || !onApplyReference || !destination) return;
    applying = true; applyingId = ref.id;
    feedback = { message: `${ref.title} 사진을 불러오는 중…` }; renderFeedback();
    try {
      const result = await onApplyReference({ ...ref, moods: [...ref.moods] }, { ...destination });
      feedback = { message: result?.message || '사진을 적용했어. 제작기에서 위치와 크기를 조절해 봐.' };
      if ($('visual-dialog').open) $('visual-dialog').close();
    } catch (error) {
      const fallback = error.code === 'REFERENCE_FETCH_FAILED';
      feedback = { message: fallback ? '이 사이트는 사진을 바로 가져올 수 없게 되어 있어. 원본을 저장해 올리면 쓸 수 있어.' : (error.message || '사진을 적용하지 못했어. 다시 시도해 줘.'), error: true, fallback, ref, target: destination };
    } finally { applying = false; applyingId = null; renderFeedback(); }
  }
  function useButton(ref) {
    const button = actionButton('이 사진 쓰기', 'primary small visual-use-button', () => apply(ref));
    button.dataset.referenceApply = ref.id; button.disabled = applying || !onApplyReference;
    button.setAttribute('aria-label', `${ref.title} · 이 사진 쓰기`); return button;
  }
  function createFeedback(prefix, parent) {
    const status = node('p', 'visual-apply-status'); status.id = prefix + '-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const fallback = node('div', 'visual-apply-fallback'); fallback.id = prefix + '-fallback'; fallback.hidden = true;
    parent.append(status, fallback);
  }
  function installActions() {
    if ($('visual-apply-tools')) return;
    const tools = node('div', 'visual-apply-tools'); tools.id = 'visual-apply-tools';
    const label = node('p', 'visual-apply-target'); label.id = 'visual-apply-target';
    const buttons = node('div', 'visual-apply-buttons');
    const library = actionButton('라이브러리에서 고르기', 'secondary small', showLibrary);
    const add = actionButton('내 사진 업로드', 'secondary small', () => upload()); add.dataset.referenceUpload = '';
    buttons.append(library, add); tools.append(label, buttons); createFeedback('visual-apply', tools);
    $('visual-result-count').before(tools);
    const dialog = node('div', 'visual-dialog-actions'); dialog.id = 'visual-dialog-actions'; createFeedback('visual-dialog-apply', dialog); $('visual-dialog-links').after(dialog);
  }
  function markdownFor(id, locale) {
    const entry = entryFor(id, locale);
    if (!entry) return '';
    return `\n\n### 이미지 레퍼런스\n\n선택 이유: ${entry.reason}\n\n재작화 방향: ${entry.redrawDirection}\n\n` + entry.references.map(ref => `- [${ref.title}](${ref.sourceUrl}) — ${ref.creator}\n  - 이미지: ${ref.imageUrl}\n  - 참고할 점: ${ref.whatToBorrow}`).join('\n');
  }
  function imageCard(ref) {
    const article = node('article', 'visual-card');
    const button = node('button', 'visual-image-button'); button.type = 'button'; button.setAttribute('aria-label', `${ref.title} 크게 보기`);
    const image = node('img'); image.src = displayUrl(ref); image.alt = ref.title; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
    const fallback = node('span', 'visual-image-fallback', '여기서 이미지가 보이지 않으면 아래 원본 이미지 링크를 열어 봐.'); fallback.hidden = true;
    image.addEventListener('error', () => { image.hidden = true; fallback.hidden = false; button.classList.add('image-unavailable'); });
    button.append(image, fallback); button.addEventListener('click', () => openImage(ref, button)); article.append(button);
    const info = node('div', 'visual-card-info');
    info.append(node('p', 'visual-kicker', `${{ photo: 'PHOTOGRAPH', film: 'FILM STILL', illustration: 'ILLUSTRATION' }[ref.kind]} · ${ref.moods.slice(0, 3).join(' / ')}`), node('h3', '', ref.title), node('p', 'visual-borrow', ref.whatToBorrow));
    const links = node('div', 'visual-card-links'); links.append(link('출처 열기 ↗', ref.sourceUrl), link('원본 이미지 ↗', ref.imageUrl));
    const actions = node('div', 'visual-card-actions'); actions.append(useButton(ref));
    info.append(actions, links, node('p', 'visual-credit', ref.creator)); article.append(info); return article;
  }
  function openImage(ref, opener) {
    dialogOpener = opener;
    $('visual-dialog-title').textContent = ref.title;
    $('visual-dialog-image').src = assetUrlFor(ref.id) || ref.imageUrl; $('visual-dialog-image').alt = ref.title; $('visual-dialog-image').hidden = false;
    $('visual-dialog-image-error').hidden = true;
    $('visual-dialog-image').onerror = () => { $('visual-dialog-image').hidden = true; $('visual-dialog-image-error').hidden = false; };
    $('visual-dialog-caption').textContent = ref.whatToBorrow;
    $('visual-dialog-links').replaceChildren(useButton(ref), link('출처 열기 ↗', ref.sourceUrl), link('원본 이미지 ↗', ref.imageUrl), node('span', 'visual-credit', ref.creator));
    renderFeedback();
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
    if ($('visual-apply-target')) $('visual-apply-target').textContent = `사진을 적용할 곳 · ${targetLabel()}`;
    let items = mode === 'current' ? (entry?.references || []) : [...refs.values()].filter(ref => {
      const words = [ref.title, ref.creator, ...ref.moods, ref.whatToBorrow].join(' ').toLocaleLowerCase();
      return (kind === 'all' || kind === ref.kind) && (category === 'all' || referenceCategories.get(ref.id)?.has(category)) && (!search || words.includes(search));
    });
    const grid = document.createDocumentFragment(); for (const ref of items) grid.append(imageCard(ref)); $('visual-grid').replaceChildren(grid);
    $('visual-result-count').textContent = mode === 'current' ? `이 원고의 추천 사진 ${Math.min(items.length, 3)}개 · 최대 3개` : `${items.length} / ${refs.size}개 이미지`;
    $('visual-empty').hidden = items.length > 0;
    renderFeedback();
  }
  function setContext(value) {
    context = { ...value };
    selected = { campaignId: value.campaignId, locale: value.locale };
    renderPicker(); render();
  }
  function showCurrent() { mode = 'current'; if (context) setContext(context); else render(); }
  function showLibrary() { mode = 'all'; render(); $('visual-search').focus(); }
  function indexCategories() {
    referenceCategories = new Map();
    for (const item of data?.assignments || []) {
      const c = book.find(c => c.id === item.campaignId);
      for (const id of item.referenceIds) { if (!referenceCategories.has(id)) referenceCategories.set(id, new Set()); if (c) referenceCategories.get(id).add(c.category); }
    }
  }
  function init(options) {
    book = options.campaigns; onEdit = options.onEdit; onApplyReference = options.onApplyReference; onUpload = options.onUpload;
    installActions(); indexCategories();
    renderPicker(); render();
  }
  function downloadList() {
    if (!data) return;
    const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
    const a = node('a'); a.href = href; a.download = 'sajupinggye-300-image-references.json'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(href), 10000);
  }
  $('visual-mode-current').addEventListener('click', showCurrent);
  $('visual-mode-all').addEventListener('click', showLibrary);
  $('visual-locale').addEventListener('change', () => { selected.locale = $('visual-locale').value; renderPicker(); render(); });
  $('visual-campaign').addEventListener('change', () => { selected.campaignId = $('visual-campaign').value; render(); });
  $('visual-search').addEventListener('input', () => { search = $('visual-search').value.trim().toLocaleLowerCase(); render(); });
  $('visual-kind').addEventListener('change', () => { kind = $('visual-kind').value; render(); });
  $('visual-category').addEventListener('change', () => { category = $('visual-category').value; render(); });
  $('visual-edit-campaign').addEventListener('click', () => { if (campaign() || selected.campaignId === context?.campaignId) onEdit?.(selected.campaignId, selected.locale); });
  $('visual-download').addEventListener('click', downloadList);
  $('visual-dialog-close').addEventListener('click', () => $('visual-dialog').close());
  $('visual-dialog').addEventListener('click', event => { if (event.target === $('visual-dialog')) { const r = $('visual-dialog').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('visual-dialog').close(); } });
  $('visual-dialog').addEventListener('close', () => { $('visual-dialog-image').removeAttribute('src'); (dialogOpener?.isConnected && !dialogOpener.closest('[hidden]') ? dialogOpener : ($('visuals-panel').hidden ? $('tab-studio') : $('visual-mode-current'))).focus({ preventScroll: true }); });
  const request = new AbortController(), requestTimer = setTimeout(() => request.abort(), 12000);
  const assetRequest = new AbortController(), assetTimer = setTimeout(() => assetRequest.abort(), 12000);
  const assetsReady = fetch('visual-assets.json', { cache: 'no-cache', signal: assetRequest.signal }).then(async response => {
    if (!response.ok) return null;
    const value = await response.json(); localAssets = readAssets(value); render(); return value;
  }).catch(() => null).finally(() => clearTimeout(assetTimer));
  const ready = fetch('visual-references.json', { cache: 'no-cache', signal: request.signal }).then(async response => {
    if (!response.ok) throw new Error('이미지 목록을 불러오지 못했어. 잠시 뒤 새로고침해 줘.');
    data = readData(await response.json()); refs = new Map(data.references.map(ref => [ref.id, ref])); assignments = new Map(data.assignments.map(item => [keyOf(item), item]));
    await assetsReady;
    indexCategories();
    $('visual-loading').hidden = true;
    $('visual-summary').textContent = `${refs.size}개 실제 이미지 · ${assignments.size}개 원고에 연결 · ${data.checkedAt || ''} 확인`;
    $('visual-download').disabled = false; render(); return data;
  }).catch(error => { $('visual-loading').textContent = error.name === 'AbortError' ? '이미지 목록 응답이 늦어. 새로고침하면 다시 불러올 수 있어. 원고 저장은 계속할 수 있어.' : error.message; $('visual-loading').classList.add('error'); return null; }).finally(() => clearTimeout(requestTimer));
  window.SajuVisuals = Object.freeze({ ready, assetsReady, assetFor, assetUrlFor, init, setContext, showCurrent, showLibrary, entryFor, markdownFor, bundle: () => data ? JSON.parse(JSON.stringify(data)) : null });
})();
