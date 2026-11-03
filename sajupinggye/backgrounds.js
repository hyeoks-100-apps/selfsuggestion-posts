'use strict';

// Images stay in this browser. Only explicit JSON backups contain their bytes.
(() => {
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const cache = new Map();
  let database;
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const validId = id => typeof id === 'string' && /^img_[a-f0-9-]{36}$/.test(id);
  function readSetting(value) {
    if (!object(value) || Object.keys(value).some(k => !['assetId', 'x', 'y', 'zoom', 'wash'].includes(k)) || !validId(value.assetId)) throw new Error('사진 설정 형식이 맞지 않아.');
    for (const [key, min, max] of [['x', 0, 100], ['y', 0, 100], ['zoom', 1, 3], ['wash', 0, 95]]) {
      if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max) throw new Error('사진 위치·확대·흐림 값을 확인해 줘.');
    }
    return { assetId: value.assetId, x: value.x, y: value.y, zoom: value.zoom, wash: value.wash };
  }
  function readAssets(values = []) {
    if (!Array.isArray(values) || values.length > 1500) throw new Error('백업 사진 목록을 확인해 줘.');
    const ids = new Set();
    return values.map(value => {
      if (!object(value) || Object.keys(value).some(k => !['id', 'name', 'width', 'height', 'dataUrl'].includes(k)) || !validId(value.id) || ids.has(value.id)) throw new Error('백업 사진 ID가 잘못되었거나 중복돼 있어.');
      ids.add(value.id);
      if (typeof value.name !== 'string' || value.name.length > 180 || !Number.isInteger(value.width) || !Number.isInteger(value.height) || Math.min(value.width, value.height) < 1 || Math.max(value.width, value.height) > 1920) throw new Error('백업 사진의 이름·크기를 확인해 줘.');
      if (typeof value.dataUrl !== 'string' || value.dataUrl.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 30 || !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(value.dataUrl)) throw new Error('백업에는 작업실에서 만든 JPEG 사진만 담을 수 있어.');
      return { id: value.id, name: value.name, width: value.width, height: value.height, dataUrl: value.dataUrl };
    });
  }
  function openDatabase() {
    if (!database) database = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('이 브라우저는 사진 저장을 지원하지 않아. 일반 브라우저 창에서 다시 열어 줘.')); return; }
      const request = indexedDB.open('sajupinggye-studio-images', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('images', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('사진 저장소를 열지 못했어. 브라우저 저장 공간을 확인해 줘.'));
      request.onblocked = () => reject(new Error('예전 작업실 탭을 닫고 사진을 다시 올려 줘.'));
    }).catch(error => { database = null; throw error; });
    return database;
  }
  async function putAll(values) {
    if (!values.length) return;
    const sameImage = (a, b) => a.dataUrl === b.dataUrl && a.width === b.width && a.height === b.height;
    const conflict = '같은 사진 ID에 다른 이미지가 들어 있어. 기존 사진은 보존했어. 원본 사진 포함 백업을 확인해 줘.';
    const unique = new Map();
    for (const value of values) {
      if (unique.has(value.id) && !sameImage(unique.get(value.id), value)) throw new Error(conflict);
      if (!unique.has(value.id)) unique.set(value.id, value);
    }
    const db = await openDatabase();
    const inserted = [];
    await new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readwrite');
      const store = tx.objectStore('images');
      let failure;
      const abort = error => {
        failure ||= error;
        try { tx.abort(); } catch (_) { /* A failing request may already have aborted it. */ }
      };
      const storageError = () => new Error('사진을 저장하지 못했어. 기존 사진은 보존했어. 저장 공간을 확인하고 다시 올려 줘.');
      tx.oncomplete = resolve;
      tx.onabort = () => reject(failure || storageError());
      tx.onerror = () => { failure ||= storageError(); };
      try {
        for (const value of unique.values()) {
          const request = store.get(value.id);
          request.onerror = () => abort(storageError());
          request.onsuccess = () => {
            if (failure) return;
            if (request.result) {
              if (!sameImage(request.result, value)) abort(new Error(conflict));
              return; // An existing immutable image also keeps its original name.
            }
            try {
              const write = store.put(value);
              write.onerror = () => abort(storageError());
              inserted.push(value.id);
            } catch (_) { abort(storageError()); }
          };
        }
      } catch (_) { abort(storageError()); }
    });
    for (const id of inserted) cache.delete(id);
  }
  async function get(id) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction('images', 'readonly').objectStore('images').get(id);
      request.onsuccess = () => request.result ? resolve(request.result) : reject(new Error('저장된 사진을 찾지 못했어. 사진을 다시 올리거나 사진 포함 백업을 불러와 줘.'));
      request.onerror = () => reject(new Error('사진을 읽지 못했어. 다시 열어 줘.'));
    });
  }
  function decode(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('사진을 읽지 못했어. JPG·PNG·WebP 파일을 골라 줘.'));
      image.src = url;
    });
  }
  async function image(id) {
    if (!cache.has(id)) cache.set(id, get(id).then(async asset => ({ image: await decode(asset.dataUrl), name: asset.name })).catch(error => { cache.delete(id); throw error; }));
    if (cache.size > 12) cache.delete(cache.keys().next().value);
    return cache.get(id);
  }
  function asDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('사진 파일을 읽지 못했어.')); reader.readAsDataURL(blob);
    });
  }
  async function prepare(file) {
    if (!file || file.size > MAX_FILE_BYTES) throw new Error('사진은 20MB 이하 JPG·PNG·WebP로 골라 줘.');
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const png = [137,80,78,71,13,10,26,10].every((b,i) => bytes[i] === b);
    const webp = String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
    if (!jpg && !png && !webp) throw new Error('JPG·PNG·WebP 사진만 쓸 수 있어.');
    const url = URL.createObjectURL(file);
    try {
      const source = await decode(url);
      if (source.naturalWidth * source.naturalHeight > 60000000) throw new Error('사진이 너무 커. 6천만 화소 이하로 줄인 뒤 올려 줘.');
      const scale = Math.min(1, 1920 / Math.max(source.naturalWidth, source.naturalHeight));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(source.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      let blob;
      for (const quality of [.9, .8, .65]) {
        blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (blob && blob.size <= MAX_IMAGE_BYTES) break;
      }
      if (!blob || blob.size > MAX_IMAGE_BYTES) throw new Error('사진을 줄이지 못했어. 조금 작은 파일을 골라 줘.');
      return { id: 'img_' + crypto.randomUUID(), name: file.name.replace(/[\u0000-\u001f]/g, '').slice(0, 180), width: canvas.width, height: canvas.height, dataUrl: await asDataUrl(blob) };
    } finally { URL.revokeObjectURL(url); }
  }
  // Explicit maintenance only: callers supply every asset ID that must survive.
  // One transaction keeps failures atomic; cache entries change after commit.
  async function prune(keepIds) {
    if (!Array.isArray(keepIds) && !(keepIds instanceof Set)) throw new Error('보관할 사진 ID를 배열이나 Set으로 전달해 줘.');
    const keep = new Set(keepIds);
    if ([...keep].some(id => !validId(id))) throw new Error('보관할 사진 ID 형식이 맞지 않아. 사진을 정리하지 않았어.');
    const db = await openDatabase();
    const removed = [];
    await new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readwrite');
      tx.oncomplete = resolve;
      tx.onabort = () => reject(new Error('사진 정리를 마치지 못했어. 저장된 사진은 그대로 보관했어.'));
      const request = tx.objectStore('images').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        try {
          if (!keep.has(cursor.primaryKey)) {
            cursor.delete();
            removed.push(cursor.primaryKey);
          }
          cursor.continue();
        } catch (_) {
          tx.abort();
        }
      };
    });
    for (const id of removed) cache.delete(id);
    return removed.length;
  }
  function requiredIds(backgrounds) { return [...new Set(Object.values(backgrounds).flat().filter(Boolean).map(v => v.assetId))]; }
  async function collect(backgrounds) { return Promise.all(requiredIds(backgrounds).map(get)); }
  async function restore(values, backgrounds) {
    const assets = readAssets(values);
    const byId = new Map(assets.map(asset => [asset.id, asset]));
    if (requiredIds(backgrounds).some(id => !byId.has(id))) throw new Error('사진이 빠진 백업이야. 사진 포함 JSON 백업을 골라 줘.');
    for (const id of requiredIds(backgrounds)) {
      const asset = byId.get(id), loaded = await decode(asset.dataUrl);
      if (loaded.naturalWidth !== asset.width || loaded.naturalHeight !== asset.height) throw new Error('백업 사진의 실제 크기가 기록과 달라.');
    }
    await putAll(assets);
  }
  window.SajuBackgrounds = { readSetting, readAssets, prepare, putAll, image, collect, restore, requiredIds, prune };
})();
