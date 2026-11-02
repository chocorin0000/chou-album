// Google ドライブ（超！アルバムの Google Apps Script）への保存と、そこから戻す処理。Android 版の Cloud.java と同じ。
// 同じスクリプト・同じフォルダを使うので、Android で作ったアルバムも iPhone・iPad で作ったアルバムも同じ場所に入る。
// - 書き直したページ（updated が、前に送ったときと違うもの）と、名前・並びが変わったアルバムだけを送る
// - 写真は、まだ送っていないものだけ送る。アルバムごとに、全部のページを 1 つにまとめた PDF も送る
// - 消したページ・アルバムは、クラウドの「消したもの」フォルダに移してもらう
import * as S from './store.js';
import { Album, Page, javaHash } from './model.js';
import { albumPdf } from './pdf.js';

let statusText = '', listener = null, running = false, again = false;
export function onStatus(fn) { listener = fn; if (fn) fn(statusText); }
function setStatus(s) { statusText = s; if (listener) listener(s); }

export const configured = () => { const s = S.settings(); return !!(s.url && s.key); };

/** スクリプトに送る。ok でなければ例外 */
export async function call(req) {
  const s = S.settings();
  req.key = s.key;
  let res;
  try {
    // Content-Type を付けない（text/plain）と、ブラウザの前もっての問い合わせがなく、GAS でそのまま受け取れる
    res = await fetch(s.url.trim(), { method: 'POST', body: JSON.stringify(req), redirect: 'follow' });
  } catch (e) {
    throw new Error('つながりません。電波を確かめるか、URL が正しいか確かめてください');
  }
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch (e) {
    throw new Error('答えが読めません。URL が正しいか、デプロイの「アクセスできるユーザー」が「全員」か確かめてください');
  }
  if (!j.ok) throw new Error(j.error || '失敗しました');
  return j;
}

export const ping = () => call({ action: 'ping' });

export const albumMark = a => javaHash(a.toJson());
const pdfMark = (a, pages) => javaHash(albumMark(a) + pages.map(p => ',' + p.id + ':' + p.updated).join(''));

export function markDeletedPage(id) { markDeleted('p', 'delp', id); }
export function markDeletedAlbum(id) { markDeleted('a', 'dela', id); }
function markDeleted(kind, list, id) {
  const st = S.syncState();
  if (id in st[kind]) { // 前にクラウドに送っていたものだけ
    delete st[kind][id];
    delete st.f[id];
    if (!st[list].includes(id)) st[list].push(id);
    S.setSyncState(st);
  }
  request();
}

/** 自動保存が ON なら、まだ送っていないものを送る（何度呼んでもよい） */
export function request() {
  if (!configured()) { setStatus(''); return; }
  if (!S.settings().auto) { setStatus('クラウド: 自動保存 OFF'); return; }
  syncNow();
}

export async function syncNow() {
  if (!configured()) { setStatus(''); return; }
  if (running) { again = true; return; }
  running = true;
  try { do { again = false; await syncOnce(); } while (again); }
  finally { running = false; }
}

const b64 = async blob => {
  const u = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
};

