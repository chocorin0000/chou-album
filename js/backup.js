// 全部のアルバムを 1 つの zip に書き出す・zip から読み込む（準備のいらないバックアップ）。
// zip の形は Android 版の Backup.java と同じなので、Android で書き出した zip も読み込める（逆も）。
//   data/albums/<id>.json  data/pages/<id>.json  data/img/<写真>.jpg  pdf/<アルバムの名前>.pdf  はじめにお読みください.txt
import * as S from './store.js';
import { Album, Page } from './model.js';
import { albumPdf } from './pdf.js';
import { ZipWriter, openZip } from './zip.js';

const two = n => String(n).padStart(2, '0');
export function fileName() {
  const d = new Date();
  return `超アルバム_バックアップ_${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}_${two(d.getHours())}${two(d.getMinutes())}.zip`;
}

/** 書き出す。{ blob, albums, pages, imgs } を返す */
export async function exportAll(progress) {
  const aids = await S.albumIds();
  const z = new ZipWriter();
  const d = new Date();
  await z.add('はじめにお読みください.txt', '超！アルバムのバックアップです。\r\n'
    + 'アプリの「保存・バックアップ」→「読み込む」で、このファイルを選ぶと戻せます（Android 版・iPhone 版のどちらでも）。\r\n'
    + 'pdf フォルダの PDF（アルバムごと）は、パソコンやスマホで見たり印刷したりできます。\r\n'
    + 'data フォルダはアプリに戻す用のデータと写真です（中を直さないでください）。\r\n'
    + `書き出した日時: ${d.getFullYear()}/${two(d.getMonth() + 1)}/${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}　アルバムの数: ${aids.length}\r\n`);
  let nPages = 0, ai = 0;
  const imgs = new Set(), pdfNames = new Set();
  for (const aid of aids) {
    ai++;
    const a = await S.loadAlbum(aid);
    if (!a) continue;
    progress && progress(`書き出しています（アルバム ${ai} / ${aids.length}）…`);
    await z.add(`data/albums/${aid}.json`, a.toJson());
    const pages = [];
    for (const pid of a.pages) {
      const p = await S.loadPage(pid);
      if (!p) continue;
      pages.push(p);
      await z.add(`data/pages/${pid}.json`, p.toJson());
      nPages++;
      for (const it of p.items) {
        if (!it.file || imgs.has(it.file)) continue;
        const b = await S.loadImgBlob(it.file);
        if (!b) continue;
        imgs.add(it.file);
        await z.add('data/img/' + it.file, b);
      }
    }
    if (pages.length) {
      const t0 = (a.title.trim() || 'アルバム').replace(/[\\/:*?"<>|\r\n]+/g, '_');
      let name = t0;
      for (let k = 2; pdfNames.has(name); k++) name = t0 + '_' + k;
      pdfNames.add(name);
      await z.add(`pdf/${name}.pdf`, await albumPdf(a.title, pages));
    }
  }
  S.setSettings({ lastExport: Date.now() });
  return { blob: z.finish(), albums: aids.length, pages: nPages, imgs: imgs.size };
}

/** ファイルを読んで、戻すものを決める（まだ保存しない） */
export async function plan(file) {
  let zip;
  try { zip = await openZip(file); } catch (e) { throw new Error('超！アルバムのバックアップ（zip）ではないようです'); }
  const pl = { zip, albums: [], pages: [], inFile: 0, newer: 0, localAlbums: 0 };
  for (const e of zip.entries) {
    let m;
    if ((m = e.name.match(/^data\/albums\/(\d+)\.json$/))) {
      pl.albums.push(Album.fromJson(m[1], await zip.text(e)));
      if (await S.loadAlbum(m[1])) pl.localAlbums++;
    } else if ((m = e.name.match(/^data\/pages\/(\d+)\.json$/))) {
      const p = Page.fromJson(m[1], await zip.text(e));
      pl.inFile++;
      const local = await S.loadPage(m[1]);
      if (!local || local.updated < p.updated) pl.pages.push(p);
      else pl.newer++;
    }
  }
  if (!pl.albums.length && !pl.inFile) throw new Error('このファイルには超！アルバムのデータが入っていません');
  return pl;
}

/** 決めたものを保存する。戻したページの数を返す */
export async function apply(pl, progress) {
  // 1. 写真（戻すページに使っていて、ここにないもの）
  const need = new Set();
  for (const p of pl.pages) for (const it of p.items) if (it.file && !(await S.hasImg(it.file))) need.add(it.file);
  if (need.size) {
    progress && progress('写真を戻しています…');
    for (const e of pl.zip.entries) {
      const m = e.name.match(/^data\/img\/([0-9A-Za-z_]+\.jpg)$/);
      if (m && need.has(m[1])) await S.saveImg(m[1], new Blob([await pl.zip.read(e)], { type: 'image/jpeg' }));
    }
  }
  // 2. アルバム（ここにもあるアルバムは、こちらのほうを残して、ないページだけ後ろに足す）
  for (const a of pl.albums) {
    const local = await S.loadAlbum(a.id);
    if (!local) await S.saveAlbum(a);
    else {
      let add = false;
      for (const pid of a.pages) if (!local.pages.includes(pid)) { local.pages.push(pid); add = true; }
      if (add) await S.saveAlbum(local);
    }
  }
  // 3. ページ（小さな絵は、一覧を開いたときに作る）
  let n = 0;
  for (const p of pl.pages) {
    n++;
    progress && progress(`ページを戻しています ${n} / ${pl.pages.length}`);
    await S.savePage(p);
    await S.deleteThumb(p.id);
  }
  return n;
}
