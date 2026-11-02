// 保存の場所（この iPhone・iPad の中。ブラウザの IndexedDB）
//   albums: アルバム（id → JSON の文字）   pages: ページ（id → JSON の文字）
//   imgs:   取り込んだ写真（名前 → JPEG の Blob。長い辺 2000px までに縮めた写し）
//   thumbs: 一覧に出す小さな絵（ページの id → JPEG の Blob）
// 設定・送った記録は localStorage（名前はみな album. で始める。同じ場所に「超！手書き」「家電チェッカー」もあるため）
import { Album, Page } from './model.js';

const STORES = ['albums', 'pages', 'imgs', 'thumbs'];
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((ok, ng) => {
    const r = indexedDB.open('chou-album', 1);
    r.onupgradeneeded = () => { for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ng(r.error);
  });
  return dbp;
}

function req(store, mode, fn) {
  return db().then(d => new Promise((ok, ng) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => ok(r ? r.result : undefined);
    t.onerror = () => ng(t.error);
    t.onabort = () => ng(t.error || new Error('保存できませんでした（空きが足りない可能性があります）'));
  }));
}
const put = (s, k, v) => req(s, 'readwrite', st => st.put(v, k));
const get = (s, k) => req(s, 'readonly', st => st.get(k));
const del = (s, k) => req(s, 'readwrite', st => st.delete(k));
const keys = s => req(s, 'readonly', st => st.getAllKeys());

const parseId = s => { const n = Number(s); return isFinite(n) ? n : 0; };

/** 前のものと重ならない id（時刻のミリ秒） */
async function newId(store) {
  const have = new Set((await keys(store)).map(String));
  let t = Date.now();
  while (have.has(String(t))) t++;
  return String(t);
}

// ---- アルバム ----

/** アルバムの id を、新しく作ったものから順に */
export async function albumIds() {
  return (await keys('albums')).map(String).sort((a, b) => parseId(b) - parseId(a));
}

export async function loadAlbum(id) {
  const s = await get('albums', id);
  if (!s) return null;
  try { return Album.fromJson(id, s); } catch (e) { return null; }
}

export async function saveAlbum(a) { await put('albums', a.id, a.toJson()); }

export async function createAlbum(title) {
  const a = new Album();
  a.id = await newId('albums');
  a.title = title;
  a.created = Number(a.id);
  await saveAlbum(a);
  return a;
}

/** アルバムと中のページを消す（写真は、あとで cleanup が消す） */
export async function deleteAlbum(a) {
  for (const id of a.pages) await deletePage(id);
  await del('albums', a.id);
}

// ---- ページ ----

export async function pageIds() { return (await keys('pages')).map(String); }

export async function loadPage(id) {
  const s = await get('pages', id);
  if (!s) return null;
  try { return Page.fromJson(id, s); } catch (e) { return null; }
}

export async function savePage(p) { await put('pages', p.id, p.toJson()); }

export async function createPage(pw, ph) {
  const p = new Page();
  p.id = await newId('pages');
  p.pw = pw; p.ph = ph;
  p.created = p.updated = Date.now();
  await savePage(p);
  return p;
}

export async function deletePage(id) {
  await del('pages', id);
  await del('thumbs', id);
}

// ---- 写真 ----

export const PHOTO_MAX = 2000;

export async function saveImg(name, blob) { await put('imgs', name, blob); }
export async function loadImgBlob(name) { return (await get('imgs', name)) || null; }
export async function hasImg(name) { return !!(await req('imgs', 'readonly', st => st.getKey(name))); }
export async function imgNames() { return (await keys('imgs')).map(String); }

/** 写真のファイル（Blob）を読み込んで縮め、アプリの中に写しを作る。名前を返す */
export async function importPhoto(file) {
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    bmp = await loadByImg(file);
  }
  const big = Math.max(bmp.width, bmp.height), k = big > PHOTO_MAX ? PHOTO_MAX / big : 1;
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  c.imageSmoothingQuality = 'high';
  c.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const blob = await toBlob(cv, 'image/jpeg', 0.9);
  cv.width = cv.height = 0;
  const name = Date.now() + '_' + Math.floor(Math.random() * 0x10000).toString(16) + '.jpg';
  await saveImg(name, blob);
  return { name, w, h };
}

function loadByImg(file) {
  return new Promise((ok, ng) => {
    const u = URL.createObjectURL(file), im = new Image();
    im.onload = () => { URL.revokeObjectURL(u); ok(im); };
    im.onerror = () => { URL.revokeObjectURL(u); ng(new Error('写真を読めませんでした')); };
    im.src = u;
  });
}

export function toBlob(cv, type, q) {
  return new Promise((ok, ng) => cv.toBlob(b => b ? ok(b) : ng(new Error('絵を作れませんでした')), type, q));
}

/** どのページにも使われていない写真を消す（読めないページがあるときは、念のため何も消さない） */
export async function cleanup() {
  const used = new Set();
  for (const id of await pageIds()) {
    const p = await loadPage(id);
    if (!p) return;
    for (const it of p.items) if (it.file) used.add(it.file);
  }
  const now = Date.now();
  for (const n of await imgNames()) {
    const t = parseId(n.split('_')[0]);
    if (!used.has(n) && now - t > 60000) await del('imgs', n);
  }
}

// ---- 小さな絵 ----

export async function saveThumb(id, blob) { await put('thumbs', id, blob); }
export async function loadThumb(id) { return (await get('thumbs', id)) || null; }
export async function deleteThumb(id) { await del('thumbs', id); }

// ---- 消さないで、と頼む ----

export function askPersist() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* なくてよい */ }
}

// ---- 設定 ----

const PREF = 'album.settings';
const DEF = { url: '', key: '', auto: true, outline: false, cropOnImport: false, lastExport: 0 };

export function settings() {
  try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(PREF) || '{}')); }
  catch (e) { return Object.assign({}, DEF); }
}
export function setSettings(patch) {
  const s = Object.assign(settings(), patch);
  try { localStorage.setItem(PREF, JSON.stringify(s)); } catch (e) { /* 保存できなくても動く */ }
  return s;
}

// クラウドに送った記録: p（ページ id → updated）、a（アルバム id → 印）、f（アルバム id → PDF の印）、
// imgs（送った写真の名前）、delp / dela（クラウドで「消したもの」に移してもらうページ・アルバム）
const SYNC = 'album.sync';
export function syncState() {
  const d = { p: {}, a: {}, f: {}, imgs: [], delp: [], dela: [] };
  try { return Object.assign(d, JSON.parse(localStorage.getItem(SYNC) || '{}')); } catch (e) { return d; }
}
export function setSyncState(s) {
  try { localStorage.setItem(SYNC, JSON.stringify(s)); } catch (e) { /* なくてよい */ }
}
