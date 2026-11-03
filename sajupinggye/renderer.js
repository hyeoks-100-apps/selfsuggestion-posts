'use strict';

(() => {
  const WIDTH = 1080;
  const MARGIN = 80;
  const SERIF = '"Studio Serif",serif';
  const SANS = '"Studio Sans",sans-serif';
  const TEMPLATES = ['hanji', 'muk', 'inyeon'];
  const scriptUrl = document.currentScript?.src || document.baseURI;
  const art = Object.create(null);
  let loaded = false;
  let loadingError = '';

  const palettes = {
    hanji: { paper: '#f6ead6', ink: '#242c26', muted: '#5b6258', accent: '#9e412e' },
    muk: { paper: '#0a2236', ink: '#fff5e5', muted: '#d5e0e5', accent: '#f0cba3' },
    inyeon: { paper: '#faecd7', ink: '#302b27', muted: '#68594f', accent: '#a63328' }
  };
  const labels = {
    ko: { brand: '사주핑계', cta: '프로필 링크에서 무료 풀이' },
    ja: { brand: 'サジュピンゲ', cta: 'プロフィールから無料で読む' },
    en: { brand: 'SajuPinggye', cta: 'Read free via the profile link' }
  };

  function loadArt(name) {
    const url = new URL(`assets/${name}-art.png`, scriptUrl);
    if (url.origin !== window.location.origin) return Promise.reject(new Error('아트 이미지는 작업실과 같은 주소에서 불러와야 해.'));
    return new Promise((resolve, reject) => {
      const image = new Image();
      const timeout = setTimeout(() => reject(new Error(`${name} 아트 이미지 응답이 늦어. 새로고침해 줘.`)), 20000);
      image.onload = async () => {
        clearTimeout(timeout);
        try {
          if (!image.naturalWidth || !image.naturalHeight) throw new Error('빈 이미지');
          if (typeof image.decode === 'function') await image.decode();
          art[name] = image;
          resolve();
        } catch (_) { reject(new Error(`${name} 아트 이미지를 읽지 못했어.`)); }
      };
      image.onerror = () => { clearTimeout(timeout); reject(new Error(`${name} 아트 이미지를 불러오지 못했어. 새로고침해 줘.`)); };
      image.src = url.href;
    });
  }

  async function loadFonts() {
    if (!document.fonts?.load) throw new Error('이 브라우저에서는 작업실 글꼴을 준비하지 못해. 최신 브라우저로 열어 줘.');
    const sample = '사주핑계 마음 サジュピンゲ 気持ち Saju reading';
    await Promise.all([
      ['Studio Serif', 400], ['Studio Serif', 600], ['Studio Sans', 400], ['Studio Sans', 600]
    ].map(async ([family, weight]) => {
      let faces;
      try { faces = await document.fonts.load(`${weight} 48px "${family}"`, sample); }
      catch (_) { throw new Error(`${family} 글꼴을 불러오지 못했어. 새로고침해 줘.`); }
      if (!faces.length) throw new Error(`${family} 글꼴이 없어. 작업실의 글꼴 파일을 확인해 줘.`);
    }));
    await document.fonts.ready;
  }

  const ready = Promise.all([loadFonts(), ...TEMPLATES.map(loadArt)]).then(() => { loaded = true; }).catch(error => {
    loadingError = error.message || '이미지와 글꼴을 불러오지 못했어.';
    throw error;
  });
  // Keep the rejection available to callers without an unhandled rejection before studio startup.
  ready.catch(() => {});

  function setFont(ctx, size, family, weight = 400) { ctx.font = `${weight} ${size}px ${family}`; }
  function graphemes(value, locale) {
    if (typeof Intl.Segmenter === 'function') return Array.from(new Intl.Segmenter(locale, { granularity: 'grapheme' }).segment(value), item => item.segment);
    return Array.from(value).reduce((parts, item) => {
      if (/\p{Mark}/u.test(item) && parts.length) parts[parts.length - 1] += item;
      else parts.push(item);
      return parts;
    }, []);
  }
  function words(value, locale) {
    if (typeof Intl.Segmenter === 'function') return Array.from(new Intl.Segmenter(locale, { granularity: 'word' }).segment(value), item => item.segment);
    return value.match(/\s+|[A-Za-z0-9À-ž]+(?:['’\-][A-Za-z0-9À-ž]+)*|[^\s]/gu) || [];
  }
  const closing = /^[、。，．？！!?：；）\]｝」』】〉》”’ぁぃぅぇぉゃゅょっァィゥェォャュョッヵヶー々]/u;
  const opening = /[（\[｛「『【〈《“‘]$/u;

  function balanceLastLine(ctx, lines, start, width, locale) {
    if (lines.length - start < 2) return;
    const last = lines.length - 1;
    for (let attempt = 0; attempt < 5; attempt++) {
      const before = lines[last - 1], after = lines[last];
      const a = ctx.measureText(before).width, b = ctx.measureText(after).width;
      if (b >= a * .68) break;
      const units = words(before, locale);
      let moved = units.pop() || '';
      while (units.length && (closing.test(moved) || /^\s+$/u.test(moved))) moved = units.pop() + moved;
      while (units.length && /^\s+$/u.test(units[units.length - 1])) units.pop();
      while (units.length && opening.test(units[units.length - 1])) moved = units.pop() + moved;
      const left = units.join('').trimEnd();
      const right = moved + (/^(ko|en)$/u.test(locale) ? ' ' : '') + after;
      if (!left || closing.test(right) || opening.test(left) || ctx.measureText(right).width > width) break;
      const nextA = ctx.measureText(left).width, nextB = ctx.measureText(right).width;
      if (Math.abs(nextA - nextB) >= Math.abs(a - b)) break;
      lines[last - 1] = left; lines[last] = right;
    }
  }

  function wrap(ctx, value, width, locale, balance = false) {
    const lines = [];
    for (const paragraph of value.replace(/\r\n?/g, '\n').split('\n')) {
      const start = lines.length;
      const queue = words(paragraph, locale).flatMap(unit => ctx.measureText(unit).width > width ? graphemes(unit, locale) : [unit]);
      let line = '';
      for (let index = 0; index < queue.length; index++) {
        const unit = queue[index];
        if (!line && /^\s+$/u.test(unit)) continue;
        if (ctx.measureText(line + unit).width <= width) { line += unit; continue; }
        if (/^\s+$/u.test(unit)) { lines.push(line.trimEnd()); line = ''; continue; }
        if (!line) { lines.push(unit); continue; }
        let letters = graphemes(line.trimEnd(), locale);
        let carry = '';
        if (closing.test(unit)) {
          const lastWord = locale === 'en' ? line.trimEnd().match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*$/u)?.[0] : '';
          if (lastWord) { carry = lastWord; letters = graphemes(line.trimEnd().slice(0, -lastWord.length).trimEnd(), locale); }
          else carry = letters.pop() || '';
        }
        while (letters.length && opening.test(letters[letters.length - 1])) carry = letters.pop() + carry;
        if (letters.length) {
          lines.push(letters.join(''));
          line = carry + unit;
        } else {
          // An unbreakable punctuation pair remains intact and is reported as too wide.
          lines.push(line.trimEnd() + unit);
          line = '';
        }
      }
      lines.push(line.trimEnd());
      if (balance) balanceLastLine(ctx, lines, start, width, locale);
    }
    return lines;
  }

  function fit(ctx, value, box, style, locale) {
    const { max, min, leading = 1.4, family = SANS, weight = 400, balance = false } = style;
    let block;
    for (let size = max; size >= min; size -= 2) {
      setFont(ctx, size, family, weight);
      const lines = value ? wrap(ctx, value, box.width, locale, balance) : [];
      const metrics = lines.map(line => ctx.measureText(line || 'あAg'));
      const ascent = Math.max(size * .8, ...metrics.map(item => item.actualBoundingBoxAscent || 0));
      const descent = Math.max(size * .18, ...metrics.map(item => item.actualBoundingBoxDescent || 0));
      const lineHeight = Math.max(size * leading, ascent + descent + size * .05);
      const height = lines.length ? ascent + descent + (lines.length - 1) * lineHeight : 0;
      const fits = height <= box.height + .1 && metrics.every(item => Math.max(item.width, (item.actualBoundingBoxLeft || 0) + (item.actualBoundingBoxRight || 0)) <= box.width + .1);
      block = { box, size, family, weight, lines, ascent, lineHeight, height, fits };
      if (fits) break;
    }
    return block;
  }

  function paint(ctx, block, color) {
    ctx.save();
    // Only invalid drafts can be clipped. Every clipped block also blocks export through issues.
    ctx.beginPath(); ctx.rect(block.box.x - 2, block.box.y - 2, block.box.width + 4, block.box.height + 4); ctx.clip();
    setFont(ctx, block.size, block.family, block.weight);
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillStyle = color;
    block.lines.forEach((line, index) => ctx.fillText(line, block.box.x, block.box.y + block.ascent + index * block.lineHeight));
    ctx.restore();
  }

  function textBlock(page, field, box, style, color = page.palette.ink, value = page.slide[field]) {
    const block = fit(page.ctx, value || '', box, { ...style, balance: field === 'title' }, page.locale);
    if (!block.fits) {
      const name = { title: '제목', body: '본문', note: '덧말', eyebrow: '작은 제목', brand: '브랜드 이름', footer: '하단 주소', cta: '안내 문구', app: '앱 안내' }[field] || field;
      page.issues.push(`${name}이 이미지 영역을 넘어가. 문장이나 줄바꿈을 줄여 줘.`);
    }
    paint(page.ctx, block, color);
    return block;
  }

  function imageCover(ctx, image, box, focusX = .5, focusY = .5) {
    const scale = Math.max(box.width / image.naturalWidth, box.height / image.naturalHeight);
    const sw = box.width / scale, sh = box.height / scale;
    const sx = (image.naturalWidth - sw) * focusX, sy = (image.naturalHeight - sh) * focusY;
    ctx.drawImage(image, sx, sy, sw, sh, box.x, box.y, box.width, box.height);
  }

  function fill(ctx, color, x, y, width, height) { ctx.fillStyle = color; ctx.fillRect(x, y, width, height); }
  function fade(ctx, color, transparent, x, y, width, height, horizontal = false) {
    const gradient = ctx.createLinearGradient(x, y, horizontal ? x + width : x, horizontal ? y : y + height);
    gradient.addColorStop(0, color); gradient.addColorStop(1, transparent);
    ctx.fillStyle = gradient; ctx.fillRect(x, y, width, height);
  }

  function masthead(page) {
    const name = page.locale === 'ko' ? page.brand.name : page.locale === 'ja' ? labels.ja.brand : page.brand.englishName;
    textBlock(page, 'brand', { x: MARGIN, y: 79, width: 540, height: 48 }, { max: 30, min: 26, leading: 1.2, weight: 600 }, page.palette.ink, name);
    const code = `${page.locale.toUpperCase()} / ${String(page.index + 1).padStart(2, '0')}`;
    setFont(page.ctx, 24, SANS, 400); page.ctx.fillStyle = page.palette.muted; page.ctx.textBaseline = 'alphabetic'; page.ctx.textAlign = 'right';
    page.ctx.fillText(code, WIDTH - MARGIN, 108); page.ctx.textAlign = 'left';
  }

  function footer(page) {
    const { ctx, H, palette } = page;
    fill(ctx, palette.paper, 0, H - 131, WIDTH, 131);
    ctx.strokeStyle = palette.muted; ctx.globalAlpha = .42; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(MARGIN, H - 130); ctx.lineTo(WIDTH - MARGIN, H - 130); ctx.stroke(); ctx.globalAlpha = 1;
    textBlock(page, 'footer', { x: MARGIN, y: H - 108, width: 690, height: 35 }, { max: 23, min: 22, leading: 1.2 }, palette.ink, page.host);
    setFont(ctx, 23, SANS, 600); ctx.fillStyle = palette.ink; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'right';
    ctx.fillText(`${String(page.index + 1).padStart(2, '0')} / 05`, WIDTH - MARGIN, H - 84); ctx.textAlign = 'left';
  }

  function eyebrow(page, y = 160, x = MARGIN, width = 920) {
    return textBlock(page, 'eyebrow', { x, y, width, height: 74 }, { max: 25, min: 22, leading: 1.35, weight: 600 }, page.palette.accent);
  }
  function note(page, y, width = 920, x = MARGIN, height = 72) {
    return textBlock(page, 'note', { x, y, width, height }, { max: 26, min: 22, leading: 1.4 }, page.palette.muted);
  }
  function title(page, y, height, width = 920, x = MARGIN, max = 104, min = 76, family = page.serif) {
    return textBlock(page, 'title', { x, y, width, height }, { max, min, leading: 1.16, weight: 600, family });
  }
  function body(page, y, height, width = 880, x = MARGIN, max = 44) {
    return textBlock(page, 'body', { x, y, width, height }, { max, min: 36, leading: 1.55 });
  }

  function cover(page) {
    const { ctx, H, template, palette } = page;
    const story = H === 1920;
    if (template === 'hanji') {
      // The illustration's own empty sky carries the headline; the river stays large below it.
      imageCover(ctx, art.hanji, { x: 0, y: 0, width: WIDTH, height: H }, .7, .5);
      const heading = title(page, story ? 256 : 212, 376, 920, MARGIN, 120, 100);
      const bodyY = Math.max(story ? 660 : 594, heading.box.y + heading.height + 34);
      // A quiet paper strip keeps the deck clear of the pine branches without covering the landscape.
      const deck = fit(ctx, page.slide.body, { x: MARGIN, y: bodyY, width: 880, height: 178 }, { max: 40, min: 36, leading: 1.55 }, page.locale);
      fill(ctx, palette.paper, 60, bodyY - 20, 920, Math.min(deck.height, 178) + 40);
      body(page, bodyY, 178, 880, MARGIN, 40);
      eyebrow(page, story ? 176 : 145);
      note(page, story ? 882 : 807, 760);
    } else if (template === 'muk') {
      const side = story ? 1240 : 1120;
      imageCover(ctx, art.muk, { x: WIDTH - side, y: H - side, width: side, height: side }, .5, .5);
      fade(ctx, palette.paper, '#0a223600', 0, 0, WIDTH, story ? 1000 : 800);
      fade(ctx, '#0a2236e8', '#0a223600', 0, 0, WIDTH, H - 130, true);
      eyebrow(page, story ? 196 : 150, MARGIN, 820);
      const heading = title(page, story ? 290 : 230, 388, 880, MARGIN, 120, 100);
      const bodyY = heading.box.y + heading.height + (story ? 76 : 52);
      body(page, bodyY, 218, 820, MARGIN, 42);
      note(page, bodyY + 242, 800);
    } else {
      const side = story ? 1220 : 1030;
      imageCover(ctx, art.inyeon, { x: 185, y: H - side - 36, width: side, height: side }, .5, .5);
      fade(ctx, palette.paper, '#faecd700', 0, 0, WIDTH, story ? 720 : 500);
      eyebrow(page, story ? 184 : 150);
      const heading = title(page, story ? 276 : 220, 376, 920, MARGIN, 118, 100);
      const bodyY = heading.box.y + heading.height + 38;
      const deck = fit(ctx, page.slide.body, { x: MARGIN, y: bodyY, width: 820, height: 170 }, { max: 40, min: 36, leading: 1.55 }, page.locale);
      fill(ctx, palette.paper, 60, bodyY - 20, 860, Math.min(deck.height, 170) + 40);
      body(page, bodyY, 170, 820, MARGIN, 40);
      note(page, bodyY + 194, 650);
    }
  }

  function observation(page) {
    const { ctx, H, template, palette } = page;
    const story = H === 1920;
    if (template === 'hanji') {
      eyebrow(page, story ? 306 : 236, 110, 850);
      const heading = title(page, story ? 398 : 330, 320, 850, 110, 104, 76);
      body(page, heading.box.y + heading.height + (story ? 116 : 76), story ? 600 : 410, 820, 110, 48);
      note(page, H - 240, 820, 110);
    } else if (template === 'muk') {
      imageCover(ctx, art.muk, { x: 640, y: H - 710, width: 600, height: 600 }, .85, .35);
      fade(ctx, palette.paper, '#0a223600', 570, H - 710, 220, 600, true);
      eyebrow(page, story ? 288 : 224);
      const heading = title(page, story ? 390 : 320, 330, 900, MARGIN, 106, 76);
      body(page, heading.box.y + heading.height + 76, story ? 620 : 390, 790, MARGIN, 46);
      note(page, H - 240, 730);
    } else {
      fill(ctx, palette.accent, 80, story ? 294 : 230, 76, 5);
      eyebrow(page, story ? 334 : 270, 80, 850);
      const heading = title(page, story ? 426 : 362, 320, 830, 80, 102, 74);
      body(page, heading.box.y + heading.height + 70, story ? 630 : 370, 790, 160, 46);
      note(page, H - 240, 790, 160);
    }
  }

  function metaphor(page) {
    const { ctx, H, template, palette } = page;
    const story = H === 1920;
    if (template === 'hanji') {
      eyebrow(page, 158);
      const heading = title(page, 246, 254, 920, 80, 98, 74);
      const imageY = heading.box.y + heading.height + 35;
      const imageHeight = story ? 550 : 310;
      imageCover(ctx, art.hanji, { x: 80, y: imageY, width: 920, height: imageHeight }, .5, .78);
      const bodyY = imageY + imageHeight + 34;
      body(page, bodyY, H - 260 - bodyY, 880, 80, 42);
      note(page, H - 232, 920);
    } else if (template === 'muk') {
      const imageHeight = story ? 790 : 380;
      imageCover(ctx, art.muk, { x: 0, y: 132, width: WIDTH, height: imageHeight }, .72, .27);
      fade(ctx, palette.paper, '#0a223600', 0, 132, WIDTH, 240);
      // Reading occupies an opaque lower field; the moon remains completely unobscured above.
      const textY = imageHeight + 150;
      fill(ctx, palette.paper, 0, textY - 38, WIDTH, H - textY + 38);
      eyebrow(page, textY);
      const heading = title(page, textY + 82, story ? 290 : 210, 920, 80, 96, 72);
      const bodyY = heading.box.y + heading.height + 38;
      body(page, bodyY, H - 244 - bodyY, 890, 80, 42);
      note(page, H - 224, 920);
    } else {
      eyebrow(page, 158);
      const heading = title(page, 246, 250, 900, 80, 98, 74);
      const imageY = heading.box.y + heading.height + 34;
      const imageHeight = story ? 610 : 280;
      imageCover(ctx, art.inyeon, { x: 190, y: imageY, width: 890, height: imageHeight }, .6, .32);
      const bodyY = imageY + imageHeight + 34;
      body(page, bodyY, H - 260 - bodyY, 810, 80, 42);
      note(page, H - 232, 920);
    }
  }

  function practice(page) {
    const { H, template } = page;
    const story = H === 1920;
    const offset = template === 'inyeon' ? 132 : 80;
    eyebrow(page, story ? 280 : 208, offset, 860);
    const heading = title(page, story ? 400 : 326, story ? 570 : 410, 920 - (offset - 80), offset, template === 'muk' ? 116 : 112, 84, template === 'inyeon' ? SANS : page.serif);
    const bodyY = heading.box.y + heading.height + (story ? 110 : 76);
    body(page, bodyY, H - 270 - bodyY, template === 'inyeon' ? 820 : 880, offset, 46);
    note(page, H - 234, 920 - (offset - 80), offset);
  }

  function invitation(page) {
    const { ctx, H, template, palette } = page;
    const story = H === 1920;
    if (template === 'hanji') {
      const imageHeight = story ? 480 : 260;
      imageCover(ctx, art.hanji, { x: 0, y: 130, width: WIDTH, height: imageHeight }, .5, .8);
      fade(ctx, palette.paper, '#f6ead600', 0, 130, WIDTH, 95);
    } else if (template === 'muk') {
      imageCover(ctx, art.muk, { x: 690, y: 128, width: 390, height: story ? 580 : 350 }, .92, .15);
      fade(ctx, palette.paper, '#0a223600', 630, 128, 200, story ? 580 : 350, true);
    } else {
      imageCover(ctx, art.inyeon, { x: 690, y: 130, width: 430, height: story ? 570 : 350 }, .68, .42);
      fade(ctx, palette.paper, '#faecd700', 610, 130, 230, story ? 570 : 350, true);
    }
    const start = template === 'hanji' ? (story ? 658 : 420) : (story ? 360 : 226);
    eyebrow(page, start, 80, template === 'hanji' ? 920 : 590);
    const heading = title(page, start + 86, 260, template === 'hanji' ? 920 : 860, 80, 100, 76);
    const bodyY = heading.box.y + heading.height + 44;
    const bodyBlock = body(page, bodyY, story ? 330 : 240, 860, 80, 42);
    const ctaY = H - 310;
    const cta = textBlock(page, 'cta', { x: 80, y: ctaY, width: 830, height: 105 }, { max: 40, min: 36, leading: 1.3, weight: 600 }, palette.ink, labels[page.locale].cta);
    ctx.strokeStyle = palette.accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(80, ctaY + cta.height + 16); ctx.lineTo(912, ctaY + cta.height + 16); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(938, ctaY + 19); ctx.lineTo(990, ctaY + 19); ctx.lineTo(974, ctaY + 3); ctx.moveTo(990, ctaY + 19); ctx.lineTo(974, ctaY + 35); ctx.stroke();
    note(page, H - 192, 920, 80, 44);
    if (bodyY + bodyBlock.height > ctaY - 32) page.issues.push('본문이 마지막 안내와 겹쳐. 문장이나 줄바꿈을 조금 줄여 줘.');
  }

  function draw(canvas, slide, options = {}, brand = {}) {
    const issues = [];
    if (!loaded) return [loadingError || '아트와 글꼴을 준비하는 중이야. 잠시 기다려 줘.'];
    if (!canvas?.getContext) return ['이미지를 그릴 Canvas가 없어.'];
    if (!TEMPLATES.includes(options.template) || !['feed', 'story'].includes(options.format) || !['ko', 'ja', 'en'].includes(options.locale) || !Number.isInteger(options.slideIndex) || options.slideIndex < 0 || options.slideIndex > 4) return ['이미지 템플릿·규격·언어·페이지 선택을 확인해 줘.'];
    if (!slide || ['eyebrow', 'title', 'body', 'note'].some(key => typeof slide[key] !== 'string')) return ['제목·본문·덧말의 원고 형식을 확인해 줘.'];
    let host;
    try { host = new URL(brand.site).hostname; } catch (_) { return ['브랜드의 웹 주소를 확인해 줘.']; }
    if (typeof brand.name !== 'string' || typeof brand.englishName !== 'string') return ['브랜드 이름을 확인해 줘.'];
    const H = options.format === 'story' ? 1920 : 1350;
    canvas.width = WIDTH; canvas.height = H; canvas.lang = options.locale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return ['이 브라우저에서 Canvas를 열지 못했어. 최신 브라우저로 다시 열어 줘.'];
    if ('lang' in ctx) ctx.lang = options.locale;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const page = { ctx, H, slide, brand, host, issues, locale: options.locale, index: options.slideIndex, template: options.template, palette: palettes[options.template], serif: options.locale === 'en' ? 'Georgia,serif' : SERIF };
    fill(ctx, page.palette.paper, 0, 0, WIDTH, H);
    if (!slide.title.trim()) issues.push('이미지 제목을 한 문장 넣어 줘.');
    if (!slide.body.trim()) issues.push('이미지 본문을 넣어 줘.');
    [cover, observation, metaphor, practice, invitation][page.index](page);
    masthead(page);
    footer(page);
    return Array.from(new Set(issues));
  }

  window.SajuPoster = Object.freeze({ ready, draw });
})();
