'use strict';

(() => {
  const STORE_KEY = 'spg_ig_studio_v3';
  const PREVIOUS_STORE_KEY = 'spg_ig_studio_v2';
  const LEGACY_STORE_KEY = 'spg_ig_studio_v1';
  const APP_ID = 'sajupinggye-instagram-studio';
  const LOCALES = ['ko', 'ja', 'en'];
  const TABS = ['studio', 'visuals', 'references'];
  const TEMPLATES = ['hanji', 'muk', 'inyeon'];
  const MAX_CAMPAIGNS = 500;
  const MAX_IMAGE_BACKUP_BYTES = 64 * 1024 * 1024;
  const MAX_BACKUP_BYTES = 8 * 1024 * 1024;
  const MAX_TAGS = 5;
  const MAX_CAPTION = 2200;
  const LIMITS = { title: 180, body: 1400, note: 360, eyebrow: 180, caption: 10000, label: 160, topic: 100 };
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
  let categoryFilter = 'all';
  let collectionFilter = 'drafts';
  let searchTerm = '';
  let draftCatalog;
  let dirty = false;
  let lastSavedRaw = null;
  let storageConflict = false;
  let pendingUploadTarget;
  let photoRows = [], photoPage = 0, photoSearch = '', photoRenderToken = 0;
  let fullOpener;
  let copyPending = null, copyUndo = null, copyOpener, copyTextsPromise;
  let copyWorking = false, copyGeneration = 0;

  function message(text, error = false) {
    const needsBackup = (storageFailed || storageConflict) && !error;
    $('save-status').textContent = text + (needsBackup ? ' · 자동 저장은 실패했어. JSON 백업을 받아 둬.' : '');
    $('save-status').classList.toggle('error', error || needsBackup);
    if ($('full-editor-dialog').open) { $('full-status').textContent = $('save-status').textContent; $('full-status').classList.toggle('error', error || needsBackup); }
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
    if (!plain(value) || !Array.isArray(value.slides) || ![3, 5].includes(value.slides.length)) throw new Error('각 언어에는 슬라이드 3장 또는 이전 형식의 5장이 필요해.');
    const extra = {};
    if (value.visualSourceId !== undefined) extra.visualSourceId = validId(value.visualSourceId);
    if (value.topic !== undefined) extra.topic = text(value.topic, '현지 주제', LIMITS.topic);
    if (value.imageBrief !== undefined) extra.imageBrief = text(value.imageBrief, '그림 메모', 1200);
    if (value.artwork !== undefined) {
      if (!TEMPLATES.includes(value.artwork)) throw new Error('표지 이미지 형식을 확인해 줘.');
      extra.artwork = value.artwork;
    }
    return { label: text(value.label, '기획 이름', LIMITS.label, false), caption: text(value.caption, '캡션', LIMITS.caption), hashtags: readTags(value.hashtags), slides: value.slides.map(readSlide), ...extra };
  }

  function readCampaign(value) {
    if (!plain(value) || !plain(value.locales)) throw new Error('기획 데이터 형식이 맞지 않아.');
    const locales = Object.create(null);
    for (const locale of LOCALES) {
      if (!own(value.locales, locale)) throw new Error(`${value.id || '기획'}의 ${locale.toUpperCase()} 원고가 없어.`);
      locales[locale] = readLocale(value.locales[locale]);
    }
    const count = locales.ko.slides.length;
    if (LOCALES.some(locale => locales[locale].slides.length !== count)) throw new Error('같은 기획의 슬라이드 수는 세 언어 모두 같아야 해.');
    const category = value.category === undefined ? (count === 5 ? 'legacy' : 'custom') : text(value.category, '분류', 40, false);
    const artwork = value.artwork === undefined ? 'hanji' : value.artwork;
    if (!TEMPLATES.includes(artwork)) throw new Error('지원하는 표지 이미지를 선택해 줘.');
    return { id: validId(value.id), topic: text(value.topic, '기획 주제', LIMITS.topic, false), category, artwork, locales };
  }

  function readCatalog(value) {
    if (!plain(value) || ![1, 2, 3].includes(value.version) || !plain(value.brand) || !Array.isArray(value.campaigns) || !value.campaigns.length || value.campaigns.length > MAX_CAMPAIGNS) {
      throw new Error('원본 기획 데이터 형식이 맞지 않아.');
    }
    const campaigns = value.campaigns.map(readCampaign);
    if (new Set(campaigns.map(item => item.id)).size !== campaigns.length) throw new Error('원본 기획 ID가 중복돼 있어.');
    const site = safeUrl(value.brand.site);
    if (!site) throw new Error('브랜드의 웹 주소를 확인해 줘.');
    return { version: value.version, brand: { name: text(value.brand.name, '브랜드 이름', 100, false), englishName: text(value.brand.englishName, '영문 브랜드 이름', 100, false), site }, campaigns };
  }

  function initialState() {
    return { app: APP_ID, version: 3, backgrounds: Object.create(null), settings: { campaignId: catalog.campaigns[0].id, locale: 'ko', slideIndex: 0, template: 'hanji', artwork: 'auto', format: 'feed' }, campaigns: [], topics: Object.create(null), edits: Object.create(null), posted: Object.create(null) };
  }

  function readBackup(value) {
    exactKeys(value, ['app', 'version', 'exportedAt', 'savedAt', 'settings', 'campaigns', 'topics', 'edits', 'posted', 'backgrounds', 'assets'], '백업');
    if (value.app !== APP_ID || ![1, 2, 3].includes(value.version)) throw new Error('사주핑계 작업실 백업이 아니야. 자기암시 스튜디오 백업과는 별개야.');
    if (!Array.isArray(value.campaigns) || value.campaigns.length + catalog.campaigns.length > MAX_CAMPAIGNS) throw new Error(`기획은 원본을 포함해 ${MAX_CAMPAIGNS}개까지 보관할 수 있어.`);
    const result = initialState();
    result.campaigns = value.campaigns.map(readCampaign);
    const ids = [...catalog.campaigns, ...result.campaigns].map(item => item.id);
    if (new Set(ids).size !== ids.length) throw new Error('백업에 중복된 기획 ID가 있어. 게시 기록이 섞일 수 있으니 확인해 줘.');
    exactKeys(value.settings, ['campaignId', 'locale', 'slideIndex', 'template', 'artwork', 'format'], '선택 설정');
    const s = value.settings;
    if (!ids.includes(s.campaignId) || !LOCALES.includes(s.locale) || !Number.isInteger(s.slideIndex) || s.slideIndex < 0 || s.slideIndex > 4 || !TEMPLATES.includes(s.template) || !['feed', 'story'].includes(s.format)) {
      throw new Error('백업의 주제·언어·슬라이드·템플릿 선택을 확인해 줘.');
    }
    const selected = [...catalog.campaigns, ...result.campaigns].find(item => item.id === s.campaignId);
    if (s.slideIndex >= selected.locales[s.locale].slides.length || (s.artwork !== undefined && !['auto', ...TEMPLATES].includes(s.artwork))) throw new Error('백업의 페이지·표지 이미지 선택을 확인해 줘.');
    result.settings = { campaignId: s.campaignId, locale: s.locale, slideIndex: s.slideIndex, template: s.template, artwork: s.artwork || 'auto', format: s.format };
    if (!plain(value.topics) || Object.keys(value.topics).length > ids.length) throw new Error('백업의 주제 목록 형식이 맞지 않아.');
    for (const [id, topic] of Object.entries(value.topics)) {
      if (!ids.includes(id)) throw new Error('주제 수정에 알 수 없는 기획 ID가 있어.');
      result.topics[id] = text(topic, '기획 주제', LIMITS.topic);
    }
    const allowedPairs = new Set(ids.flatMap(id => LOCALES.map(locale => `${id}:${locale}`)));
    if (!plain(value.edits) || Object.keys(value.edits).length > allowedPairs.size) throw new Error('문구 수정 기록의 형식이 맞지 않아.');
    for (const [key, edit] of Object.entries(value.edits)) {
      if (!allowedPairs.has(key)) throw new Error('문구 수정에 알 수 없는 기획이나 언어가 있어.');
      exactKeys(edit, ['label', 'caption', 'hashtags', 'hashtagText', 'slides', 'imageBrief', 'topic'], '문구 수정');
      const [campaignId, locale] = key.split(':');
      const source = [...catalog.campaigns, ...result.campaigns].find(item => item.id === campaignId);
      if (!Array.isArray(edit.slides) || edit.slides.length !== source.locales[locale].slides.length) throw new Error('문구 수정의 슬라이드 수가 원본 기획과 달라.');
      result.edits[key] = {
        label: text(edit.label, '기획 이름', LIMITS.label), caption: text(edit.caption, '캡션', LIMITS.caption), hashtags: readTags(edit.hashtags), hashtagText: text(edit.hashtagText === undefined ? edit.hashtags.join(' ') : edit.hashtagText, '해시태그 초안', 2400),
        ...(edit.topic === undefined ? {} : { topic: text(edit.topic, '현지 주제', LIMITS.topic) }),
        ...(edit.imageBrief === undefined ? {} : { imageBrief: text(edit.imageBrief, '그림 메모', 1200) }),
        slides: edit.slides.map(slide => {
          exactKeys(slide, ['eyebrow', 'title', 'body', 'note'], '슬라이드 수정');
          return { ...(slide.eyebrow === undefined ? {} : { eyebrow: text(slide.eyebrow, '작은 제목', LIMITS.eyebrow) }), title: text(slide.title, '제목', LIMITS.title), body: text(slide.body, '본문', LIMITS.body), note: text(slide.note, '덧말', LIMITS.note) };
        })
      };
    }
    if (!plain(value.posted) || Object.keys(value.posted).length > allowedPairs.size) throw new Error('게시 기록 형식이 맞지 않아.');
    for (const [key, date] of Object.entries(value.posted)) {
      if (!allowedPairs.has(key) || typeof date !== 'string' || date.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(date) || !Number.isFinite(Date.parse(date))) throw new Error('게시 기록의 기획·언어·날짜를 확인해 줘.');
      result.posted[key] = date;
    }
    if (value.backgrounds !== undefined) {
      if (!plain(value.backgrounds) || Object.keys(value.backgrounds).length > allowedPairs.size) throw new Error('사진 설정 목록이 맞지 않아.');
      for (const [key, slots] of Object.entries(value.backgrounds)) {
        const [id, locale] = key.split(':');
        const source = [...catalog.campaigns, ...result.campaigns].find(item => item.id === id);
        if (!allowedPairs.has(key) || !Array.isArray(slots) || slots.length !== source.locales[locale].slides.length) throw new Error('사진 설정의 기획·언어·페이지 수를 확인해 줘.');
        result.backgrounds[key] = slots.map(slot => slot === null ? null : window.SajuBackgrounds.readSetting(slot));
      }
    }
    if (value.assets !== undefined) window.SajuBackgrounds.readAssets(value.assets);
    return result;
  }

  function campaigns() { return [...catalog.campaigns, ...state.campaigns]; }
  function selectedCampaign() { return campaigns().find(item => item.id === state.settings.campaignId); }
  function pairKey(id = state.settings.campaignId, locale = state.settings.locale) { return `${id}:${locale}`; }
  function topicOf(campaign) { return state.edits[pairKey(campaign.id)]?.topic ?? (own(state.topics, campaign.id) ? state.topics[campaign.id] : (campaign.locales[state.settings.locale].topic || campaign.topic)); }
  function slideCount() { return selectedCampaign().locales[state.settings.locale].slides.length; }
  function renderOptions() { return { ...state.settings, slideCount: slideCount(), artwork: state.settings.artwork === 'auto' ? (localeContent().artwork || selectedCampaign().artwork) : state.settings.artwork }; }

  function localeContent(campaign = selectedCampaign(), locale = state.settings.locale) {
    const base = campaign.locales[locale];
    const edit = state.edits[pairKey(campaign.id, locale)];
    if (!edit) return clone(base);
    return { ...clone(base), label: edit.label, caption: edit.caption, hashtags: [...edit.hashtags], topic: edit.topic ?? base.topic, imageBrief: edit.imageBrief === undefined ? (base.imageBrief || '') : edit.imageBrief, slides: base.slides.map((slide, index) => ({ ...slide, ...edit.slides[index] })) };
  }

  function ensureEdit() {
    const key = pairKey();
    if (!own(state.edits, key)) {
      const source = localeContent();
      state.edits[key] = { topic: topicOf(selectedCampaign()), imageBrief: source.imageBrief || '', label: source.label, caption: source.caption, hashtags: [...source.hashtags], hashtagText: source.hashtags.join(' '), slides: source.slides.map(({ eyebrow, title, body, note }) => ({ eyebrow, title, body, note })) };
    }
    return state.edits[key];
  }

  function envelope() { return { ...state, savedAt: new Date().toISOString() }; }

  function saveNow() {
    clearTimeout(saveTimer);
    if (!dirty) return true;
    try {
      if (localStorage.getItem(STORE_KEY) !== lastSavedRaw) {
        storageConflict = true;
        message('다른 탭에 최신 작업이 있어. 현재 원고는 JSON 백업을 받은 뒤 새로고침해 줘. 최신 저장본은 덮어쓰지 않았어.', true);
        return false;
      }
      const json = JSON.stringify(envelope());
      if (byteLength(json) > MAX_BACKUP_BYTES) throw new Error('저장 용량 한도');
      localStorage.setItem(STORE_KEY, json);
      lastSavedRaw = json; dirty = false; storageConflict = false;
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
    dirty = true;
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
    const allItems = campaigns();
    const items = allItems.filter(matchesFilter);
    $('search-empty').hidden = items.length > 0;
    $('campaign-count').textContent = `${items.length} / ${allItems.filter(inCollection).length}`;
    $('duplicate-campaign').disabled = busy || allItems.length >= MAX_CAMPAIGNS;
    const fragment = document.createDocumentFragment();
    items.forEach((campaign, index) => {
      const button = element('button', 'campaign-card');
      button.type = 'button';
      button.dataset.campaign = campaign.id;
      button.setAttribute('aria-pressed', String(campaign.id === state.settings.campaignId));
      button.append(element('span', 'campaign-number', `${String(index + 1).padStart(2, '0')} · ${topicOf(campaign) || '이름 없는 주제'}`));
      button.append(element('span', 'campaign-title', localeContent(campaign).label || '이름 없는 기획'));
      const posted = own(state.posted, pairKey(campaign.id));
      button.append(element('span', `campaign-meta${posted ? ' is-posted' : ''}`, `${state.settings.locale.toUpperCase()} · ${posted ? '게시 완료 ✓' : `${campaign.locales[state.settings.locale].slides.length}장`}${state.campaigns.some(item => item.id === campaign.id) ? ' · 내 기획' : ''}`));
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
    $('artwork').value = state.settings.artwork;
    $('category-filter').value = categoryFilter;
    $('collection-filter').value = collectionFilter;
    $('export-zip').textContent = `${slideCount()}장 ZIP ↓`;
    $('export-hint').textContent = `PNG ${slideCount()}장 + 캡션`;
    $('sequence-label').textContent = slideCount() === 3 ? ['01 제목과 이미지', '02 사주로 읽기', '03 사주핑계 소개'][state.settings.slideIndex] : '이전 5장 기획';
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < slideCount(); index++) {
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
    $('next-slide').disabled = state.settings.slideIndex === slideCount() - 1;
  }

  function renderEditor() {
    const content = localeContent();
    const slide = content.slides[state.settings.slideIndex];
    $('slide-label').textContent = `${String(state.settings.slideIndex + 1).padStart(2, '0')} / ${String(slideCount()).padStart(2, '0')}`;
    $('content-label').textContent = `${state.settings.locale.toUpperCase()} · ${slide.eyebrow}`;
    $('edit-topic').value = topicOf(selectedCampaign());
    $('edit-label').value = content.label;
    for (const field of ['eyebrow', 'title', 'body', 'note']) $('edit-' + field).value = slide[field];
    $('edit-caption').value = content.caption;
    $('edit-image-brief').value = content.imageBrief || '';
    window.SajuVisuals?.setContext({ campaignId: state.settings.campaignId, referenceCampaignId: content.visualSourceId, locale: state.settings.locale, slideIndex: state.settings.slideIndex, label: content.label, labels: Object.fromEntries(LOCALES.map(locale => [locale, localeContent(selectedCampaign(), locale).label])), imageBrief: content.imageBrief || '' });
    renderRecommendations();
    renderBackgroundControls();
    $('edit-hashtags').value = state.edits[pairKey()] ? state.edits[pairKey()].hashtagText : content.hashtags.join(' ');
    $('edit-label').lang = state.settings.locale;
    $('edit-image-brief').lang = 'ko';
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
    state.settings.slideIndex = Math.max(0, Math.min(slideCount() - 1, index));
    renderSelections(); renderEditor(); requestPreview(); saveSoon();
  }

  function parseTags(value) {
    const tags = value.trim().split(/\s+/u).filter(Boolean).map(tag => '#' + tag.replace(/^[#＃]+/, ''));
    return [...new Set(tags.filter(tag => tag !== '#'))];
  }

  function commitEditor() {
    dirty = true;
    const edit = ensureEdit();
    edit.label = $('edit-label').value;
    edit.caption = $('edit-caption').value;
    edit.imageBrief = $('edit-image-brief').value;
    const tags = parseTags($('edit-hashtags').value);
    edit.hashtagText = $('edit-hashtags').value;
    if (tags.length <= MAX_TAGS && tags.every(tag => tag.length <= 80)) edit.hashtags = tags;
    edit.slides[state.settings.slideIndex] = { eyebrow: $('edit-eyebrow').value, title: $('edit-title').value, body: $('edit-body').value, note: $('edit-note').value };
    edit.topic = $('edit-topic').value;
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
      if (source.id.startsWith('draft-') || locales[locale].visualSourceId) locales[locale].visualSourceId ||= source.id;
      locales[locale].label = `${locales[locale].label.slice(0, 140)} · ${names[locale]}`;
    }
    state.campaigns.push({ id, topic: `${topicOf(source).slice(0, 90)} · 복제`, category: source.category, artwork: source.artwork, locales });
    for (const locale of LOCALES) {
      const edit = state.edits[pairKey(source.id, locale)];
      if (edit) state.edits[pairKey(id, locale)] = { ...clone(edit), label: locales[locale].label };
    }
    for (const locale of LOCALES) {
      const photos = state.backgrounds[pairKey(source.id, locale)];
      if (photos) state.backgrounds[pairKey(id, locale)] = clone(photos);
    }
    collectionFilter = 'all'; searchTerm = ''; $('campaign-search').value = '';
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
        const rows = region.id === 'design' ? [['format', '형식'], ['observed', '관찰'], ['apply', '적용']] : [['format', '형식'], ['observed', '관찰'], ['cta', '다음 행동'], ['apply', '적용']];
        for (const [key, label] of rows) {
          details.append(element('dt', '', label), element('dd', '', displayValue(item[key]) || '확인 기록 없음'));
        }
        card.append(details);
        card.append(element('p', 'verification', `확인 수준 · ${displayValue(item.verification) || '별도 확인 필요'}`));
        const links = element('div', 'reference-links');
        if (region.id === 'design') appendLink(links, '공식 화면 ↗', item.url);
        else {
          appendLink(links, '계정 원문 ↗', item.url);
          appendLink(links, '게시물 원문 ↗', item.postUrl);
        }
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

  function inCollection(campaign) {
    const draft = campaign.id.startsWith('draft-');
    return collectionFilter === 'all' || (collectionFilter === 'drafts' ? draft : !draft);
  }

  function matchesFilter(campaign) {
    const categoryMatches = categoryFilter === 'custom' ? state.campaigns.some(item => item.id === campaign.id) : categoryFilter === 'all' || campaign.category === categoryFilter;
    const source = localeContent(campaign);
    const searchable = [source.label, topicOf(campaign), source.caption, ...source.slides.flatMap(slide => [slide.eyebrow, slide.title, slide.body, slide.note])].join(' ').toLocaleLowerCase();
    return inCollection(campaign) && categoryMatches && (!searchTerm || searchable.includes(searchTerm));
  }

  function applyFilters() {
    const visible = campaigns().filter(matchesFilter);
    if (visible.length && !visible.some(item => item.id === state.settings.campaignId)) { state.settings.campaignId = visible[0].id; state.settings.slideIndex = 0; }
    renderAll(); saveSoon();
    $('search-empty').hidden = visible.length > 0;
  }

  function currentBackground() { return state.backgrounds[pairKey()]?.[state.settings.slideIndex] || null; }
  function setBackground(value) {
    dirty = true;
    if (!state.backgrounds[pairKey()]) state.backgrounds[pairKey()] = Array(slideCount()).fill(null);
    state.backgrounds[pairKey()][state.settings.slideIndex] = value;
    if (state.backgrounds[pairKey()].every(item => item === null)) delete state.backgrounds[pairKey()];
  }

  async function optionsWithBackground(options) {
    const config = state.backgrounds[pairKey(options.campaignId, options.locale)]?.[options.slideIndex];
    if (!config) return options;
    const asset = await window.SajuBackgrounds.image(config.assetId);
    return { ...options, customImage: asset.image, customImageName: asset.name, background: config };
  }

  function renderBackgroundControls() {
    const background = currentBackground();
    $('background-page').textContent = `${state.settings.slideIndex + 1}번째 장`;
    $('background-name').textContent = background ? '직접 올린 사진 · 이 장에 적용됨' : '기본 그림을 쓰고 있어.';
    $('background-controls').hidden = !background;
    for (const key of ['x', 'y', 'zoom', 'wash']) {
      const input = $('background-' + key);
      const value = background?.[key] ?? (key === 'zoom' ? 1 : key === 'wash' ? 0 : 50);
      input.value = String(value);
      $('background-' + key + '-value').textContent = key === 'zoom' ? Number(value).toFixed(2) + '×' : value + '%';
      input.disabled = busy || !background;
    }
    $('background-reset').disabled = busy || !background;
    $('background-all').disabled = busy || !background;
  }

  function currentTarget() { return { campaignId: state.settings.campaignId, locale: state.settings.locale, slideIndex: state.settings.slideIndex }; }
  function checkPhotoTarget(target = currentTarget()) {
    const item = campaigns().find(c => c.id === target.campaignId);
    if (!item || !LOCALES.includes(target.locale) || !Number.isInteger(target.slideIndex) || target.slideIndex < 0 || target.slideIndex >= item.locales[target.locale].slides.length) throw new Error('사진을 적용할 원고와 장을 다시 골라 줘.');
    if (busy) throw new Error('저장이 끝나면 사진을 골라 줘.');
    if (storageConflict || localStorage.getItem(STORE_KEY) !== lastSavedRaw) throw new Error('다른 탭의 저장본이 바뀌었어. 이 탭을 백업하고 새로고침해 줘.');
    return { ...target };
  }
  function selectPhotoTarget(target) {
    commitEditor();
    Object.assign(state.settings, target);
    collectionFilter = target.campaignId.startsWith('draft-') ? 'drafts' : 'all'; categoryFilter = 'all'; searchTerm = ''; $('campaign-search').value = '';
    if ($('photo-library-dialog').open) $('photo-library-dialog').close();
    renderAll(); showTab('studio');
  }
  function openUpload(target = currentTarget()) {
    try { pendingUploadTarget = checkPhotoTarget(target); $('background-file').value = ''; $('background-file').click(); }
    catch (error) { message(error.message, true); }
  }
  async function applyStoredPhoto(id, target = currentTarget()) {
    target = checkPhotoTarget(target);
    await window.SajuBackgrounds.get(id);
    // Recheck after asynchronous reads so an old tab never changes a newer workspace.
    checkPhotoTarget(target); selectPhotoTarget(target);
    setBackground({ assetId: id, x: 50, y: 50, zoom: 1, wash: target.slideIndex === 0 ? 0 : 85 });
    renderBackgroundControls(); requestPreview(); saveNow(); message('고른 사진을 이 장에 적용했어. 위치와 확대를 조절해 봐.');
  }
  async function applyReference(ref, target = currentTarget()) {
    target = checkPhotoTarget(target);
    selectPhotoTarget(target);
    setBusy(true, '라이브러리 사진을 적용하는 중…');
    try {
      await window.SajuVisuals.assetsReady;
      const cached = window.SajuVisuals.assetFor(ref.id);
      const name = `${ref.id}@${cached?.sha256?.slice(0, 10) || 'source'} · ${ref.title}`.slice(0, 180);
      let asset = (await window.SajuBackgrounds.list()).find(photo => photo.name === name);
      if (!asset) {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
        let blob;
        try {
          const response = await fetch(window.SajuVisuals.assetUrlFor(ref.id) || ref.imageUrl, { signal: controller.signal, credentials: 'omit' });
          if (!response.ok) throw new Error('사진을 가져오지 못했어.');
          blob = await response.blob();
        } catch (_) { const error = new Error('사진을 가져오지 못했어. 잠시 뒤 다시 시도하거나 저장한 사진을 올려 줘.'); error.code = 'REFERENCE_FETCH_FAILED'; throw error; }
        finally { clearTimeout(timer); }
        asset = await window.SajuBackgrounds.prepare(new File([blob], name, { type: cached?.type || blob.type }));
        await window.SajuBackgrounds.putAll([asset]);
      }
      setBackground({ assetId: asset.id, x: 50, y: 50, zoom: 1, wash: target.slideIndex === 0 ? 0 : 85 });
      saveNow(); message('라이브러리 사진을 적용했어. 내 사진 보관함에서도 다시 고를 수 있어.');
    } catch (error) { message(error.message, true); throw error; }
    finally { setBusy(false); renderBackgroundControls(); requestPreview(); }
  }
  function renderRecommendations() {
    if (!state) return;
    const content = localeContent(), refs = window.SajuVisuals?.entryFor(content.visualSourceId || state.settings.campaignId, state.settings.locale)?.references || [];
    const fragment = document.createDocumentFragment();
    for (const ref of refs.slice(0, 3)) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'recommended-photo'; button.setAttribute('aria-label', `${ref.title} 배경으로 쓰기`); button.title = ref.title;
      const image = document.createElement('img'); image.src = window.SajuVisuals?.assetUrlFor(ref.id) || ref.thumbnailUrl || ref.imageUrl; image.alt = ref.title; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer';
      button.append(image); button.addEventListener('click', () => applyReference(ref, currentTarget()).catch(() => {})); fragment.append(button);
    }
    $('recommended-photos').replaceChildren(fragment); $('recommended-photos').hidden = !refs.length;
  }
  async function renderPhotoLibrary() {
    const token = ++photoRenderToken, filtered = photoRows.filter(p => !photoSearch || p.name.toLocaleLowerCase().includes(photoSearch));
    photoPage = Math.max(0, Math.min(photoPage, Math.ceil(filtered.length / 12) - 1));
    $('photo-library-status').textContent = filtered.length ? `${filtered.length}개 사진 · 고르면 현재 장의 배경으로 적용돼.` : '아직 사진이 없어. 직접 올리거나 이미지 라이브러리에서 골라 봐.';
    $('photo-library-page').textContent = `${photoPage + 1} / ${Math.max(1, Math.ceil(filtered.length / 12))}`;
    $('photo-library-prev').disabled = photoPage === 0; $('photo-library-next').disabled = (photoPage + 1) * 12 >= filtered.length;
    const fragment = document.createDocumentFragment();
    for (const photo of filtered.slice(photoPage * 12, photoPage * 12 + 12)) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'saved-photo'; button.setAttribute('aria-label', `${photo.name} 사진 쓰기`);
      const image = document.createElement('img'); image.alt = photo.name; image.loading = 'lazy'; const title = document.createElement('span'); title.textContent = photo.name;
      button.append(image, title); button.addEventListener('click', () => applyStoredPhoto(photo.id).catch(error => { $('photo-library-status').textContent = error.message; })); fragment.append(button);
      window.SajuBackgrounds.get(photo.id).then(asset => { if (token === photoRenderToken) image.src = asset.dataUrl; }).catch(() => { if (token === photoRenderToken) title.textContent += ' · 다시 올려 줘'; });
    }
    $('photo-library-grid').replaceChildren(fragment);
  }
  async function openPhotoLibrary() {
    if (busy) return;
    $('photo-library-target').textContent = `${localeContent().label} · ${state.settings.locale.toUpperCase()} · ${state.settings.slideIndex + 1}번째 장`;
    $('photo-library-status').textContent = '사진을 불러오는 중…'; $('photo-library-grid').replaceChildren();
    $('photo-library-dialog').showModal(); $('photo-library-close').focus();
    try { photoRows = (await window.SajuBackgrounds.list()).sort((a, b) => a.name.localeCompare(b.name)); photoPage = 0; await renderPhotoLibrary(); }
    catch (error) { $('photo-library-status').textContent = error.message; }
  }
  function openFullEditor() {
    if (busy) return;
    commitEditor(); saveNow(); const content = localeContent(); fullOpener = document.activeElement;
    $('full-context').textContent = `${state.settings.locale.toUpperCase()} · ${content.label} · ${content.slides.length}장`;
    const fragment = document.createDocumentFragment();
    const field = (container, key, value, label, max, index) => {
      const id = `full-${index ?? 'post'}-${key}`, l = document.createElement('label'); l.htmlFor = id; l.textContent = label;
      const input = document.createElement('textarea'); input.id = id; input.value = value; input.maxLength = max; input.rows = key === 'body' || key === 'caption' ? 5 : 2; input.lang = state.settings.locale; input.dataset.fullField = key; if (index !== undefined) input.dataset.slide = String(index); container.append(l, input);
    };
    const meta = document.createElement('section'); meta.className = 'full-post-fields';
    field(meta, 'topic', topicOf(selectedCampaign()), '주제', LIMITS.topic); field(meta, 'label', content.label, '기획 이름', LIMITS.label); fragment.append(meta);
    content.slides.forEach((slide, index) => {
      const section = document.createElement('section'); section.className = 'full-slide-fields'; const h = document.createElement('h3'); h.textContent = `${index + 1}번째 장 · ${index === 0 ? '제목과 이미지' : index === content.slides.length - 1 ? '앱 소개' : '사주 해설'}`; section.append(h);
      for (const [key, label] of [['eyebrow', '작은 제목'], ['title', '제목'], ['body', '본문'], ['note', '덧말']]) field(section, key, slide[key], label, LIMITS[key], index); fragment.append(section);
    });
    const caption = document.createElement('section'); caption.className = 'full-post-fields';
    field(caption, 'caption', content.caption, '인스타 캡션', LIMITS.caption); field(caption, 'hashtags', state.edits[pairKey()]?.hashtagText ?? content.hashtags.join(' '), '해시태그 · 최대 5개', 2400); field(caption, 'imageBrief', content.imageBrief || '', '재작화 메모', 1200); fragment.append(caption);
    $('full-editor-fields').replaceChildren(fragment); $('full-status').textContent = $('save-status').textContent; $('full-editor-dialog').showModal(); $('full-close').focus();
  }
  function editFullManuscript(event) {
    const input = event.target.closest('[data-full-field]'); if (!input) return;
    const edit = ensureEdit(), field = input.dataset.fullField;
    if (input.dataset.slide !== undefined) edit.slides[Number(input.dataset.slide)][field] = input.value;
    else if (field === 'hashtags') { edit.hashtagText = input.value; const tags = parseTags(input.value); if (tags.length <= MAX_TAGS && tags.every(t => t.length <= 80)) edit.hashtags = tags; }
    else edit[field] = input.value;
    renderEditor(); renderCampaigns(); requestPreview(); saveSoon();
  }

  async function uploadBackground(file, target = currentTarget()) {
    if (!file || busy) return;
    try {
      target = checkPhotoTarget(target); selectPhotoTarget(target);
      setBusy(true, '사진을 다듬어 이 브라우저에 저장하는 중…');
      const asset = await window.SajuBackgrounds.prepare(file);
      await window.SajuBackgrounds.putAll([asset]);
      setBackground({ assetId: asset.id, x: 50, y: 50, zoom: 1, wash: state.settings.slideIndex === 0 ? 0 : 85 });
      saveNow(); message('사진을 바꿨어. 위치와 확대를 조절해 봐. 사진은 서버에 업로드되지 않아.');
    } catch (error) { message(error.message, true); }
    finally { setBusy(false); renderBackgroundControls(); requestPreview(); $('background-file').value = ''; }
  }

  function bindBackgroundEvents() {
    $('quick-background-upload').addEventListener('click', () => openPhotoLibrary());
    $('background-upload').addEventListener('click', () => openUpload());
    $('background-file').addEventListener('change', () => { const target = pendingUploadTarget || currentTarget(); pendingUploadTarget = null; uploadBackground($('background-file').files[0], target); });
    $('open-photo-library').addEventListener('click', openPhotoLibrary);
    $('photo-library-close').addEventListener('click', () => $('photo-library-dialog').close());
    $('photo-library-dialog').addEventListener('close', () => { ++photoRenderToken; $('photo-library-grid').replaceChildren(); $('open-photo-library').focus({ preventScroll: true }); });
    $('photo-library-search').addEventListener('input', () => { photoSearch = $('photo-library-search').value.trim().toLocaleLowerCase(); photoPage = 0; renderPhotoLibrary(); });
    $('photo-library-prev').addEventListener('click', () => { --photoPage; renderPhotoLibrary(); }); $('photo-library-next').addEventListener('click', () => { ++photoPage; renderPhotoLibrary(); });
    $('photo-library-upload').addEventListener('click', () => { $('photo-library-dialog').close(); openUpload(); });
    $('photo-library-web').addEventListener('click', () => { $('photo-library-dialog').close(); window.SajuVisuals?.showLibrary(); showTab('visuals'); });
    for (const key of ['x', 'y', 'zoom', 'wash']) $('background-' + key).addEventListener('input', () => {
      const background = currentBackground(); if (!background) return;
      background[key] = Number($('background-' + key).value); renderBackgroundControls(); requestPreview(); saveSoon();
    });
    $('background-reset').addEventListener('click', () => { setBackground(null); renderBackgroundControls(); requestPreview(); saveSoon(); });
    $('background-all').addEventListener('click', () => {
      const source = currentBackground(); if (!source) return;
      dirty = true;
      state.backgrounds[pairKey()] = Array.from({ length: slideCount() }, (_, index) => ({ ...source, wash: index === state.settings.slideIndex ? source.wash : index === 0 ? 0 : Math.max(85, source.wash) }));
      renderBackgroundControls(); requestPreview(); saveNow(); message(`현재 언어의 ${slideCount()}장에 같은 사진을 적용했어. 구도는 장마다 따로 조절할 수 있어.`);
    });
  }

  async function exportDrafts() {
    if (busy || !draftCatalog) return;
    try {
      commitEditor(); saveNow();
      setBusy(true, '편집한 원고와 이미지 레퍼런스를 묶는 중…');
      await window.SajuVisuals?.ready;
      const encoder = new TextEncoder(), files = [];
      const editedCampaigns = campaigns().map(campaign => ({ ...clone(campaign), locales: Object.fromEntries(LOCALES.map(locale => [locale, localeContent(campaign, locale)])) }));
      const editedCatalog = { version: 3, brand: catalog.brand, campaigns: editedCampaigns };
      for (const locale of LOCALES) {
        const heading = { ko: '한국어 편집 원고', ja: '日本語の編集原稿', en: 'Edited English post drafts' }[locale];
        const sections = editedCampaigns.map((campaign, index) => {
          const content = campaign.locales[locale];
          const slides = content.slides.map((slide, page) => `### ${page + 1}. ${slide.title}\n\n${slide.eyebrow}\n\n${slide.body}\n\n${slide.note}`).join('\n\n');
          return `## ${String(index + 1).padStart(3, '0')}. ${content.label}\n\n그림 메모: ${content.imageBrief || ''}\n\n${slides}\n\n### Caption\n\n${captionText(content)}${window.SajuVisuals?.markdownFor(content.visualSourceId || campaign.id, locale) || ''}`;
        });
        files.push({ name: `${locale}-edited-drafts.md`, bytes: encoder.encode(`# ${heading}\n\n${editedCampaigns.length}개 기획 · 새 초안·이전 모음·내 기획의 현재 편집본\n\n${sections.join('\n\n---\n\n')}\n`) });
      }
      files.push({ name: 'all-edited-drafts.json', bytes: encoder.encode(JSON.stringify(editedCatalog, null, 2)) });
      const visualBundle = window.SajuVisuals?.bundle();
      if (visualBundle) files.push({ name: 'visual-references.json', bytes: encoder.encode(JSON.stringify(visualBundle, null, 2)) });
      downloadBlob(makeZip(files), 'sajupinggye-edited-content.zip');
      message(visualBundle ? '모든 모음과 내 기획의 편집본·캡션·이미지 메모를 내려받았어.' : '편집 원고를 내려받았어. 이미지 목록은 불러오지 못해 이번 ZIP에서 빠졌어.');
    } catch (error) { message(error.message, true); }
    finally { setBusy(false); requestPreview(); }
  }

  function copyRows(scope = 'all') {
    const selected = state.settings.campaignId;
    return campaigns().filter(campaign => scope === 'all' || (scope === 'drafts' ? campaign.id.startsWith('draft-') : campaign.id === selected)).flatMap(campaign => LOCALES.map(locale => {
      const content = localeContent(campaign, locale), edit = state.edits[pairKey(campaign.id, locale)];
      if (edit?.hashtagText !== undefined) {
        const draftTags = parseTags(edit.hashtagText);
        if (draftTags.length > MAX_TAGS || draftTags.some(tag => tag.length > 80)) throw new Error(`${campaign.id}/${locale}의 해시태그 초안을 먼저 5개·각 80자 이내로 정리해 줘. 입력한 초안은 그대로 보관했어.`);
      }
      return { id: campaign.id, locale,
        topic: edit?.topic ?? (own(state.topics, campaign.id) ? state.topics[campaign.id] : (content.topic || campaign.topic)),
        label: content.label, imageBrief: content.imageBrief || '', slides: content.slides.map(({ eyebrow, title, body, note }) => ({ eyebrow, title, body, note })),
        caption: content.caption, hashtags: edit?.hashtagText === undefined ? [...content.hashtags] : parseTags(edit.hashtagText) };
    }));
  }

  function copyStatus(value, error = false) {
    $('copy-exchange-status').textContent = value;
    $('copy-exchange-status').classList.toggle('error', error);
  }

  function setCopyWorking(value, label) {
    copyWorking = value;
    $('copy-exchange-dialog').setAttribute('aria-busy', String(value));
    $('copy-exchange-dialog').querySelectorAll('button, select, input').forEach(control => { if (control.id !== 'copy-exchange-close') control.disabled = value; });
    if (!value) {
      $('copy-import-apply').disabled = !copyPending?.plan.changes.length || storageConflict;
      $('copy-undo').disabled = !copyUndo;
      $('copy-undo-download').disabled = !copyUndo;
    }
    if (label) copyStatus(label);
  }

  function loadCopyTexts() {
    if (!copyTextsPromise) copyTextsPromise = Promise.all(['copy-editing-prompt.txt', 'copy-format-guide.txt'].map(async path => {
      const response = await fetch(path, { cache: 'no-cache' });
      if (!response.ok) throw new Error('편집 프롬프트를 불러오지 못했어. 잠시 뒤 다시 눌러 줘.');
      return response.text();
    })).catch(error => { copyTextsPromise = null; throw error; });
    return copyTextsPromise;
  }

  function updateCopyExportCount() {
    const count = copyRows($('copy-export-scope').value).length;
    $('copy-export-count').textContent = `${count.toLocaleString()}개 문구 · 언어별 전체 파일 + 20개씩 분할 파일 · 현재 편집한 글 포함`;
  }

  function openCopyExchange() {
    if (busy || copyWorking || !state) return;
    try {
      commitEditor();
      if (!saveNow() || storageConflict || localStorage.getItem(STORE_KEY) !== lastSavedRaw) throw new Error('현재 작업을 먼저 저장하거나 JSON 백업을 받은 뒤 새로고침해 줘.');
      copyPending = null; copyOpener = document.activeElement;
      $('copy-import-preview').hidden = true; $('copy-import-errors').hidden = true;
      $('copy-import-result').hidden = !copyUndo; $('copy-import-apply').textContent = '검토한 문구 적용';
      updateCopyExportCount(); setCopyWorking(false);
      copyStatus('원고와 프롬프트를 받은 뒤, 수정한 JSON을 가져와 줘.');
      $('copy-exchange-dialog').showModal();
      loadCopyTexts().then(([prompt]) => { $('copy-prompt-text').value = prompt; }).catch(error => copyStatus(error.message, true));
    } catch (error) { message(error.message, true); }
  }

  async function exportCopyKit() {
    if (copyWorking || busy) return;
    const generation = ++copyGeneration;
    try {
      if (dirty && !saveNow()) throw new Error('현재 작업을 먼저 저장해 줘.');
      if (storageConflict || localStorage.getItem(STORE_KEY) !== lastSavedRaw) throw new Error('다른 탭의 원고가 바뀌었어. JSON 백업 후 새로고침해 줘.');
      setCopyWorking(true, '현재 편집본을 GPT 작업 파일로 묶는 중…');
      const rows = copyRows($('copy-export-scope').value), [prompt, guide] = await loadCopyTexts();
      if (generation !== copyGeneration || !$('copy-exchange-dialog').open) return;
      const files = [], encoder = new TextEncoder();
      const add = (name, value) => files.push({ name, bytes: encoder.encode(typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n') });
      add('copy-editing-prompt.txt', prompt); add('copy-format-guide.txt', guide);
      for (const locale of LOCALES) {
        const localeRows = rows.filter(row => row.locale === locale);
        if (!localeRows.length) continue;
        add(`${locale}-all.json`, window.SajuCopyExchange.makeEnvelope(localeRows));
        const batches = Math.ceil(localeRows.length / 20);
        for (let offset = 0; offset < localeRows.length; offset += 20) add(`batches/${locale}/${locale}-${String(offset / 20 + 1).padStart(2, '0')}-of-${String(batches).padStart(2, '0')}.json`, window.SajuCopyExchange.makeEnvelope(localeRows.slice(offset, offset + 20)));
      }
      add('manifest.json', { description: '현재 편집 원고', exportedAt: new Date().toISOString(), counts: Object.fromEntries(LOCALES.map(locale => [locale, rows.filter(row => row.locale === locale).length])), note: '언어별 전체 JSON과 batches 중 한 쪽만 사용해. 이 파일은 업로드하지 않아.' });
      downloadBlob(makeZip(files), `sajupinggye-gpt-current-${new Date().toISOString().slice(0, 10)}.zip`);
      copyStatus(`${rows.length.toLocaleString()}개 현재 문구와 프롬프트를 ZIP으로 준비했어. 20개 파일 하나씩 GPT에 맡겨도 돼.`);
    } catch (error) { showCopyErrors(error); }
    finally { setCopyWorking(false); }
  }

  function showCopyErrors(error) {
    copyPending = null; $('copy-import-apply').disabled = true;
    const box = $('copy-import-errors'); box.replaceChildren(); box.hidden = false;
    box.append(element('p', '', '적용하지 않았어. 아래 항목을 고친 뒤 파일을 다시 골라 줘.'));
    const issues = error.issues || [{ message: error.message || '파일을 읽지 못했어.' }];
    const list = element('ul');
    for (const issue of issues.slice(0, 100)) list.append(element('li', '', `${issue.id ? `${issue.id} / ${(issue.locale || '').toUpperCase()} · ` : ''}${issue.field ? `${copyFieldLabel(issue.field)}: ` : ''}${issue.message}`));
    box.append(list);
    if (issues.length > 100) box.append(element('p', '', `총 ${issues.length.toLocaleString()}개 중 앞의 100개를 표시했어.`));
    copyStatus('현재 문구는 바뀌지 않았어.', true);
  }

  function copyFieldLabel(field) {
    const labels = { topic: '주제', label: '기획 이름', imageBrief: '그림 메모', caption: '캡션', hashtags: '해시태그', eyebrow: '작은 제목', title: '제목', body: '본문', note: '덧말', baseRevision: '수정 기준값', id: 'ID', locale: '언어' };
    const match = field.match(/^slides\[(\d+)\]\.(\w+)$/);
    return match ? `${Number(match[1]) + 1}장 ${labels[match[2]] || match[2]}` : (labels[field] || field);
  }

  function copyFieldValue(copy, field) {
    const match = field.match(/^slides\[(\d+)\]\.(\w+)$/);
    const value = match ? copy.slides[Number(match[1])][match[2]] : copy[field];
    return Array.isArray(value) ? value.join(' ') : value;
  }

  function stageCopyPreview(envelopes, mode = 'import') {
    if (dirty || storageConflict || localStorage.getItem(STORE_KEY) !== lastSavedRaw) throw new Error('미리보기 전에 저장본이 바뀌었어. 작업을 백업하고 새로고침해 줘.');
    const plan = window.SajuCopyExchange.plan(envelopes, copyRows());
    copyPending = { envelopes, plan, expectedRaw: lastSavedRaw, mode };
    $('copy-import-errors').hidden = true; $('copy-import-result').hidden = true;
    $('copy-import-preview').hidden = false;
    $('copy-preview-heading').textContent = mode === 'undo' ? '3. 되돌릴 문구 확인' : '3. 바뀔 문구 확인';
    const changedLocales = Object.fromEntries(LOCALES.map(locale => [locale, plan.changes.filter(row => row.locale === locale).length]));
    $('copy-import-summary').textContent = `${plan.total.toLocaleString()}개 확인 · ${plan.changes.length.toLocaleString()}개 변경 · ${plan.unchanged.toLocaleString()}개 동일\n변경: 한국어 ${changedLocales.ko} · 日本語 ${changedLocales.ja} · English ${changedLocales.en}`;
    const list = $('copy-import-changes'); list.replaceChildren();
    for (const change of plan.changes) {
      const detail = element('details', 'copy-change');
      detail.append(element('summary', '', `${change.locale.toUpperCase()} · ${change.id} · ${change.after.label} — ${change.fields.length}곳`));
      let filled = false;
      detail.addEventListener('toggle', () => {
        if (!detail.open || filled) return;
        filled = true;
        for (const field of change.fields) {
          const block = element('div', 'copy-change-field'); block.append(element('h4', '', copyFieldLabel(field)));
          const pair = element('div', 'copy-diff');
          for (const [label, copy] of [['현재 문구', change.before], ['바뀔 문구', change.after]]) {
            const column = element('div'); column.append(element('p', '', label), element('pre', '', copyFieldValue(copy, field))); pair.append(column);
          }
          block.append(pair); detail.append(block);
        }
      });
      list.append(detail);
    }
    $('copy-import-apply').textContent = mode === 'undo' ? '이전 문구로 되돌리기' : '검토한 문구 적용';
    $('copy-import-apply').disabled = !plan.changes.length;
    copyStatus(plan.changes.length ? '항목을 펼쳐 현재 문구와 수정본을 비교한 뒤 적용해 줘.' : '수정된 문구가 없어. 현재 원고와 같은 파일이야.');
  }

  async function importCopyFiles(files) {
    if (!files?.length || copyWorking || busy) return;
    const generation = ++copyGeneration;
    copyPending = null; $('copy-import-preview').hidden = true; $('copy-import-errors').hidden = true;
    try {
      if (files.length > 100 || Array.from(files).reduce((sum, file) => sum + file.size, 0) > window.SajuCopyExchange.MAX_BYTES) throw new Error('JSON 파일은 한 번에 100개, 합계 8MB까지 올릴 수 있어. 나눠 골라 줘.');
      setCopyWorking(true, 'JSON 문법·ID·글자 수와 변경 내용을 확인하는 중…');
      const envelopes = [];
      for (const file of files) {
        try { envelopes.push(window.SajuCopyExchange.parse((await file.text()).replace(/^\uFEFF/, ''))); }
        catch (error) { throw new Error(`${file.name}: ${error.message}`); }
      }
      if (generation !== copyGeneration || !$('copy-exchange-dialog').open) return;
      stageCopyPreview(envelopes);
    } catch (error) { if (generation === copyGeneration) showCopyErrors(error); }
    finally { $('copy-import-files').value = ''; setCopyWorking(false); }
  }

  // Write the complete validated candidate before replacing the live in-memory state.
  // This operation touches no image store and keeps design, crops and posted dates.
  function persistCopyPlan(plan, expectedRaw) {
    clearTimeout(saveTimer);
    if (dirty || storageConflict || lastSavedRaw !== expectedRaw || localStorage.getItem(STORE_KEY) !== expectedRaw) throw new Error('확인하는 동안 작업이 바뀌었어. 수정본을 다시 골라 비교해 줘.');
    const next = clone(state);
    for (const change of plan.changes) next.edits[pairKey(change.id, change.locale)] = { ...next.edits[pairKey(change.id, change.locale)], ...clone(change.after), hashtagText: change.after.hashtags.join(' ') };
    const candidate = readBackup(next), json = JSON.stringify({ ...candidate, savedAt: new Date().toISOString() });
    if (byteLength(json) > MAX_BACKUP_BYTES) throw new Error('적용 후 원고 저장본이 8MB를 넘어가. 원고를 나눠 관리해 줘.');
    if (localStorage.getItem(STORE_KEY) !== expectedRaw) throw new Error('다른 탭의 저장본이 바뀌었어. 최신 원고를 다시 확인해 줘.');
    try { localStorage.setItem(STORE_KEY, json); }
    catch (_) { throw new Error('브라우저 저장 공간이 부족하거나 저장이 차단됐어. 기존 문구를 유지했어. JSON 백업을 받은 뒤 다시 시도해 줘.'); }
    state = candidate; lastSavedRaw = json; dirty = false; storageFailed = false; storageConflict = false;
    return json;
  }

  function applyCopyImport() {
    if (!copyPending || copyWorking || busy) return;
    try {
      const pending = copyPending;
      if (pending.expectedRaw !== lastSavedRaw || dirty || storageConflict) throw new Error('미리보기 이후 원고가 바뀌었어. 수정본을 다시 골라 줘.');
      const plan = window.SajuCopyExchange.plan(pending.envelopes, copyRows());
      if (!plan.changes.length) return;
      const rollback = { format: window.SajuCopyExchange.FORMAT, version: window.SajuCopyExchange.VERSION, posts: plan.changes.map(change => ({ id: change.id, locale: change.locale, baseRevision: window.SajuCopyExchange.revision(change.after), ...clone(change.before) })) };
      persistCopyPlan(plan, pending.expectedRaw);
      copyUndo = pending.mode === 'undo' ? null : rollback; copyPending = null;
      renderAll(); $('copy-import-preview').hidden = true; $('copy-import-errors').hidden = true;
      $('copy-import-result').hidden = !copyUndo;
      const result = pending.mode === 'undo' ? `${plan.changes.length}개 문구를 이전 내용으로 되돌렸어.` : `${plan.changes.length}개 문구를 이 브라우저에 저장했어. 사진·구도·게시 기록은 유지했어.`;
      $('copy-import-result-text').textContent = result; copyStatus(result); message(result);
      setCopyWorking(false);
    } catch (error) { showCopyErrors(error); }
  }

  function drawPoster(canvas, slide, options) {
    return window.SajuPoster.draw(canvas, slide, options, catalog.brand);
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
      await window.SajuPoster.ready;
      if (token !== previewToken || busy) return;
      const options = await optionsWithBackground(renderOptions());
      if (token !== previewToken || busy) return;
      const content = localeContent();
      if (options.customImageName) $('background-name').textContent = options.customImageName + ' · 이 장에 적용됨';
      const offscreen = document.createElement('canvas');
      const issues = drawPoster(offscreen, content.slides[options.slideIndex], options);
      if (token !== previewToken) return;
      const canvas = $('poster'); canvas.width = offscreen.width; canvas.height = offscreen.height;
      canvas.getContext('2d').drawImage(offscreen, 0, 0);
      canvas.setAttribute('aria-label', `${content.label}, ${options.slideIndex + 1}번째 슬라이드. ${content.slides[options.slideIndex].title}. ${content.slides[options.slideIndex].body}`);
      $('preview-message').textContent = issues.length ? issues.join(' ') : `${canvas.width} × ${canvas.height} · ${options.locale.toUpperCase()} · ${options.slideIndex + 1} / ${options.slideCount}`;
      $('preview-message').classList.toggle('error', issues.length > 0);
      previewOkay = issues.length === 0;
      $('export-png').disabled = !previewOkay;
    } catch (error) { if (token !== previewToken) return; $('preview-message').textContent = error.message; $('preview-message').classList.add('error'); }
  }

  function setBusy(value, label = '') {
    busy = value;
    $('workspace').setAttribute('aria-busy', String(value));
    document.querySelectorAll('#workspace button, #workspace input, #workspace select, #workspace textarea').forEach(control => { control.disabled = value; });
    document.querySelectorAll('.workspace-tabs button').forEach(button => { button.disabled = value; });
    if (!value) {
      $('previous-slide').disabled = state.settings.slideIndex === 0;
      $('next-slide').disabled = state.settings.slideIndex === slideCount() - 1;
      $('duplicate-campaign').disabled = campaigns().length >= MAX_CAMPAIGNS;
      $('export-png').disabled = !previewOkay;
      renderBackgroundControls();
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
      const options = renderOptions(), content = localeContent(), campaign = selectedCampaign();
      setBusy(true, allSlides ? `현재 언어의 ${options.slideCount}장을 만드는 중…` : 'PNG 이미지를 만드는 중…');
      await window.SajuPoster.ready;
      const indexes = allSlides ? content.slides.map((_, index) => index) : [options.slideIndex];
      const rendered = [];
      // Validate every requested slide before downloading anything.
      for (const index of indexes) {
        const canvas = document.createElement('canvas');
        const issues = drawPoster(canvas, content.slides[index], await optionsWithBackground({ ...options, slideIndex: index }));
        if (issues.length) throw new Error(`${index + 1}번째 장: ${issues.join(' ')}`);
        rendered.push({ canvas, index });
      }
      const basename = `sajupinggye-${campaign.id}-${options.locale}-${options.format}-${options.template}`;
      if (!allSlides) {
        downloadBlob(await canvasPng(rendered[0].canvas), `${basename}-${String(options.slideIndex + 1).padStart(2, '0')}.png`);
      } else {
        const files = [];
        for (const { canvas, index } of rendered) {
          message(`${index + 1} / ${options.slideCount}장 PNG를 묶는 중…`);
          const blob = await canvasPng(canvas);
          files.push({ name: `${String(index + 1).padStart(2, '0')}.png`, bytes: new Uint8Array(await blob.arrayBuffer()) });
        }
        const encoder = new TextEncoder();
        await window.SajuVisuals?.ready;
        files.push({ name: 'caption.txt', bytes: encoder.encode(captionText(content) + '\n') });
        const metadata = { app: APP_ID, version: 3, visualReferences: window.SajuVisuals?.entryFor(content.visualSourceId || campaign.id, options.locale) || null, imageBrief: content.imageBrief || '', backgrounds: state.backgrounds[pairKey()] || [], exportedAt: new Date().toISOString(), brand: catalog.brand, campaignId: campaign.id, topic: topicOf(campaign), category: campaign.category, slideCount: options.slideCount, artwork: options.artwork, locale: options.locale, template: options.template, format: options.format, mediaType: 'image/png', width: 1080, height: options.format === 'story' ? 1920 : 1350, label: content.label, caption: content.caption, hashtags: content.hashtags, slides: content.slides.map((slide, index) => ({ file: `${String(index + 1).padStart(2, '0')}.png`, ...slide })) };
        files.push({ name: 'metadata.json', bytes: encoder.encode(JSON.stringify(metadata, null, 2) + '\n') });
        downloadBlob(makeZip(files), `${basename}.zip`);
      }
      message(allSlides ? `현재 언어의 PNG ${options.slideCount}장과 캡션을 ZIP으로 저장했어.` : '현재 장을 PNG로 저장했어.');
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

  async function exportBackup() {
    if (busy) return;
    try {
      commitEditor(); setBusy(true, '사진과 문구를 백업하는 중…');
      const value = { ...envelope(), exportedAt: new Date().toISOString(), assets: await window.SajuBackgrounds.collectAll(MAX_IMAGE_BACKUP_BYTES) };
      readBackup(value);
      const json = JSON.stringify(value, null, 2);
      if (byteLength(json) > MAX_IMAGE_BACKUP_BYTES) throw new Error('사진 포함 백업이 64MB를 넘어가. 필요한 기획을 나눠 보관해 줘.');
      downloadBlob(new Blob([json], { type: 'application/json;charset=utf-8' }), `sajupinggye-studio-${new Date().toISOString().slice(0, 10)}.json`);
      saveNow(); message('사진·구도·문구·게시 기록을 함께 백업했어. 다른 기기에서도 불러올 수 있어.');
    } catch (error) { message(error.message, true); }
    finally { setBusy(false); requestPreview(); }
  }

  async function importBackup(file) {
    if (!file || busy) return;
    try {
      if (file.size > MAX_IMAGE_BACKUP_BYTES) throw new Error('사진 포함 백업은 64MB까지 불러올 수 있어.');
      setBusy(true, '백업과 사진을 확인하는 중…');
      const raw = await file.text();
      let parsed;
      try { parsed = JSON.parse(raw); } catch (_) { throw new Error('JSON을 읽지 못했어. 작업실 JSON 백업을 골라 줘.'); }
      const restored = readBackup(parsed);
      if (byteLength(JSON.stringify(restored)) > MAX_BACKUP_BYTES) throw new Error('문구 저장본은 8MB 이내로 맞춰 줘.');
      if (localStorage.getItem(STORE_KEY) !== lastSavedRaw) throw new Error('다른 탭의 저장본이 바뀌었어. 새로고침한 뒤 백업을 불러와 줘.');
      await window.SajuBackgrounds.restore(parsed.assets || [], restored.backgrounds);
      if (localStorage.getItem(STORE_KEY) !== lastSavedRaw) throw new Error('다른 탭의 저장본이 바뀌었어. 새로고침한 뒤 백업을 불러와 줘.');
      state = restored; dirty = true; categoryFilter = 'all'; collectionFilter = 'all'; searchTerm = ''; $('campaign-search').value = '';
      setBusy(false); renderAll();
      if (saveNow()) message(`사진과 기획 ${campaigns().length}개, 언어별 게시 기록을 복원했어.`);
    } catch (error) { message(`백업을 불러오지 않았어. ${error.message}`, true); }
    finally { setBusy(false); $('backup-file').value = ''; }
  }

  async function prunePhotos() {
    if (busy) return;
    try {
      commitEditor();
      if (!saveNow()) return;
      if (!window.confirm('다른 작업실 탭을 닫고 진행해 줘. 현재 원고에서 쓰지 않는 사진을 이 브라우저에서 삭제할까? 필요한 작업은 먼저 사진 포함 JSON 백업으로 보관해 둬. 원본 사진 파일은 바뀌지 않아.')) return;
      if (localStorage.getItem(STORE_KEY) !== lastSavedRaw) throw new Error('다른 탭의 저장본이 바뀌었어. 새로고침한 뒤 다시 정리해 줘.');
      setBusy(true, '쓰지 않는 사진을 정리하는 중…');
      const count = await window.SajuBackgrounds.prune(window.SajuBackgrounds.requiredIds(state.backgrounds));
      message(`현재 원고의 사진은 남기고, 쓰지 않는 사진 ${count}개를 정리했어.`);
    } catch (error) { message(error.message, true); }
    finally { setBusy(false); requestPreview(); }
  }

  function showTab(name) {
    for (const tabName of TABS) {
      const active = tabName === name, tab = $('tab-' + tabName);
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      $(tabName + '-panel').hidden = !active;
    }
    history.replaceState(null, '', name === 'studio' ? location.pathname + location.search : '#' + name);
  }

  function bindEvents() {
    document.querySelectorAll('.workspace-tabs button').forEach(button => {
      button.addEventListener('click', () => showTab(button.id.replace('tab-', '')));
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const index = TABS.indexOf(button.id.replace('tab-', '')); const name = event.key === 'Home' ? TABS[0] : event.key === 'End' ? TABS.at(-1) : TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
        showTab(name); $('tab-' + name).focus();
      });
    });
    document.querySelectorAll('[data-locale]').forEach(button => button.addEventListener('click', () => { state.settings.locale = button.dataset.locale; renderAll(); saveSoon(); }));
    document.querySelectorAll('[data-template]').forEach(button => button.addEventListener('click', () => { state.settings.template = button.dataset.template; renderSelections(); requestPreview(); saveSoon(); }));
    $('campaign-list').addEventListener('click', event => { const button = event.target.closest('[data-campaign]'); if (!button) return; state.settings.campaignId = button.dataset.campaign; state.settings.slideIndex = 0; renderAll(); saveSoon(); });
    $('category-filter').addEventListener('change', () => { categoryFilter = $('category-filter').value; if (categoryFilter === 'custom') collectionFilter = 'all'; applyFilters(); });
    $('collection-filter').addEventListener('change', () => { collectionFilter = $('collection-filter').value; categoryFilter = 'all'; applyFilters(); });
    $('campaign-search').addEventListener('input', () => { searchTerm = $('campaign-search').value.trim().toLocaleLowerCase(); applyFilters(); });
    bindBackgroundEvents();
    $('open-full-editor').addEventListener('click', openFullEditor);
    $('quick-full-editor').addEventListener('click', openFullEditor);
    $('full-editor-fields').addEventListener('input', editFullManuscript);
    for (const id of ['full-close', 'full-done']) $(id).addEventListener('click', () => $('full-editor-dialog').close());
    $('full-editor-dialog').addEventListener('close', () => { saveNow(); (fullOpener?.isConnected ? fullOpener : $('open-full-editor')).focus({ preventScroll: true }); });
    $('open-visuals').addEventListener('click', () => { window.SajuVisuals?.showCurrent(); showTab('visuals'); $('tab-visuals').focus(); });
    $('export-drafts').addEventListener('click', exportDrafts);
    $('open-copy-exchange').addEventListener('click', openCopyExchange);
    $('copy-export-scope').addEventListener('change', () => { try { updateCopyExportCount(); } catch (error) { showCopyErrors(error); } });
    $('copy-export-kit').addEventListener('click', exportCopyKit);
    $('copy-prompt-download').addEventListener('click', async () => {
      try { const [prompt] = await loadCopyTexts(); downloadBlob(new Blob([prompt], { type: 'text/plain;charset=utf-8' }), 'sajupinggye-GPT-PRO-PROMPT.txt'); }
      catch (error) { copyStatus(error.message, true); }
    });
    $('copy-exchange-close').addEventListener('click', () => $('copy-exchange-dialog').close());
    $('copy-exchange-dialog').addEventListener('close', () => { ++copyGeneration; copyPending = null; (copyOpener?.isConnected ? copyOpener : $('open-copy-exchange')).focus({ preventScroll: true }); });
    $('copy-import-open').addEventListener('click', () => { if (!copyWorking) $('copy-import-files').click(); });
    $('copy-import-files').addEventListener('change', () => importCopyFiles(Array.from($('copy-import-files').files)));
    $('copy-import-apply').addEventListener('click', applyCopyImport);
    $('copy-undo').addEventListener('click', () => { if (!copyUndo || copyWorking) return; try { stageCopyPreview([copyUndo], 'undo'); } catch (error) { showCopyErrors(error); } });
    $('copy-undo-download').addEventListener('click', () => { if (copyUndo) downloadBlob(new Blob([JSON.stringify(copyUndo, null, 2) + '\n'], { type: 'application/json;charset=utf-8' }), `sajupinggye-copy-undo-${new Date().toISOString().slice(0, 10)}.json`); });
    $('prune-photos').addEventListener('click', prunePhotos);
    $('artwork').addEventListener('change', () => { state.settings.artwork = $('artwork').value; requestPreview(); saveSoon(); });
    $('format').addEventListener('change', () => { state.settings.format = $('format').value; requestPreview(); saveSoon(); });
    $('slide-buttons').addEventListener('click', event => { const button = event.target.closest('[data-slide]'); if (button) selectSlide(Number(button.dataset.slide)); });
    $('previous-slide').addEventListener('click', () => selectSlide(state.settings.slideIndex - 1));
    $('next-slide').addEventListener('click', () => selectSlide(state.settings.slideIndex + 1));
    document.querySelector('.slide-navigation').addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); selectSlide(state.settings.slideIndex + (event.key === 'ArrowRight' ? 1 : -1)); $('slide-buttons').querySelector('[aria-current="true"]').focus(); });
    for (const field of ['topic', 'label', 'eyebrow', 'title', 'body', 'note', 'caption', 'hashtags', 'image-brief']) {
      $('edit-' + field).addEventListener('input', () => {
        commitEditor(); updateCounts();
        if (field === 'topic' || field === 'label') renderCampaigns();
        if (['eyebrow', 'title', 'body', 'note'].includes(field)) requestPreview();
        saveSoon();
      });
    }
    $('reset-slide').addEventListener('click', () => { const index = state.settings.slideIndex, slide = selectedCampaign().locales[state.settings.locale].slides[index]; ensureEdit().slides[index] = { eyebrow: slide.eyebrow, title: slide.title, body: slide.body, note: slide.note }; renderEditor(); requestPreview(); saveSoon(); });
    $('posted-check').addEventListener('change', () => { if ($('posted-check').checked) state.posted[pairKey()] = new Date().toISOString(); else delete state.posted[pairKey()]; renderCampaigns(); renderEditor(); saveSoon(); });
    $('duplicate-campaign').addEventListener('click', duplicateCampaign);
    $('export-png').addEventListener('click', () => exportImages(false));
    $('export-zip').addEventListener('click', () => exportImages(true));
    $('copy-caption').addEventListener('click', copyCaption);
    $('export-backup').addEventListener('click', exportBackup);
    $('import-backup').addEventListener('click', () => $('backup-file').click());
    $('backup-file').addEventListener('change', () => importBackup($('backup-file').files[0]));
    window.addEventListener('hashchange', () => showTab(TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'studio'));
    window.addEventListener('pagehide', () => { if (state && dirty && !storageConflict) saveNow(); });
    window.addEventListener('storage', event => {
      if (event.key !== STORE_KEY || !state || event.newValue === lastSavedRaw) return;
      clearTimeout(saveTimer);
      if (dirty || busy || $('full-editor-dialog').open || $('photo-library-dialog').open || $('copy-exchange-dialog').open || !event.newValue) {
        storageConflict = true;
        if ($('copy-exchange-dialog').open) {
          copyPending = null; $('copy-import-apply').disabled = true;
          copyStatus('다른 탭의 원고가 바뀌었어. 현재 작업을 JSON 백업한 뒤 새로고침해 줘.', true);
        }
        message('다른 탭에서 작업이 바뀌었어. 이 탭의 원고는 JSON 백업을 받은 뒤 새로고침해 줘. 최신 저장본은 덮어쓰지 않을게.', true);
        return;
      }
      try {
        const latest = readBackup(JSON.parse(event.newValue));
        state = latest; lastSavedRaw = event.newValue; storageConflict = false;
        categoryFilter = 'all'; collectionFilter = 'all'; searchTerm = ''; $('campaign-search').value = '';
        renderAll(); message('다른 탭의 최신 원고·사진·게시 기록을 이어받았어.');
      } catch (_) { storageConflict = true; message('다른 탭의 저장 상태가 바뀌었어. 현재 작업을 백업한 뒤 새로고침해 줘.', true); }
    });
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
      const [drafts, current, legacy] = await Promise.all([fetchJson('campaigns-300.json'), fetchJson('campaigns-v2.json'), fetchJson('campaigns.json')]);
      draftCatalog = readCatalog(drafts);
      catalog = readCatalog({ ...current, campaigns: [...draftCatalog.campaigns, ...current.campaigns, ...legacy.campaigns] });
      state = initialState();
      window.SajuVisuals?.init({ campaigns: draftCatalog.campaigns, onApplyReference: applyReference, onUpload: openUpload, onEdit: (id, locale) => { if (busy) return; commitEditor(); state.settings.campaignId = id; state.settings.locale = locale; state.settings.slideIndex = 0; collectionFilter = id.startsWith('draft-') ? 'drafts' : 'all'; categoryFilter = 'all'; searchTerm = ''; $('campaign-search').value = ''; renderAll(); saveSoon(); showTab('studio'); $('workspace').focus(); } });
      window.SajuVisuals?.ready.then(() => { if (state) renderRecommendations(); });
      let restored = false, warning = '';
      try {
        const currentRaw = localStorage.getItem(STORE_KEY);
        lastSavedRaw = currentRaw;
        const raw = currentRaw || localStorage.getItem(PREVIOUS_STORE_KEY) || localStorage.getItem(LEGACY_STORE_KEY);
        if (raw) {
          if (byteLength(raw) > MAX_BACKUP_BYTES) throw new Error('저장 기록이 8MB를 넘어가.');
          state = readBackup(JSON.parse(raw)); restored = true;
          if (!currentRaw) {
            state.settings.campaignId = catalog.campaigns[0].id; state.settings.slideIndex = 0;
            warning = '기존 원고와 게시 기록을 보관했어. 새 초안은 언어마다 100개씩 있어. 모음에서 이전 기획도 볼 수 있어.';
            dirty = true; saveNow();
          }
        }
      } catch (_) { warning = '기존 저장 기록을 읽지 못했어. 원본 기획으로 열었어. 갖고 있는 JSON 백업을 불러올 수 있어.'; }
      if (!selectedCampaign().id.startsWith('draft-')) collectionFilter = 'all';
      $('loading').hidden = true; $('workspace').hidden = false;
      renderAll(); message(warning || (restored ? '이 브라우저의 문구와 게시 기록을 이어서 열었어.' : '원하는 주제와 언어를 고르면 시작할 수 있어.'), Boolean(warning) && !restored);
      if (TABS.includes(location.hash.slice(1))) showTab(location.hash.slice(1));
    } catch (error) { $('loading').hidden = true; $('load-error').hidden = false; $('load-error').textContent = `작업실을 열지 못했어. ${error.message} 페이지를 새로고침해 줘.`; message('원본 데이터를 확인해 줘.', true); }
    await references;
  }

  start();
})();