async function syncOnce() {
  const st0 = S.syncState();
  const jobs = [];
  let total = 0;
  for (const aid of await S.albumIds()) {
    const a = await S.loadAlbum(aid);
    if (!a) continue;
    const j = { a, pages: [], send: [] };
    for (const pid of a.pages) {
      const p = await S.loadPage(pid);
      if (!p) continue;
      j.pages.push(p);
      if (st0.p[pid] !== p.updated) j.send.push(p);
    }
    j.sendAlbum = albumMark(a) !== st0.a[aid];
    j.pdfMark = pdfMark(a, j.pages);
    j.sendPdf = j.pdfMark !== st0.f[aid];
    if (j.send.length || j.sendAlbum || j.sendPdf) { jobs.push(j); total += j.send.length + (j.sendAlbum ? 1 : 0) + (j.sendPdf ? 1 : 0); }
  }
  total += st0.delp.length + st0.dela.length;
  if (!total) { setStatus('クラウド: 保存済み'); return; }
  if (!navigator.onLine) { setStatus(`クラウド: 電波がないので、あとで送ります（${total} 件）`); return; }
  let done = 0, serverImgs = null;
  const upd = fn => { const s = S.syncState(); fn(s); S.setSyncState(s); };
  try {
    for (const j of jobs) {
      const a = j.a;
      for (const p of j.send) {
        setStatus(`クラウド: 保存中 ${done + 1} / ${total}`);
        for (const it of p.items) {
          if (!it.file || S.syncState().imgs.includes(it.file)) continue;
          const blob = await S.loadImgBlob(it.file);
          if (!blob) continue;
          if (!serverImgs) serverImgs = new Set((await call({ action: 'list' })).imgs || []);
          if (!serverImgs.has(it.file)) {
            await call({ action: 'putImg', name: it.file, data: await b64(blob) });
            serverImgs.add(it.file);
          }
          upd(s => { if (!s.imgs.includes(it.file)) s.imgs.push(it.file); });
        }
        await call({ action: 'savePage', id: p.id, updated: p.updated, json: p.toJson() });
        upd(s => { s.p[p.id] = p.updated; });
        done++;
      }
      if (j.sendAlbum) {
        setStatus(`クラウド: 保存中 ${done + 1} / ${total}`);
        const mark = albumMark(a);
        await call({ action: 'saveAlbum', id: a.id, json: a.toJson(), mark });
        upd(s => { s.a[a.id] = mark; });
        done++;
      }
      if (j.sendPdf) {
        setStatus(`クラウド: PDF を作っています ${done + 1} / ${total}`);
        const title = a.title || '（名前なし）';
        const data = await b64(await albumPdf(title, j.pages));
        setStatus(`クラウド: PDF を送っています ${done + 1} / ${total}`);
        await call({ action: 'savePdf', id: a.id, title, data });
        upd(s => { s.f[a.id] = j.pdfMark; });
        done++;
      }
    }
    for (const id of st0.delp) {
      setStatus(`クラウド: 保存中 ${done + 1} / ${total}`);
      await call({ action: 'delPage', id });
      upd(s => { s.delp = s.delp.filter(x => x !== id); });
      done++;
    }
    for (const id of st0.dela) {
      setStatus(`クラウド: 保存中 ${done + 1} / ${total}`);
      await call({ action: 'delAlbum', id });
      upd(s => { s.dela = s.dela.filter(x => x !== id); });
      done++;
    }
    setStatus('クラウド: 保存済み');
  } catch (e) {
    setStatus(`クラウド: 送れませんでした（${total - done} 件。あとでやり直します）\n${e.message}`);
  }
}

// ---- 戻す（ほかの機械で作ったアルバムも取り込める） ----

export async function planRestore() {
  const r = await call({ action: 'list' });
  const plan = { albums: [], pages: [], cloudPages: 0, newer: 0, localAlbums: 0 };
  for (const o of r.albums || []) {
    plan.albums.push(o.id);
    if (await S.loadAlbum(o.id)) plan.localAlbums++;
  }
  const st = S.syncState();
  plan.cloudPages = (r.pages || []).length;
  for (const o of r.pages || []) {
    if (st.delp.includes(o.id)) continue; // ここで消したもの
    const local = await S.loadPage(o.id);
    if (!local || local.updated < (o.updated || 0)) plan.pages.push(o.id);
    else plan.newer++;
  }
  return plan;
}

export async function restore(plan, progress) {
  const st = S.syncState();
  // 先にアルバム（スマホにもあるアルバムは、こちらのほうを残して、ないページだけ後ろに足す）
  for (const id of plan.albums) {
    if (st.dela.includes(id)) continue;
    const cloud = Album.fromJson(id, (await call({ action: 'get', kind: 'album', id })).json);
    const local = await S.loadAlbum(id);
    if (!local) {
      await S.saveAlbum(cloud);
      const s = S.syncState(); s.a[id] = albumMark(cloud); S.setSyncState(s);
    } else {
      let add = false;
      for (const pid of cloud.pages) if (!local.pages.includes(pid)) { local.pages.push(pid); add = true; }
      if (add) await S.saveAlbum(local);
    }
  }
  let n = 0;
  for (const id of plan.pages) {
    progress && progress(`戻しています ${n + 1} / ${plan.pages.length}`);
    const p = Page.fromJson(id, (await call({ action: 'get', kind: 'page', id })).json);
    for (const it of p.items) {
      if (!it.file) continue;
      if (!(await S.hasImg(it.file))) {
        const d = (await call({ action: 'getImg', name: it.file })).data;
        const bin = atob(d), u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        await S.saveImg(it.file, new Blob([u], { type: 'image/jpeg' }));
      }
      const s = S.syncState(); if (!s.imgs.includes(it.file)) { s.imgs.push(it.file); S.setSyncState(s); }
    }
    await S.savePage(p);
    await S.deleteThumb(id);
    const s = S.syncState(); s.p[id] = p.updated; S.setSyncState(s); // クラウドと同じなので、送り直さない
    n++;
  }
  return n;
}
