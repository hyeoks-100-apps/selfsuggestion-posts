'use strict';

(() => {
  const STORE_KEY = 'spg_ig_studio_v1';
  const APP_ID = 'sajupinggye-instagram-studio';
  const LOCALES = ['ko', 'ja', 'en'];
  const TEMPLATES = ['hanji', 'muk', 'inyeon'];
  const MAX_CAMPAIGNS = 100;
  const MAX_BACKUP_BYTES = 8 * 1024 * 1024;
  const MAX_TAGS = 5;
  const MAX_CAPTION = 2200;
  const LIMITS = { title: 180, body: 1400, note: 360, eyebrow: 180, caption: 10000, label: 160, topic: 100 };
  const SERIF = '"Noto Serif CJK KR","Noto Serif CJK JP","AppleMyungjo","Hiragino Mincho ProN","Yu Mincho","Batang",Georgia,serif';
  const SANS = '-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Hiragino Kaku Gothic ProN","Yu Gothic","Malgun Gothic",sans-serif';
  const $ = id => document.getElementById(id);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  const byteLength = value => new TextEncoder().encode(value).length;
  let catalog;
  let state;
  let saveTimer;
  let previewTimer;
  let previewToken = 0;
  let previewOkay = false;
  let busy = false;
  let storageFailed = false;

  function message(text, error = false) {
    const needsBackup = storageFailed && !error;
    $('save-status').textContent = text + (needsBackup ? ' · 자동 저장은 실패했어. JSON 백업을 받아 둬.' : '');
    $('save-status').classList.toggle('error', error || needsBackup);
  }

  function text(value, label, max, allowEmpty = true) {
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
      throw new Error(`${label} 형식이 맞지 않아. 문자열 ${max.toLocaleString()}자 이내로 확인해 줘.`);
    }
    if (!allowEmpty && !value.trim()) throw new Error(`${label}이 비어 있어.`);
    return value;
  }

  function exactKeys(value, allowed, label) {
    if (!plain(value)) throw new Error(`${label}은 JSON 객체여야 해.`);
    if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`${label}에 지원하지 않는 항목이 있어. 이 작업실에서 받은 백업인지 확인해 줘.`);
  }

  function validId(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) {
      throw new Error('기획 ID 형식이 맞지 않아.');
    }
    return value;
  }

  function readTags(value) {
    if (!Array.isArray(value) || value.length > MAX_TAGS) throw new Error('해시태그는 문자열 배열로, 최대 5개까지 넣을 수 있어.');
    return value.map(tag => {
      const result = text(tag, '해시태그', 80, false);
      if (/\s/.test(result)) throw new Error('해시태그 한 개 안에는 공백을 넣을 수 없어.');
      return result;
    });
  }

  function readSlide(value) {
    if (!plain(value)) throw new Error('슬라이드 형식이 맞지 않아.');
    return { eyebrow: text(value.eyebrow, '슬라이드 작은 제목', LIMITS.eyebrow), title: text(value.title, '제목', LIMITS.title), body: text(value.body, '본문', LIMITS.body), note: text(value.note, '덧말', LIMITS.note) };
  }

  function readLocale(value) {
    if (!plain(value) || !Array.isArray(value.slides) || value.slides.length !== 5) throw new Error('각 언어에는 슬라이드 다섯 장이 필요해.');
    return { label: text(value.label, '기획 이름', LIMITS.label, false), caption: text(value.caption, '캡션', LIMITS.caption), hashtags: readTags(value.hashtags), slides: value.slides.map(readSlide) };
  }

  function readCampaign(value) {
    if (!plain(value) || !plain(value.locales)) throw new Error('기획 데이터 형식이 맞지 않아.');
    const locales = Object.create(null);
    for (const locale of LOCALES) {
      if (!own(value.locales, locale)) throw new Error(`${value.id || '기획'}의 ${locale.toUpperCase()} 원고가 없어.`);
      locales[locale] = readLocale(value.locales[locale]);
    }
    return { id: validId(value.id), topic: text(value.topic, '기획 주제', LIMITS.topic, false), locales };
  }

  function readCatalog(value) {
    if (!plain(value) || value.version !== 1 || !plain(value.brand) || !Array.isArray(value.campaigns) || !value.campaigns.length || value.campaigns.length > MAX_CAMPAIGNS) {
      throw new Error('원본 기획 데이터 형식이 맞지 않아.');
    }
    const campaigns = value.campaigns.map(readCampaign);
    if (new Set(campaigns.map(item => item.id)).size !== campaigns.length) throw new Error('원본 기획 ID가 중복돼 있어.');
    const site = safeUrl(value.brand.site);
    if (!site) throw new Error('브랜드의 웹 주소를 확인해 줘.');
    return { version: 1, brand: { name: text(value.brand.name, '브랜드 이름', 100, false), englishName: text(value.brand.englishName, '영문 브랜드 이름', 100, false), site }, campaigns };
  }

  function initialState() {
    return { app: APP_ID, version: 1, settings: { campaignId: catalog.campaigns[0].id, locale: 'ko', slideIndex: 0, template: 'hanji', format: 'feed' }, campaigns: [], topics: Object.create(null), edits: Object.create(null), posted: Object.create(null) };
  }

  function readBackup(value) {
    exactKeys(value, ['app', 'version', 'exportedAt', 'savedAt', 'settings', 'campaigns', 'topics', 'edits', 'posted'], '백업');
    if (value.app !== APP_ID || value.version !== 1) throw new Error('사주핑계 작업실 v1 백업이 아니야. 자기암시 스튜디오 백업과는 별개야.');
    if (!Array.isArray(value.campaigns) || value.campaigns.length + catalog.campaigns.length > MAX_CAMPAIGNS) throw new Error(`기획은 원본을 포함해 ${MAX_CAMPAIGNS}개까지 보관할 수 있어.`);
    const result = initialState();
    result.campaigns = value.campaigns.map(readCampaign);
    const ids = [...catalog.campaigns, ...result.campaigns].map(item => item.id);
    if (new Set(ids).size !== ids.length) throw new Error('백업에 중복된 기획 ID가 있어. 게시 기록이 섞일 수 있으니 확인해 줘.');
    exactKeys(value.settings, ['campaignId', 'locale', 'slideIndex', 'template', 'format'], '선택 설정');
    const s = value.settings;
    if (!ids.includes(s.campaignId) || !LOCALES.includes(s.locale) || !Number.isInteger(s.slideIndex) || s.slideIndex < 0 || s.slideIndex > 4 || !TEMPLATES.includes(s.template) || !['feed', 'story'].includes(s.format)) {
      throw new Error('백업의 주제·언어·슬라이드·템플릿 선택을 확인해 줘.');
    }
    result.settings = { campaignId: s.campaignId, locale: s.locale, slideIndex: s.slideIndex, template: s.template, format: s.format };
    if (!plain(value.topics) || Object.keys(value.topics).length > ids.length) throw new Error('백업의 주제 목록 형식이 맞지 않아.');
    for (const [id, topic] of Object.entries(value.topics)) {
      if (!ids.includes(id)) throw new Error('주제 수정에 알 수 없는 기획 ID가 있어.');
      result.topics[id] = text(topic, '기획 주제', LIMITS.topic);
    }
    const allowedPairs = new Set(ids.flatMap(id => LOCALES.map(locale => `${id}:${locale}`)));
    if (!plain(value.edits) || Object.keys(value.edits).length > allowedPairs.size) throw new Error('문구 수정 기록의 형식이 맞지 않아.');
    for (const [key, edit] of Object.entries(value.edits)) {
      if (!allowedPairs.has(key)) throw new Error('문구 수정에 알 수 없는 기획이나 언어가 있어.');
      exactKeys(edit, ['label', 'caption', 'hashtags', 'hashtagText', 'slides'], '문구 수정');
      if (!Array.isArray(edit.slides) || edit.slides.length !== 5) throw new Error('문구 수정에는 슬라이드 다섯 장이 필요해.');
      result.edits[key] = {
        label: text(edit.label, '기획 이름', LIMITS.label), caption: text(edit.caption, '캡션', LIMITS.caption), hashtags: readTags(edit.hashtags), hashtagText: text(edit.hashtagText === undefined ? edit.hashtags.join(' ') : edit.hashtagText, '해시태그 초안', 2400),
        slides: edit.slides.map(slide => {
          exactKeys(slide, ['title', 'body', 'note'], '슬라이드 수정');
          return { title: text(slide.title, '제목', LIMITS.title), body: text(slide.body, '본문', LIMITS.body), note: text(slide.note, '덧말', LIMITS.note) };
        })
      };
    }
    if (!plain(value.posted) || Object.keys(value.posted).length > allowedPairs.size) throw new Error('게시 기록 형식이 맞지 않아.');
    for (const [key, date] of Object.entries(value.posted)) {
      if (!allowedPairs.has(key) || typeof date !== 'string' || date.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(date) || !Number.isFinite(Date.parse(date))) throw new Error('게시 기록의 기획·언어·날짜를 확인해 줘.');
      result.posted[key] = date;
    }
    return result;
  }

  function campaigns() { return [...catalog.campaigns, ...state.campaigns]; }
  function selectedCampaign() { return campaigns().find(item => item.id === state.settings.campaignId); }
  function pairKey(id = state.settings.campaignId, locale = state.settings.locale) { return `${id}:${locale}`; }
  function topicOf(campaign) { return own(state.topics, campaign.id) ? state.topics[campaign.id] : campaign.topic; }

  function localeContent(campaign = selectedCampaign(), locale = state.settings.locale) {
    const base = campaign.locales[locale];
    const edit = state.edits[pairKey(campaign.id, locale)];
    if (!edit) return clone(base);
    return { label: edit.label, caption: edit.caption, hashtags: [...edit.hashtags], slides: base.slides.map((slide, index) => ({ ...slide, ...edit.slides[index] })) };
  }

  function ensureEdit() {
    const key = pairKey();
    if (!own(state.edits, key)) {
      const source = localeContent();
      state.edits[key] = { label: source.label, caption: source.caption, hashtags: [...source.hashtags], hashtagText: source.hashtags.join(' '), slides: source.slides.map(({ title, body, note }) => ({ title, body, note })) };
    }
    return state.edits[key];
  }

  function envelope() { return { ...state, savedAt: new Date().toISOString() }; }

  function saveNow() {
    clearTimeout(saveTimer);
    try {
      const json = JSON.stringify(envelope());
      if (byteLength(json) > MAX_BACKUP_BYTES) throw new Error('저장 용량 한도');
      localStorage.setItem(STORE_KEY, json);
      storageFailed = false;
      message(`이 브라우저에 저장했어 · ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`);
      return true;
    } catch (_) {
      storageFailed = true;
      message('브라우저에 저장하지 못했어. 작업을 잃지 않도록 JSON 백업을 받아 줘.', true);
      return false;
    }
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    if (!storageFailed) message('변경 내용을 저장하는 중…');
    saveTimer = setTimeout(saveNow, 300);
  }

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }

  function renderCampaigns() {
    const focused = $('campaign-list').contains(document.activeElement) ? document.activeElement.dataset.campaign : undefined;
    const scrollTop = $('campaign-list').scrollTop;
    const items = campaigns();
    $('campaign-count').textContent = `${items.length} / ${MAX_CAMPAIGNS}`;
    $('duplicate-campaign').disabled = busy || items.length >= MAX_CAMPAIGNS;
    const fragment = document.createDocumentFragment();
    items.forEach((campaign, index) => {
      const button = element('button', 'campaign-card');
      button.type = 'button';
      button.dataset.campaign = campaign.id;
      button.setAttribute('aria-pressed', String(campaign.id === state.settings.campaignId));
      button.append(element('span', 'campaign-number', `${String(index + 1).padStart(2, '0')} · ${topicOf(campaign) || '이름 없는 주제'}`));
      button.append(element('span', 'campaign-title', localeContent(campaign).label || '이름 없는 기획'));
      const posted = own(state.posted, pairKey(campaign.id));
      button.append(element('span', `campaign-meta${posted ? ' is-posted' : ''}`, `${LOCALES.includes(state.settings.locale) ? state.settings.locale.toUpperCase() : ''} · ${posted ? '게시 완료 ✓' : '슬라이드 5장'}${index >= catalog.campaigns.length ? ' · 내 기획' : ''}`));
      fragment.append(button);
    });
    $('campaign-list').replaceChildren(fragment);
    $('campaign-list').scrollTop = scrollTop;
    if (focused) [...$('campaign-list').querySelectorAll('[data-campaign]')].find(button => button.dataset.campaign === focused)?.focus({ preventScroll: true });
  }

  function renderSelections() {
    const focusedSlide = $('slide-buttons').contains(document.activeElement) ? document.activeElement.dataset.slide : undefined;
    document.querySelectorAll('[data-locale]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.locale === state.settings.locale)));
    document.querySelectorAll('[data-template]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.template === state.settings.template)));
    $('format').value = state.settings.format;
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 5; index++) {
      const button = element('button', '', String(index + 1).padStart(2, '0'));
      button.type = 'button';
      button.dataset.slide = String(index);
      button.setAttribute('aria-label', `${index + 1}번째 슬라이드`);
      button.setAttribute('aria-current', String(index === state.settings.slideIndex));
      fragment.append(button);
    }
    $('slide-buttons').replaceChildren(fragment);
    if (focusedSlide !== undefined) [...$('slide-buttons').querySelectorAll('[data-slide]')].find(button => button.dataset.slide === focusedSlide)?.focus({ preventScroll: true });
    $('previous-slide').disabled = state.settings.slideIndex === 0;
    $('next-slide').disabled = state.settings.slideIndex === 4;
  }

  function renderEditor() {
    const content = localeContent();
    const slide = content.slides[state.settings.slideIndex];
    $('slide-label').textContent = `${String(state.settings.slideIndex + 1).padStart(2, '0')} / 05`;
    $('content-label').textContent = `${state.settings.locale.toUpperCase()} · ${slide.eyebrow}`;
    $('edit-topic').value = topicOf(selectedCampaign());
    $('edit-label').value = content.label;
    for (const field of ['title', 'body', 'note']) $('edit-' + field).value = slide[field];
    $('edit-caption').value = content.caption;
    $('edit-hashtags').value = state.edits[pairKey()] ? state.edits[pairKey()].hashtagText : content.hashtags.join(' ');
    $('edit-label').lang = state.settings.locale;
    for (const field of ['title', 'body', 'note', 'caption', 'hashtags']) $('edit-' + field).lang = state.settings.locale;
    updateCounts();
    const date = state.posted[pairKey()];
    $('posted-check').checked = Boolean(date);
    $('posted-at').textContent = date ? `${new Date(date).toLocaleString('ko-KR')}에 게시 완료로 표시했어.` : '게시 기록은 주제와 언어별로 따로 남아.';
  }

  function updateCounts() {
    for (const field of ['title', 'body', 'note']) $('' + field + '-count').textContent = `${$('edit-' + field).value.length}자`;
    const count = parseTags($('edit-hashtags').value).length;
    const longTag = parseTags($('edit-hashtags').value).some(tag => tag.length > 80);
    $('hashtag-message').textContent = `${count} / ${MAX_TAGS}개${count > MAX_TAGS ? ' · 5개 이하로 줄여야 복사와 ZIP 저장을 할 수 있어.' : longTag ? ' · 태그 한 개는 80자 이내로 줄여 줘.' : ' · 공백이나 줄바꿈으로 구분해 줘.'}`;
    $('hashtag-message').style.color = count > MAX_TAGS || longTag ? 'var(--danger)' : '';
    const length = Array.from(captionText({ caption: $('edit-caption').value, hashtags: parseTags($('edit-hashtags').value) })).length;
    $('caption-count').textContent = `캡션 + 태그 ${length.toLocaleString()} / 2,200자${length > MAX_CAPTION ? ' · 글을 줄인 뒤 복사하거나 ZIP으로 저장해 줘.' : ''}`;
    $('caption-count').style.color = length > MAX_CAPTION ? 'var(--danger)' : '';
  }

  function renderAll() { renderCampaigns(); renderSelections(); renderEditor(); requestPreview(); }

  function selectSlide(index) {
    state.settings.slideIndex = Math.max(0, Math.min(4, index));
    renderSelections(); renderEditor(); requestPreview(); saveSoon();
  }

  function parseTags(value) {
    const tags = value.trim().split(/\s+/u).filter(Boolean).map(tag => '#' + tag.replace(/^[#＃]+/, ''));
    return [...new Set(tags.filter(tag => tag !== '#'))];
  }

  function commitEditor() {
    const edit = ensureEdit();
    edit.label = $('edit-label').value;
    edit.caption = $('edit-caption').value;
    const tags = parseTags($('edit-hashtags').value);
    edit.hashtagText = $('edit-hashtags').value;
    if (tags.length <= MAX_TAGS && tags.every(tag => tag.length <= 80)) edit.hashtags = tags;
    edit.slides[state.settings.slideIndex] = { title: $('edit-title').value, body: $('edit-body').value, note: $('edit-note').value };
    state.topics[state.settings.campaignId] = $('edit-topic').value;
  }

  function checkTags() {
    const tags = parseTags($('edit-hashtags').value);
    if (tags.length > MAX_TAGS) throw new Error('해시태그는 5개까지야. 입력은 그대로 보관했어. 줄인 뒤 다시 복사하거나 ZIP으로 저장해 줘.');
    if (tags.some(tag => tag.length > 80)) throw new Error('해시태그 한 개는 80자 이내로 줄여 줘.');
    return tags;
  }

  function checkPublishContent() {
    const hashtags = checkTags();
    const length = Array.from(captionText({ caption: $('edit-caption').value, hashtags })).length;
    if (length > MAX_CAPTION) throw new Error(`캡션과 태그를 합쳐 ${length.toLocaleString()}자야. 2,200자 이내로 줄여 줘. 입력은 그대로 보관했어.`);
  }

  function duplicateCampaign() {
    if (campaigns().length >= MAX_CAMPAIGNS) { message(`기획은 ${MAX_CAMPAIGNS}개까지 만들 수 있어.`, true); return; }
    commitEditor();
    const source = selectedCampaign();
    const suffix = globalThis.crypto && typeof crypto.randomUUID === 'function' ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
    const id = `local-${Date.now().toString(36)}-${suffix}`;
    const locales = Object.create(null);
    const names = { ko: '새 기획', ja: '新しい企画', en: 'new edition' };
    for (const locale of LOCALES) {
      locales[locale] = localeContent(source, locale);
      locales[locale].label = `${locales[locale].label.slice(0, 140)} · ${names[locale]}`;
    }
    state.campaigns.push({ id, topic: `${topicOf(source).slice(0, 90)} · 복제`, locales });
    for (const locale of LOCALES) {
      const edit = state.edits[pairKey(source.id, locale)];
      if (edit) state.edits[pairKey(id, locale)] = { ...clone(edit), label: locales[locale].label };
    }
    state.settings.campaignId = id;
    state.settings.slideIndex = 0;
    renderAll();
    if (saveNow()) message('세 언어를 새 기획으로 복제했어. 이름을 고치고 다음 게시물을 준비해. 게시 기록은 새로 시작해.');
    $('edit-label').focus();
  }

  function safeUrl(value) {
    if (typeof value !== 'string' || value.length > 3000) return null;
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch (_) { return null; }
  }

  function displayValue(value) {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join(' · ');
    if (plain(value)) return Object.entries(value).map(([key, item]) => `${key}: ${displayValue(item)}`).join(' · ');
    return '';
  }

  function appendLink(parent, label, url) {
    const href = safeUrl(url);
    if (!href) return;
    const link = element('a', '', label);
    link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    parent.append(link);
  }

  function renderReferences(data) {
    if (!plain(data) || !Array.isArray(data.regions) || data.regions.length > 10) throw new Error('레퍼런스 노트 형식이 맞지 않아.');
    $('references-date').textContent = `자료 확인일 · ${displayValue(data.checkedAt)}`;
    $('references-summary').textContent = displayValue(data.positioning && data.positioning.summary) || '원문에서 확인한 형식과 가져올 원칙을 구분해 정리했어.';
    const regions = document.createDocumentFragment();
    for (const region of data.regions) {
      const section = element('section', 'reference-region');
      const heading = element('div', 'region-heading');
      heading.append(element('span', 'region-label', displayValue(region.id).toUpperCase()), element('h3', '', displayValue(region.label)));
      section.append(heading, element('p', 'region-summary', displayValue(region.summary)));
      const cards = element('div', 'reference-cards');
      for (const item of (Array.isArray(region.items) ? region.items : []).slice(0, 30)) {
        const card = element('article', 'reference-card');
        card.append(element('span', 'reference-account', displayValue(item.account)), element('h3', '', displayValue(item.title)));
        const details = element('dl', 'reference-details');
        for (const [key, label] of [['format', '형식'], ['observed', '관찰'], ['cta', '다음 행동'], ['apply', '적용']]) {
          details.append(element('dt', '', label), element('dd', '', displayValue(item[key]) || '확인 기록 없음'));
        }
        card.append(details);
        card.append(element('p', 'verification', `확인 수준 · ${displayValue(item.verification) || '별도 확인 필요'}`));
        const links = element('div', 'reference-links');
        appendLink(links, '계정 원문 ↗', item.url);
        appendLink(links, '게시물 원문 ↗', item.postUrl);
        card.append(links); cards.append(card);
      }
      section.append(cards); regions.append(section);
    }
    $('reference-regions').replaceChildren(regions);
    const positioning = $('reference-positioning');
    positioning.replaceChildren(element('h3', '', '사주핑계에 가져올 원칙'));
    const rules = element('ul');
    for (const rule of (data.positioning && Array.isArray(data.positioning.rules) ? data.positioning.rules : [])) rules.append(element('li', '', displayValue(rule)));
    positioning.append(rules);
    if (data.positioning && Array.isArray(data.positioning.marketEvidence)) {
      positioning.append(element('h3', '', '확인한 자료'));
      for (const evidence of data.positioning.marketEvidence) {
        const paragraph = element('p');
        appendLink(paragraph, displayValue(evidence.label) || '원문 보기', evidence.url);
        paragraph.append(document.createTextNode(` — ${displayValue(evidence.note)}`));
        positioning.append(paragraph);
      }
    }
  }

  // Keep every renderer local: no external fonts, photos, image APIs or HTML templates.
  function font(context, size, serif = false, weight = 400) { context.font = `${weight} ${size}px ${serif ? SERIF : SANS}`; }

  function wordUnits(value, locale) {
    if (globalThis.Intl && typeof Intl.Segmenter === 'function') return [...new Intl.Segmenter(locale, { granularity: 'word' }).segment(value)].map(item => item.segment);
    return value.match(/\s+|[A-Za-z0-9À-ž]+(?:['’\-][A-Za-z0-9À-ž]+)*|[^\s]/gu) || [];
  }

  function wrapLines(context, value, width, locale) {
    const lines = [];
    for (const paragraph of value.split('\n')) {
      let line = '';
      const queue = wordUnits(paragraph, locale);
      while (queue.length) {
        const unit = queue.shift();
        if (!/^\s+$/u.test(unit) && context.measureText(unit).width > width && Array.from(unit).length > 1) { queue.unshift(...Array.from(unit)); continue; }
        if (!line && /^\s+$/u.test(unit)) continue;
        if (context.measureText(line + unit).width <= width) { line += unit; continue; }
        if (/^\s+$/u.test(unit)) { if (line) lines.push(line.trimEnd()); line = ''; continue; }
        if (!line && Array.from(unit).length > 1) { queue.unshift(...Array.from(unit)); continue; }
        if (line) {
          // Carry a preceding character with Japanese closing punctuation; avoid a dangling opening mark.
          let carry = '';
          const closing = /^[、。，．？！：；）\]」』】〉》”’]/u.test(unit);
          const opening = /[（\[「『【〈《“‘]$/u.test(line);
          if (closing || opening) { const letters = Array.from(line.trimEnd()); carry = letters.pop() || ''; line = letters.join(''); }
          if (line) lines.push(line.trimEnd());
          line = carry;
          queue.unshift(unit);
        } else { lines.push(unit); }
      }
      lines.push(line.trimEnd());
    }
    return lines;
  }

  function fitText(context, value, box, options) {
    const { max, min, leading, serif = false, weight = 400, locale } = options;
    let result;
    for (let size = max; size >= min; size--) {
      font(context, size, serif, weight);
      const lines = value ? wrapLines(context, value, box.width, locale) : [];
      const lineHeight = size * leading;
      const height = lines.length ? (lines.length - 1) * lineHeight + size * 1.15 : 0;
      result = { size, lines, lineHeight, height, box, serif, weight, fits: height <= box.height && lines.every(line => context.measureText(line).width <= box.width + .1) };
      if (result.fits) break;
    }
    return result;
  }

  function drawText(context, fitted, color) {
    const { box, size, lines, lineHeight, serif, weight } = fitted;
    context.save(); context.beginPath(); context.rect(box.x, box.y - 3, box.width + 2, box.height + 5); context.clip();
    font(context, size, serif, weight); context.fillStyle = color; context.textBaseline = 'top';
    lines.forEach((line, index) => context.fillText(line, box.x, box.y + index * lineHeight));
    context.restore();
  }

  function motif(context, template, W, H, palette) {
    context.save();
    if (template === 'hanji') {
      context.strokeStyle = palette.accent; context.globalAlpha = .055; context.lineWidth = 1;
      for (let y = 17; y < H; y += 19) { context.beginPath(); context.moveTo(0, y); context.lineTo(W, y + ((y % 4) - 2) * .6); context.stroke(); }
      for (let x = 13; x < W; x += 31) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x + 3, H); context.stroke(); }
      context.globalAlpha = .35; context.strokeRect(40, 40, W - 80, H - 80); context.globalAlpha = .13; context.strokeRect(49, 49, W - 98, H - 98);
    }
    if (template === 'muk') {
      context.strokeStyle = palette.accent; context.globalAlpha = .18; context.lineWidth = 1.5;
      for (let radius = 340; radius <= 480; radius += 46) { context.beginPath(); context.arc(W + 20, H * .46, radius, 0, Math.PI * 2); context.stroke(); }
      context.globalAlpha = .08; context.fillStyle = palette.accent;
      for (let row = 0; row < 36; row++) for (let col = 0; col < 24; col++) { context.beginPath(); context.arc(31 + col * 47 + (row % 2) * 13, 30 + row * 57, 1.1, 0, Math.PI * 2); context.fill(); }
    }
    if (template === 'inyeon') {
      context.strokeStyle = palette.accent; context.lineWidth = 2; context.globalAlpha = .17;
      for (const [x, y, r] of [[W - 66, H * .43, 300], [W - 145, H * .53, 325], [W - 30, H * .62, 250]]) { context.beginPath(); context.arc(x, y, r, 0, Math.PI * 2); context.stroke(); }
      context.beginPath(); context.moveTo(46, H - 350); context.bezierCurveTo(170, H - 450, 270, H - 270, W - 45, H - 405); context.stroke();
    }
    const center = { x: W - 160, y: H * .51 }, radius = 192;
    context.globalAlpha = template === 'muk' ? .055 : .05; context.strokeStyle = palette.ink; context.fillStyle = palette.ink; context.lineWidth = 1;
    context.beginPath(); context.arc(center.x, center.y, radius, 0, Math.PI * 2); context.stroke();
    ['木', '火', '土', '金', '水'].forEach((symbol, index) => {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / 5;
      const x = center.x + Math.cos(angle) * radius, y = center.y + Math.sin(angle) * radius;
      context.beginPath(); context.arc(x, y, 23, 0, Math.PI * 2); context.stroke();
      font(context, 23, true); context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(symbol, x, y);
    });
    context.restore();
  }

  function drawPoster(canvas, slide, options) {
    const W = 1080, H = options.format === 'story' ? 1920 : 1350;
    canvas.width = W; canvas.height = H;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('이 브라우저에서 Canvas를 열지 못했어. 최신 브라우저로 다시 열어 줘.');
    const palettes = {
      hanji: { paper: '#f5efdf', ink: '#193d32', muted: '#6d7564', accent: '#a27e43' },
      muk: { paper: '#14362d', ink: '#f5f0df', muted: '#c1c9b7', accent: '#c5a66b' },
      inyeon: { paper: '#e9eddf', ink: '#264a38', muted: '#6b785e', accent: '#a0824c' }
    };
    const palette = palettes[options.template];
    context.fillStyle = palette.paper; context.fillRect(0, 0, W, H);
    motif(context, options.template, W, H, palette);
    context.textBaseline = 'top'; context.textAlign = 'left';
    context.strokeStyle = palette.accent; context.lineWidth = 1.4;
    context.beginPath(); context.arc(118, 112, 25, 0, Math.PI * 2); context.stroke();
    context.fillStyle = palette.accent; font(context, 25, true); context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('木', 118, 112);
    context.textAlign = 'left'; context.textBaseline = 'top'; font(context, 31, true, 500); context.fillStyle = palette.ink;
    context.fillText(options.locale === 'ko' ? catalog.brand.name : catalog.brand.englishName, 162, 91);
    font(context, 15, false, 600); context.fillStyle = palette.muted; context.fillText('A LITTLE EXCUSE TO KNOW YOURSELF', 99, 159);
    const issues = [];
    const contentX = 100, contentWidth = 880, eyebrowTop = H === 1350 ? 252 : 344;
    const eyebrow = fitText(context, slide.eyebrow, { x: contentX, y: eyebrowTop, width: contentWidth, height: 75 }, { max: 24, min: 19, leading: 1.4, weight: 500, locale: options.locale });
    const titleTop = eyebrowTop + Math.max(eyebrow.height, 28) + 32;
    const title = fitText(context, slide.title, { x: contentX, y: titleTop, width: contentWidth, height: H === 1350 ? 310 : 470 }, { max: options.template === 'muk' ? 80 : 78, min: 44, leading: 1.34, serif: true, weight: 500, locale: options.locale });
    const bodyTop = titleTop + Math.min(title.height, title.box.height) + 58;
    const body = fitText(context, slide.body, { x: contentX, y: bodyTop, width: 850, height: Math.max(0, H - 355 - bodyTop) }, { max: 43, min: 30, leading: 1.75, locale: options.locale });
    const note = fitText(context, slide.note, { x: contentX, y: H - 260, width: contentWidth, height: 95 }, { max: 26, min: 22, leading: 1.55, locale: options.locale });
    for (const [label, block] of [['작은 제목', eyebrow], ['제목', title], ['본문', body], ['덧말', note]]) if (!block.fits) issues.push(`${label}이 이미지 영역을 넘어가. 문장이나 줄바꿈을 조금 줄여 줘.`);
    if (!slide.title.trim()) issues.push('이미지 제목을 한 문장 넣어 줘.');
    drawText(context, eyebrow, palette.accent); drawText(context, title, palette.ink); drawText(context, body, palette.ink); drawText(context, note, palette.muted);
    context.strokeStyle = palette.accent; context.globalAlpha = .48; context.lineWidth = 1; context.beginPath(); context.moveTo(100, H - 132); context.lineTo(980, H - 132); context.stroke(); context.globalAlpha = 1;
    const footer = { ko: '무료 성향 풀이', ja: '無料で、自分の傾向を知る', en: 'Get your free Saju reading' }[options.locale];
    const footerBlock = fitText(context, footer, { x: 100, y: H - 102, width: 640, height: 40 }, { max: 23, min: 18, leading: 1.2, locale: options.locale });
    drawText(context, footerBlock, palette.ink);
    font(context, 16); context.fillStyle = palette.muted;
    context.fillText(new URL(catalog.brand.site).hostname, 100, H - 66);
    font(context, 22); context.textAlign = 'right'; context.fillStyle = palette.accent; context.fillText(`${String(options.slideIndex + 1).padStart(2, '0')} / 05`, 978, H - 94);
    context.textAlign = 'left';
    return issues;
  }

  function requestPreview() {
    clearTimeout(previewTimer);
    previewOkay = false;
    $('export-png').disabled = true;
    $('preview-message').textContent = '줄바꿈과 이미지 크기를 맞추는 중…';
    $('preview-message').classList.remove('error');
    const token = ++previewToken;
    previewTimer = setTimeout(() => renderPreview(token), 80);
  }

  async function renderPreview(token) {
    try {
      if (document.fonts) await document.fonts.ready;
      if (token !== previewToken || busy) return;
      const options = { ...state.settings };
      const content = localeContent();
      const offscreen = document.createElement('canvas');
      const issues = drawPoster(offscreen, content.slides[options.slideIndex], options);
      if (token !== previewToken) return;
      const canvas = $('poster'); canvas.width = offscreen.width; canvas.height = offscreen.height;
      canvas.getContext('2d').drawImage(offscreen, 0, 0);
      canvas.setAttribute('aria-label', `${content.label}, ${options.slideIndex + 1}번째 슬라이드. ${content.slides[options.slideIndex].title}. ${content.slides[options.slideIndex].body}`);
      $('preview-message').textContent = issues.length ? issues.join(' ') : `${canvas.width} × ${canvas.height} · ${options.locale.toUpperCase()} · ${options.slideIndex + 1} / 5`;
      $('preview-message').classList.toggle('error', issues.length > 0);
      previewOkay = issues.length === 0;
      $('export-png').disabled = !previewOkay;
    } catch (error) { $('preview-message').textContent = error.message; $('preview-message').classList.add('error'); }
  }

  function setBusy(value, label = '') {
    busy = value;
    $('workspace').setAttribute('aria-busy', String(value));
    document.querySelectorAll('#workspace button, #workspace input, #workspace select, #workspace textarea').forEach(control => { control.disabled = value; });
    document.querySelectorAll('.workspace-tabs button').forEach(button => { button.disabled = value; });
    if (!value) {
      $('previous-slide').disabled = state.settings.slideIndex === 0;
      $('next-slide').disabled = state.settings.slideIndex === 4;
      $('duplicate-campaign').disabled = campaigns().length >= MAX_CAMPAIGNS;
      $('export-png').disabled = !previewOkay;
    }
    if (label) message(label);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function canvasPng(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG를 만들지 못했어. 다시 시도해 줘.')), 'image/png'));
  }

  function captionText(content) { return [content.caption.trim(), content.hashtags.join(' ')].filter(Boolean).join('\n\n'); }

  async function exportImages(allSlides) {
    if (busy) return;
    try {
      commitEditor(); saveNow();
      if (allSlides) checkPublishContent();
      const options = { ...state.settings }, content = localeContent(), campaign = selectedCampaign();
      setBusy(true, allSlides ? '현재 언어의 다섯 장을 만드는 중…' : 'PNG 이미지를 만드는 중…');
      if (document.fonts) await document.fonts.ready;
      const indexes = allSlides ? [0, 1, 2, 3, 4] : [options.slideIndex];
      const rendered = [];
      // Validate every requested slide before downloading anything.
      for (const index of indexes) {
        const canvas = document.createElement('canvas');
        const issues = drawPoster(canvas, content.slides[index], { ...options, slideIndex: index });
        if (issues.length) throw new Error(`${index + 1}번째 장: ${issues.join(' ')}`);
        rendered.push({ canvas, index });
      }
      const basename = `sajupinggye-${campaign.id}-${options.locale}-${options.format}-${options.template}`;
      if (!allSlides) {
        downloadBlob(await canvasPng(rendered[0].canvas), `${basename}-${String(options.slideIndex + 1).padStart(2, '0')}.png`);
      } else {
        const files = [];
        for (const { canvas, index } of rendered) {
          message(`${index + 1} / 5장 PNG를 묶는 중…`);
          const blob = await canvasPng(canvas);
          files.push({ name: `${String(index + 1).padStart(2, '0')}.png`, bytes: new Uint8Array(await blob.arrayBuffer()) });
        }
        const encoder = new TextEncoder();
        files.push({ name: 'caption.txt', bytes: encoder.encode(captionText(content) + '\n') });
        const metadata = { app: APP_ID, version: 1, exportedAt: new Date().toISOString(), brand: catalog.brand, campaignId: campaign.id, topic: topicOf(campaign), locale: options.locale, template: options.template, format: options.format, mediaType: 'image/png', width: 1080, height: options.format === 'story' ? 1920 : 1350, label: content.label, caption: content.caption, hashtags: content.hashtags, slides: content.slides.map((slide, index) => ({ file: `${String(index + 1).padStart(2, '0')}.png`, ...slide })) };
        files.push({ name: 'metadata.json', bytes: encoder.encode(JSON.stringify(metadata, null, 2) + '\n') });
        downloadBlob(makeZip(files), `${basename}.zip`);
      }
      message(allSlides ? '현재 언어의 PNG 다섯 장과 캡션을 ZIP으로 저장했어.' : '현재 장을 PNG로 저장했어.');
    } catch (error) { message(error.message || '이미지를 만들지 못했어.', true); }
    finally { setBusy(false); requestPreview(); }
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let value = n; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; table[n] = value >>> 0; }
    return table;
  })();

  function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 255] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }

  function makeZip(files) {
    const local = [], central = [], encoder = new TextEncoder();
    let offset = 0, centralSize = 0;
    const now = new Date(), year = Math.max(1980, Math.min(2107, now.getFullYear()));
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const file of files) {
      const name = encoder.encode(file.name), bytes = file.bytes, crc = crc32(bytes);
      const header = new Uint8Array(30), view = new DataView(header.buffer);
      view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true); view.setUint16(8, 0, true); view.setUint16(10, dosTime, true); view.setUint16(12, dosDate, true);
      view.setUint32(14, crc, true); view.setUint32(18, bytes.length, true); view.setUint32(22, bytes.length, true); view.setUint16(26, name.length, true);
      local.push(header, name, bytes);
      const directory = new Uint8Array(46), entry = new DataView(directory.buffer);
      entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x0800, true); entry.setUint16(10, 0, true); entry.setUint16(12, dosTime, true); entry.setUint16(14, dosDate, true);
      entry.setUint32(16, crc, true); entry.setUint32(20, bytes.length, true); entry.setUint32(24, bytes.length, true); entry.setUint16(28, name.length, true); entry.setUint32(42, offset, true);
      central.push(directory, name); centralSize += directory.length + name.length; offset += header.length + name.length + bytes.length;
    }
    const end = new Uint8Array(22), view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true); view.setUint16(8, files.length, true); view.setUint16(10, files.length, true); view.setUint32(12, centralSize, true); view.setUint32(16, offset, true);
    return new Blob([...local, ...central, end], { type: 'application/zip' });
  }

  async function copyCaption() {
    try {
      commitEditor(); saveNow(); checkPublishContent();
      const value = captionText(localeContent());
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(value);
      else {
        const textarea = document.createElement('textarea'); textarea.value = value; textarea.style.position = 'fixed'; textarea.style.left = '-10000px';
        document.body.append(textarea); textarea.select(); const copied = document.execCommand('copy'); textarea.remove();
        if (!copied) throw new Error('복사 권한이 없어. 캡션과 태그 칸에서 직접 복사해 줘.');
      }
      saveNow(); message('캡션과 해시태그를 복사했어. 인스타그램에 붙여 넣어 줘.');
    } catch (error) { message(error.message || '복사하지 못했어. 캡션 칸에서 직접 복사해 줘.', true); }
  }

  function exportBackup() {
    try {
      commitEditor();
      const value = { ...envelope(), exportedAt: new Date().toISOString() };
      readBackup(value);
      const json = JSON.stringify(value, null, 2);
      if (byteLength(json) > MAX_BACKUP_BYTES) throw new Error('백업이 8MB를 넘어가. 기획 수나 문구 길이를 줄여 줘.');
      downloadBlob(new Blob([json], { type: 'application/json;charset=utf-8' }), `sajupinggye-studio-${new Date().toISOString().slice(0, 10)}.json`);
      saveNow(); message('문구·복제 기획·선택 설정·게시 기록을 백업했어.');
    } catch (error) { message(error.message, true); }
  }

  async function importBackup(file) {
    if (!file || busy) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('백업은 8MB까지 불러올 수 있어.');
      setBusy(true, '백업 형식을 확인하는 중…');
      const raw = await file.text();
      let parsed;
      try { parsed = JSON.parse(raw); } catch (_) { throw new Error('JSON을 읽지 못했어. 압축파일이 아닌 작업실 JSON 백업을 골라 줘.'); }
      const restored = readBackup(parsed);
      state = restored;
      setBusy(false); renderAll();
      if (saveNow()) message(`백업을 불러왔어. 기획 ${campaigns().length}개와 언어별 게시 기록을 복원했어.`);
    } catch (error) { message(`백업을 불러오지 않았어. ${error.message}`, true); }
    finally { setBusy(false); $('backup-file').value = ''; }
  }

  function showTab(name) {
    for (const tabName of ['studio', 'references']) {
      const active = tabName === name, tab = $('tab-' + tabName);
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      $(tabName + '-panel').hidden = !active;
    }
    history.replaceState(null, '', name === 'references' ? '#references' : location.pathname + location.search);
  }

  function bindEvents() {
    document.querySelectorAll('.workspace-tabs button').forEach(button => {
      button.addEventListener('click', () => showTab(button.id.replace('tab-', '')));
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const name = event.key === 'Home' ? 'studio' : event.key === 'End' ? 'references' : button.id === 'tab-studio' ? 'references' : 'studio';
        showTab(name); $('tab-' + name).focus();
      });
    });
    document.querySelectorAll('[data-locale]').forEach(button => button.addEventListener('click', () => { state.settings.locale = button.dataset.locale; renderAll(); saveSoon(); }));
    document.querySelectorAll('[data-template]').forEach(button => button.addEventListener('click', () => { state.settings.template = button.dataset.template; renderSelections(); requestPreview(); saveSoon(); }));
    $('campaign-list').addEventListener('click', event => { const button = event.target.closest('[data-campaign]'); if (!button) return; state.settings.campaignId = button.dataset.campaign; state.settings.slideIndex = 0; renderAll(); saveSoon(); });
    $('format').addEventListener('change', () => { state.settings.format = $('format').value; requestPreview(); saveSoon(); });
    $('slide-buttons').addEventListener('click', event => { const button = event.target.closest('[data-slide]'); if (button) selectSlide(Number(button.dataset.slide)); });
    $('previous-slide').addEventListener('click', () => selectSlide(state.settings.slideIndex - 1));
    $('next-slide').addEventListener('click', () => selectSlide(state.settings.slideIndex + 1));
    document.querySelector('.slide-navigation').addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); selectSlide(state.settings.slideIndex + (event.key === 'ArrowRight' ? 1 : -1)); $('slide-buttons').querySelector('[aria-current="true"]').focus(); });
    for (const field of ['topic', 'label', 'title', 'body', 'note', 'caption', 'hashtags']) {
      $('edit-' + field).addEventListener('input', () => {
        commitEditor(); updateCounts();
        if (field === 'topic' || field === 'label') renderCampaigns();
        if (['title', 'body', 'note'].includes(field)) requestPreview();
        saveSoon();
      });
    }
    $('reset-slide').addEventListener('click', () => { const index = state.settings.slideIndex, slide = selectedCampaign().locales[state.settings.locale].slides[index]; ensureEdit().slides[index] = { title: slide.title, body: slide.body, note: slide.note }; renderEditor(); requestPreview(); saveSoon(); });
    $('posted-check').addEventListener('change', () => { if ($('posted-check').checked) state.posted[pairKey()] = new Date().toISOString(); else delete state.posted[pairKey()]; renderCampaigns(); renderEditor(); saveSoon(); });
    $('duplicate-campaign').addEventListener('click', duplicateCampaign);
    $('export-png').addEventListener('click', () => exportImages(false));
    $('export-zip').addEventListener('click', () => exportImages(true));
    $('copy-caption').addEventListener('click', copyCaption);
    $('export-backup').addEventListener('click', exportBackup);
    $('import-backup').addEventListener('click', () => $('backup-file').click());
    $('backup-file').addEventListener('change', () => importBackup($('backup-file').files[0]));
    window.addEventListener('hashchange', () => showTab(location.hash === '#references' ? 'references' : 'studio'));
    window.addEventListener('pagehide', () => { if (state) saveNow(); });
  }

  async function fetchJson(path) {
    const response = await fetch(path, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`${path}을 불러오지 못했어 (${response.status}).`);
    return response.json();
  }

  async function start() {
    bindEvents();
    // Reference failure should never prevent creating or exporting a post.
    const references = fetchJson('references.json').then(renderReferences).catch(() => { $('references-summary').textContent = '레퍼런스 노트를 불러오지 못했어. 새로고침하면 다시 확인할 수 있어. 콘텐츠 제작은 그대로 할 수 있어.'; $('reference-positioning').hidden = true; });
    try {
      catalog = readCatalog(await fetchJson('campaigns.json'));
      state = initialState();
      let restored = false, warning = '';
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) {
          if (byteLength(raw) > MAX_BACKUP_BYTES) throw new Error('저장 기록이 8MB를 넘어가.');
          state = readBackup(JSON.parse(raw)); restored = true;
        }
      } catch (_) { warning = '기존 저장 기록을 읽지 못했어. 원본 기획으로 열었어. 갖고 있는 JSON 백업을 불러올 수 있어.'; }
      $('loading').hidden = true; $('workspace').hidden = false;
      renderAll(); message(warning || (restored ? '이 브라우저의 문구와 게시 기록을 이어서 열었어.' : '원하는 주제와 언어를 고르면 시작할 수 있어.'), Boolean(warning));
      if (location.hash === '#references') showTab('references');
    } catch (error) { $('loading').hidden = true; $('load-error').hidden = false; $('load-error').textContent = `작업실을 열지 못했어. ${error.message} 페이지를 새로고침해 줘.`; message('원본 데이터를 확인해 줘.', true); }
    await references;
  }

  start();
})();
