// ページを絵（canvas）にする。写真は IndexedDB から読んで、描く大きさに合わせて縮めて覚えておく
import { loadImgBlob } from './store.js';

const cache = new Map(); // 名前 → { bmp, side }
// 編集の画面で覚えておく写真の長い辺（iPhone のメモリが足りなくならないように、元の 2000 より少し小さく）
const EDIT_SIDE = 1600;

/** 覚えている写真を全部忘れる（ページを閉じたとき） */
export function clearCache() {
  for (const c of cache.values()) if (c.bmp && c.bmp.close) c.bmp.close();
  cache.clear();
}

async function loadTemp(name, maxSide) {
  const blob = await loadImgBlob(name);
  if (!blob) return null;
  try {
    const bmp = await createImageBitmap(blob);
    const big = Math.max(bmp.width, bmp.height);
    if (big <= maxSide * 1.3) return bmp;
    const k = maxSide / big;
    const small = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * k), resizeHeight: Math.round(bmp.height * k), resizeQuality: 'high' });
    bmp.close();
    return small;
  } catch (e) {
    return null;
  }
}

/** 写真を読んで、画面用に覚えておく（maxSide より大きければ縮める）。読めなければ null */
export async function getBitmap(name, maxSide = 2000) {
  const c = cache.get(name);
  if (c && c.bmp && c.side >= maxSide) return c.bmp;
  const blob = await loadImgBlob(name);
  if (!blob) return null;
  let bmp;
  try {
    bmp = await createImageBitmap(blob);
    const big = Math.max(bmp.width, bmp.height);
    if (big > maxSide * 1.3) {
      const k = maxSide / big;
      const small = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * k), resizeHeight: Math.round(bmp.height * k), resizeQuality: 'high' });
      bmp.close();
      bmp = small;
    }
  } catch (e) {
    return null;
  }
  if (c && c.bmp && c.bmp.close) c.bmp.close();
  cache.set(name, { bmp, side: maxSide });
  return bmp;
}

/** 覚えている絵（なければ null。そのとき読み始めて、読めたら done を呼ぶ） */
export function peekBitmap(name, done) {
  const c = cache.get(name);
  if (c) return c.bmp;
  if (!cache.has(name)) {
    cache.set(name, { bmp: null, side: 0 });
    getBitmap(name, EDIT_SIDE).then(b => { if (b && done) done(); }, () => {});
  }
  return null;
}

export function forget(name) {
  const c = cache.get(name);
  if (c && c.bmp && c.bmp.close) c.bmp.close();
  cache.delete(name);
}

/** ページを幅 width px の canvas にする */
export async function renderPage(p, width) {
  const k = width / p.pw, height = Math.round(p.ph * k);
  const side = Math.max(256, Math.min(2000, width));
  const bm = new Map(), temp = [];
  for (const it of p.items) {
    if (!it.file || bm.has(it.file)) continue;
    const have = cache.get(it.file);
    if (have && have.bmp && have.side >= side) { bm.set(it.file, have.bmp); continue; }
    // 覚えていないものは、この絵のためだけに読む（画面用に覚えている絵を小さいものに入れ替えないため）
    const b = await loadTemp(it.file, side);
    bm.set(it.file, b);
    if (b) temp.push(b);
  }
  const cv = document.createElement('canvas');
  cv.width = width; cv.height = height;
  const c = cv.getContext('2d');
  c.scale(k, k);
  p.drawAll(c, f => bm.get(f) || null);
  for (const b of temp) if (b.close) b.close();
  return cv;
}
