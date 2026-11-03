// 超！アルバム Web 版（iPhone・iPad 用）。画面: アルバムの一覧 → アルバムのページ → ページの編集（＋切り抜き）、保存・バックアップ。
// Android 版「超！アルバム」と同じデータの形なので、zip のバックアップと Google ドライブ（同じスクリプト）で行き来できる。
import * as S from './store.js';
import * as R from './render.js';
import * as C from './cloud.js';
import * as B from './backup.js';
import { albumPdf } from './pdf.js';
import { Item, Page, PHOTO, TEXT, INK, LINE, css, COLORS, WIDTH_NAMES, PEN_W, LINE_W, PAPER, PAPER_NAMES } from './model.js';
import { PageView, SELECT, PEN, LINE_T, ARROW, TEXT_T } from './pageview.js';
import { el, btn, toast, dialog, confirmDlg, askText, check, applyFull, fullSize, shareFile, shareAfterWork, isIPad } from './ui.js';

const VERSION = 'v5（2026-11-03）';
const $ = id => document.getElementById(id);
const SCREENS = ['scr-list', 'scr-album', 'scr-edit', 'scr-crop', 'scr-set'];
let curScreen = 'scr-list';
function show(id) {
  curScreen = id;
  for (const s of SCREENS) $(s).hidden = s !== id;
}
const vis = (e, on) => { e.style.display = on ? '' : 'none'; };
const isLand = () => { const [w, h] = fullSize(); return w > h; };
const two = n => String(n).padStart(2, '0');
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const today = () => { const d = new Date(); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${WEEK[d.getDay()]})`; };
const nowTime = () => { const d = new Date(); return `${d.getHours()}:${two(d.getMinutes())}`; };
const dateName = () => { const d = new Date(); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日のアルバム`; };
const ymd = t => { const d = new Date(t); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
const mdhm = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${two(d.getMinutes())}`; };
const albumTitle = a => (a && a.title) ? a.title : 'アルバム';
const cleanName = s => { s = String(s).replace(/[\\/:*?"<>|\r\n]+/g, '_').trim(); return s || 'アルバム'; };
const standalone = () => !!navigator.standalone || matchMedia('(display-mode: standalone)').matches;

/** 時間がかかる間に出す札 */
function busy(msg) {
  const b = el('div', 'busy'), t = el('div', null, msg);
  b.appendChild(t);
  document.body.appendChild(b);
  return { set: m => { t.textContent = m; }, close: () => b.remove() };
}

// ---- 小さな絵（一覧用） ----

let urls = [];
function revokeAll() { for (const u of urls) URL.revokeObjectURL(u); urls = []; }

async function makeThumb(p) {
  const cv = await R.renderPage(p, 420);
  const blob = await S.toBlob(cv, 'image/jpeg', 0.85);
  cv.width = cv.height = 0;
  await S.saveThumb(p.id, blob);
  return blob;
}

/** ページの小さな絵を pic（.pic）に入れる。なければ作る */
async function fillThumb(pic, pid, token) {
  let blob = await S.loadThumb(pid);
  if (!blob) {
    const p = await S.loadPage(pid);
    if (!p) return;
    blob = await makeThumb(p);
  }
  if (token !== listToken) return;
  const u = URL.createObjectURL(blob);
  urls.push(u);
  const img = el('img');
  img.src = u;
  pic.classList.remove('empty');
  pic.appendChild(img);
}
let listToken = 0;

// ---- アルバムの一覧 ----

let cloudFoot = null;
C.onStatus(s => setFoot(s));
function setFoot(s) {
  if (!cloudFoot) return;
  if (!C.configured()) cloudFoot.textContent = 'Google ドライブへの自動保存: 未設定（ここを押すと設定）';
  else cloudFoot.textContent = s || 'クラウド: 確かめています…';
  cloudFoot.style.color = /送れません/.test(s) ? '#FF9A8A' : '';
}

async function showList() {
  const token = ++listToken;
  revokeAll();
  const scr = $('scr-list');
  scr.textContent = '';
  const head = el('div', 'head');
  const title = el('div', 'title');
  title.innerHTML = '<span class="cho">超</span>！アルバム';
  head.append(title, btn('＋ 新しいアルバム', newAlbum, 'gold add'), btn('︙', listMenu, 'menu'));
  const box = el('div', 'box');
  cloudFoot = el('div', 'foot');
  cloudFoot.onclick = () => showSettings();
  scr.append(head, box, cloudFoot);
  setFoot('');
  C.request();
  show('scr-list');

  const ids = await S.albumIds();
  if (token !== listToken) return;
  if (!ids.length) {
    let m = 'まだアルバムがありません。\n右上の「＋ 新しいアルバム」で、名前をつけてアルバムを作ってください。\nアルバムの中に、ページをいくつでも足せます。\n\n'
      + 'ページには、写真（カメラで撮る・写真から選ぶ）、文字、手書き、線、矢印、日付を、好きな所に置けます。';
    if (!standalone()) m += '\n\n【おすすめ】Safari の共有ボタン（□に↑）→「ホーム画面に追加」で、アプリのように画面いっぱいで使えます。';
    box.appendChild(el('div', 'empty-msg', m));
    return;
  }
  const grid = el('div', 'grid');
  box.appendChild(grid);
  for (const id of ids) {
    const a = await S.loadAlbum(id);
    if (token !== listToken) return;
    if (!a) continue;
    let last = a.created;
    for (const pid of a.pages) { const p = await S.loadPage(pid); if (p) last = Math.max(last, p.updated); }
    const card = el('div', 'card');
    const pic = el('div', 'pic empty'); pic.dataset.msg = 'ページなし';
    card.append(pic, el('div', 'name', a.title || '（名前なし）'), el('div', 'sub', `${a.pages.length} ページ　${ymd(last || Date.now())}`));
    const more = el('button', 'more', '︙');
    more.type = 'button';
    more.onclick = e => { e.stopPropagation(); albumMenu(a); };
    card.appendChild(more);
    card.onclick = () => showAlbum(a.id);
    grid.appendChild(card);
    if (a.pages.length) fillThumb(pic, a.pages[0], token);
  }
}

async function listMenu() {
  const v = await dialog({ items: [{ text: '保存・バックアップ（Google ドライブ）', value: 1 }, { text: 'この Web アプリについて', value: 2 }] });
  if (v === 1) showSettings();
  else if (v === 2) about();
}

function screenInfo() {
  const t = el('div'); t.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom) 0;visibility:hidden';
  document.body.appendChild(t);
  const cs = getComputedStyle(t), r = `${innerWidth}x${innerHeight} / screen ${screen.width}x${screen.height} / vv ${visualViewport ? Math.round(visualViewport.height) : '-'} / safe ${cs.paddingTop} ${cs.paddingBottom} / ${standalone() ? 'home' : 'safari'}`;
  t.remove();
  return r;
}

function about() {
  dialog({
    title: '超！アルバム Web 版', cancel: '閉じる',
    message: `${VERSION}\n\n`
      + 'アルバムは、この iPhone・iPad の中（Safari の保存場所）に入ります。Safari の「履歴と Web サイトデータを消去」をすると消えてしまうので、'
      + 'ときどき「保存・バックアップ」でバックアップを取ってください。\n\n'
      + 'Android 版「超！アルバム」とデータの形が同じなので、バックアップのファイルや Google ドライブ（同じスクリプト）で行き来できます。'
      + '\n\n画面: ' + screenInfo()
  });
}

async function newAlbum() {
  const name = await askText({ title: '新しいアルバムの名前', hint: '例: 家族旅行 2026 夏（空のままなら今日の日付の名前）' });
  if (name == null) return;
  const a = await S.createAlbum(name.trim() || dateName());
  C.request();
  showAlbum(a.id);
}

async function albumMenu(a) {
  const v = await dialog({
    title: a.title || '（名前なし）',
    items: [{ text: '開く', value: 1 }, { text: '送る・保存する（PDF で LINE・メール・ファイルなど）', value: 2 },
      { text: '名前を変える', value: 3 }, { text: '削除する', value: 4 }]
  });
  if (v === 1) showAlbum(a.id);
  else if (v === 2) sendAlbum(a);
  else if (v === 3) {
    const nm = await askText({ title: 'アルバムの名前', value: a.title });
    if (nm == null) return;
    a.title = nm.trim() || dateName();
    await S.saveAlbum(a);
    C.request();
    showList();
  } else if (v === 4) {
    const ok = await confirmDlg(`アルバム「${a.title || '（名前なし）'}」と、中の ${a.pages.length} ページを削除しますか？\n（元に戻せません。写真アプリの写真は消えません）`, '削除する', '削除');
    if (!ok) return;
    for (const pid of a.pages) C.markDeletedPage(pid);
    C.markDeletedAlbum(a.id);
    await S.deleteAlbum(a);
    S.cleanup();
    showList();
  }
}

// ---- 送る ----

async function loadPages(a) {
  const ps = [];
  for (const id of a.pages) { const p = await S.loadPage(id); if (p) ps.push(p); }
  return ps;
}

const pageName = (a, idx) => idx >= 0 ? `${cleanName(albumTitle(a))}_${two(idx + 1)}ページ` : cleanName(albumTitle(a));

async function sendPageImage(p, a, idx) {
  const b = busy('画像を作っています…');
  let file;
  try {
    const cv = await R.renderPage(p, 2400);
    const blob = await S.toBlob(cv, 'image/jpeg', 0.92);
    cv.width = cv.height = 0;
    file = new File([blob], pageName(a, idx) + '.jpg', { type: 'image/jpeg' });
  } catch (e) { b.close(); toast('作れませんでした: ' + e.message, true); return; }
  b.close();
  await shareAfterWork(file, '画像ができました');
}

async function sendPdf(title, pages, name) {
  const b = busy('PDF を作っています…');
  let file;
  try {
    const blob = await albumPdf(title, pages, m => b.set(m));
    file = new File([blob], name + '.pdf', { type: 'application/pdf' });
  } catch (e) { b.close(); toast('作れませんでした: ' + e.message, true); return; }
  b.close();
  await shareAfterWork(file, 'PDF ができました');
}

async function sendPageMenu(p, a) {
  const idx = a ? a.pages.indexOf(p.id) : -1;
  const no = idx >= 0 ? `${idx + 1} ページ目` : 'このページ';
  const items = [{ text: '画像で送る・保存する（LINE・写真アプリに保存など）', value: 1 },
    { text: 'PDF で送る・保存する（拡大してもきれい・印刷向き）', value: 2 }];
  if (a && a.pages.length > 1) items.push({ text: `アルバム全部を 1 つの PDF で送る（${a.pages.length} ページ）`, value: 3 });
  const v = await dialog({ title: no + 'を送る・保存する', items });
  if (v === 1) sendPageImage(p, a, idx);
  else if (v === 2) sendPdf(pageName(a, idx), [p], pageName(a, idx));
  else if (v === 3) sendPdf(albumTitle(a), await loadPages(a), cleanName(albumTitle(a)));
}

async function sendAlbum(a) {
  if (!a.pages.length) { toast('まだページがありません'); return; }
  const v = await dialog({
    title: `アルバム「${albumTitle(a)}」を送る・保存する`,
    items: [{ text: `全部のページを 1 つの PDF で送る（${a.pages.length} ページ）`, value: 1 },
      { text: '1 ページ目を画像で送る（LINE などですぐ見える）', value: 2 }]
  });
  if (v === 1) sendPdf(albumTitle(a), await loadPages(a), cleanName(albumTitle(a)));
  else if (v === 2) { const p = await S.loadPage(a.pages[0]); if (p) sendPageImage(p, a, 0); }
}

// ---- アルバムの中（ページの一覧） ----

let curAlbum = null;

async function showAlbum(id) {
  const a = await S.loadAlbum(id);
  if (!a) { toast('アルバムを読めませんでした'); showList(); return; }
  curAlbum = a;
  const token = ++listToken;
  revokeAll();
  const scr = $('scr-album');
  scr.textContent = '';
  const head = el('div', 'head');
  head.style.paddingLeft = '4px';
  const title = el('div', 'title', a.title || '（名前なし）');
  title.onclick = async () => {
    const nm = await askText({ title: 'アルバムの名前', value: a.title });
    if (nm == null) return;
    a.title = nm.trim() || dateName();
    await S.saveAlbum(a);
    C.request();
    title.textContent = a.title;
  };
  head.append(btn('＜', () => showList(), 'plain'), title, btn('＋ ページを足す', () => addPage(a), 'gold add'));
  head.firstChild.style.fontSize = '22px';
  const box = el('div', 'box');
  scr.append(head, box);
  show('scr-album');
  if (!a.pages.length) {
    box.appendChild(el('div', 'empty-msg', 'このアルバムには、まだページがありません。\n右上の「＋ ページを足す」で、最初のページを作ってください。\n\n'
      + 'ページには、写真（カメラで撮る・写真から選ぶ）、文字、手書き、線、矢印、日付を、好きな所に置けます。\n\n'
      + '上のアルバムの名前をタップすると、名前を変えられます。'));
    return;
  }
  const grid = el('div', 'grid');
  box.appendChild(grid);
  for (let i = 0; i < a.pages.length; i++) {
    const pid = a.pages[i];
    const p = await S.loadPage(pid);
    if (token !== listToken) return;
    const card = el('div', 'card');
    const pic = el('div', 'pic empty'); pic.dataset.msg = p ? '' : '読めません';
    card.append(pic, el('div', 'name', `${i + 1} ページ`), el('div', 'sub', p ? mdhm(p.updated) : ''));
    const more = el('button', 'more', '︙');
    more.type = 'button';
    more.onclick = e => { e.stopPropagation(); pageMenu(a, pid); };
    card.appendChild(more);
    card.onclick = () => openEditor(a.id, pid);
    grid.appendChild(card);
    if (p) fillThumb(pic, pid, token);
  }
}

async function addPage(a) {
  const v = await dialog({ title: 'ページの形', items: [{ text: '縦長（A4 の形）', value: 1 }, { text: '横長（A4 の形）', value: 2 }, { text: '正方形', value: 3 }] });
  if (!v) return;
  const [pw, ph] = v === 1 ? [1000, 1414] : v === 2 ? [1414, 1000] : [1000, 1000];
  const p = await S.createPage(pw, ph);
  p.bg = a.bg;
  await S.savePage(p);
  a.pages.push(p.id);
  await S.saveAlbum(a);
  openEditor(a.id, p.id);
}

async function pageMenu(a, pid) {
  const pos = a.pages.indexOf(pid), count = a.pages.length;
  const items = [{ text: '開く', value: 'open' }, { text: '送る・保存する（LINE・メール・ファイルなど）', value: 'send' },
    { text: '複製する（すぐ後ろに足す）', value: 'dup' }];
  if (pos > 0) items.push({ text: '前へ動かす', value: 'up' });
  if (pos < count - 1) items.push({ text: '後ろへ動かす', value: 'down' });
  items.push({ text: '削除する', value: 'del' });
  const v = await dialog({ title: `${pos + 1} ページ`, items });
  if (v === 'open') openEditor(a.id, pid);
  else if (v === 'send') { const p = await S.loadPage(pid); if (p) sendPageMenu(p, a); }
  else if (v === 'dup') {
    const src = await S.loadPage(pid);
    if (!src) return;
    const p = await S.createPage(src.pw, src.ph);
    p.bg = src.bg;
    p.items = src.items.map(it => it.copy());
    await S.savePage(p);
    a.pages.splice(pos + 1, 0, p.id);
    await S.saveAlbum(a);
    C.request();
    showAlbum(a.id);
  } else if (v === 'up' || v === 'down') {
    const to = pos + (v === 'up' ? -1 : 1);
    a.pages.splice(pos, 1);
    a.pages.splice(to, 0, pid);
    await S.saveAlbum(a);
    C.request();
    showAlbum(a.id);
  } else if (v === 'del') {
    const ok = await confirmDlg(`${pos + 1} ページを削除しますか？\n（元に戻せません。写真アプリの写真は消えません）`, '削除する', '削除');
    if (!ok) return;
    a.pages = a.pages.filter(x => x !== pid);
    await S.saveAlbum(a);
    await S.deletePage(pid);
    C.markDeletedPage(pid);
    S.cleanup();
    showAlbum(a.id);
  }
}

// ---- ページの編集 ----

const E = { pv: null, page: null, album: null, undo: [], redo: [], dirty: false, timer: 0, viewing: false, widthIdx: 1, land: null, tool: 0 };
const mid = el('div');
mid.id = 'ed-mid';
const pageCv = el('canvas');
pageCv.id = 'page-cv';
const selbar = el('div');
selbar.id = 'selbar';
mid.append(pageCv, selbar);

const ctl = {};
function makeControls() {
  ctl.bBack = btn('＜ 一覧', () => closeEditor());
  ctl.bMode = btn('', () => setViewing(!E.viewing), 'mode');
  ctl.bFit = btn('画面に\n合わせる', () => E.pv.resetZoom(), 'frame');
  ctl.bFill = btn('⤢\n大きく', () => { if (E.pv.toggleFill()) toast('2 本指でページを動かせます（もう一度押すと全体）'); });
  ctl.bSend = btn('送る', () => sendFromEditor());
  ctl.bUndo = btn('↶ 戻す', doUndo);
  ctl.bRedo = btn('↷ やり直す', doRedo);
  ctl.bMenu = btn('︙', editMenu);
  ctl.bMenu.style.fontSize = '22px';
  ctl.tools = ['選ぶ', '写真', '文字', '手書き', '線', '矢印', '日付'].map((t, i) => btn(t, () => onTool(i)));
  ctl.swatches = COLORS.map(c => {
    const b = el('button', 'swatch');
    b.type = 'button';
    b.style.setProperty('--c', css(c));
    b.onclick = () => setColor(c);
    b.col = c;
    return b;
  });
  ctl.bWidth = btn('太さ 中', () => { E.widthIdx = (E.widthIdx + 1) % 3; applyWidth(true); });
  ctl.bOutline = btn('縁 なし', () => setOutline(!E.pv.outline, true));
  ctl.hint = el('div', 'hint');
  ctl.bAll = btn('画面に合わせる', () => E.pv.resetZoom());
  ctl.bEdit = btn('✎ 編集する', () => setViewing(false), 'gold');
}

/** 縦向き: 上の帯・ページ・下に道具。横向き: 左の列・ページ・右の列（道具と色） */
function layoutEdit() {
  const land = isLand();
  E.land = land;
  const scr = $('scr-edit');
  scr.textContent = '';
  scr.classList.toggle('land', land);
  const c = ctl;
  const row = el('div', 'row');
  if (!land) {
    const top = el('div', 'etop');
    for (const b of [c.bBack, c.bMode, c.bFit, c.bSend, c.bUndo, c.bRedo, c.bMenu]) b.style.flex = '';
    c.bFit.className = 'btn frame';
    top.append(c.bBack, c.bMode, el('div', 'sp'), c.bFit, c.bSend, c.bUndo, c.bRedo, c.bMenu);
    row.appendChild(mid);
    const panel = el('div', 'epanel');
    const tools = el('div', 'tools');
    tools.append(...c.tools);
    const colors = el('div', 'colors');
    colors.append(...c.swatches, c.bWidth, c.bOutline);
    panel.append(tools, colors);
    const vp = el('div', 'vpanel');
    c.hint.textContent = '2 本指で拡大・縮小\n2 回タップで拡大 ⇔ 全体';
    vp.append(c.hint, c.bAll, c.bEdit);
    scr.append(top, row, panel, vp);
    E.panel = panel; E.vpanel = vp;
    vis(c.bFill, false);
  } else {
    const left = el('div', 'eleft');
    c.bFit.className = 'btn';
    left.append(c.bBack, c.bMode, c.bFit, c.bFill, c.bSend, c.bUndo, c.bRedo, c.bMenu);
    const right = el('div', 'eright');
    const tools = el('div', 'tools');
    tools.append(...c.tools);
    const colors = el('div', 'colors');
    colors.append(...c.swatches);
    const wo = el('div', 'wo');
    wo.append(c.bWidth, c.bOutline);
    right.append(tools, colors, wo);
    const vr = el('div', 'vright');
    c.hint.textContent = '2 本指で\n大きく・小さく\n\n1 本指で動かす\n\n2 回タップで\n拡大 ⇔ 全体';
    vr.append(c.hint, c.bAll, c.bEdit);
    row.append(left, mid, right, vr);
    scr.appendChild(row);
    E.panel = right; E.vpanel = vr;
    vis(c.bFill, true);
  }
  c.bUndo.textContent = land ? '↶\n戻す' : '↶ 戻す';
  c.bRedo.textContent = land ? '↷\nやり直す' : '↷ やり直す';
  c.bBack.textContent = land ? '＜\n一覧' : '＜ 一覧';
  setViewing(E.viewing);
}

const ro = new ResizeObserver(() => { if (E.pv) E.pv.resize(); });
ro.observe(mid);

async function openEditor(albumId, pageId) {
  const a = await S.loadAlbum(albumId), p = await S.loadPage(pageId);
  if (!p) { toast('ページを読めませんでした'); return; }
  if (!ctl.bBack) makeControls();
  E.album = a; E.page = p; E.undo = []; E.redo = []; E.dirty = false;
  if (!E.pv) {
    E.pv = new PageView(pageCv, {
      beforeChange, onChanged,
      onSelection, onGroup,
      onTextTap,
      onPending: updateUndo
    });
  }
  const pv = E.pv;
  pv.setPage(p);
  pv.tool = SELECT;
  pv.outline = S.settings().outline;
  E.widthIdx = 1;
  pv.penW = PEN_W[1]; pv.lineW = LINE_W[1];
  if (!COLORS.includes(pv.color)) pv.color = COLORS[0];
  E.viewing = p.items.length > 0;
  show('scr-edit');
  layoutEdit();
  paintTools(0);
  paintColors();
  applyWidth(false);
  setOutline(pv.outline, false);
  onSelection(null);
  updateUndo();
  requestAnimationFrame(() => pv.resize());
}

function setViewing(v) {
  const pv = E.pv, c = ctl;
  E.viewing = v;
  if (v) { pv.commitInk(); pv.select(null); }
  pv.viewMode = v;
  vis(E.panel, !v);
  vis(E.vpanel, v);
  vis(c.bFit, !v);
  vis(c.bSend, v);
  vis(c.bUndo, !v);
  vis(c.bRedo, !v);
  c.bMode.textContent = v ? '閲覧中' : '編集中';
  c.bMode.style.background = v ? '#8EC5E8' : '#FFC94D';
  pv.invalidate();
}

function paintTools(n) {
  E.tool = n;
  ctl.tools.forEach((b, i) => b.classList.toggle('on', i === n));
}

function onTool(n) {
  const pv = E.pv;
  if (n !== 3) pv.commitInk();
  if (n === 1) { photoMenu(); return; }
  if (n === 6) { dateMenu(); return; }
  const tool = n === 0 ? SELECT : n === 2 ? TEXT_T : n === 3 ? PEN : n === 4 ? LINE_T : ARROW;
  pv.tool = tool;
  if (tool !== SELECT) pv.select(null);
  paintTools(n);
  if (tool === TEXT_T) toast('文字を入れたい所をタップしてください');
  updateUndo();
}

function setTool(tool) { onTool(tool === SELECT ? 0 : tool === TEXT_T ? 2 : tool === PEN ? 3 : tool === LINE_T ? 4 : 5); }

function paintColors() { for (const b of ctl.swatches) b.classList.toggle('on', b.col === E.pv.color); }

function setColor(col) {
  const pv = E.pv;
  pv.color = col;
  paintColors();
  const s = pv.sel;
  if (s && s.type !== PHOTO && s.color !== col) {
    beforeChange();
    s.color = col;
    s.textChanged();
    onChanged();
  }
  if (pv.group.some(it => it.type !== PHOTO && it.color !== col)) {
    beforeChange();
    for (const it of pv.group) if (it.type !== PHOTO) { it.color = col; it.textChanged(); }
    onChanged();
  }
  pv.invalidate();
}

function setOutline(on, toSelected) {
  const pv = E.pv;
  pv.outline = on;
  S.setSettings({ outline: on });
  ctl.bOutline.textContent = on ? '縁 あり' : '縁 なし';
  ctl.bOutline.classList.toggle('on', on);
  const s = pv.sel;
  if (toSelected && s && s.type !== PHOTO && s.outline !== on) {
    beforeChange();
    s.outline = on;
    onChanged();
    onSelection(s);
  }
  if (toSelected && pv.group.length) { groupOutline(on); return; }
  if (toSelected && !s) toast(on ? 'これから書く文字・手書き・線・矢印に、白い縁取りをつけます' : '縁取りをやめました');
  pv.invalidate();
}

function applyWidth(toSelected) {
  const pv = E.pv, w = E.widthIdx;
  pv.penW = PEN_W[w]; pv.lineW = LINE_W[w];
  ctl.bWidth.textContent = '太さ ' + WIDTH_NAMES[w];
  const fix = it => { it.size = it.type === LINE ? LINE_W[w] : PEN_W[w]; };
  const s = pv.sel;
  if (toSelected && s && (s.type === LINE || s.type === INK)) { beforeChange(); fix(s); onChanged(); }
  if (toSelected && pv.group.some(it => it.type === LINE || it.type === INK)) {
    beforeChange();
    for (const it of pv.group) if (it.type === LINE || it.type === INK) fix(it);
    onChanged();
  }
  pv.invalidate();
}

// ---- 元に戻す・保存 ----

function beforeChange() {
  E.undo.push(E.page.itemsJson());
  while (E.undo.length > 60) E.undo.shift();
  E.redo = [];
  updateUndo();
}

function onChanged() {
  E.page.updated = Date.now();
  E.dirty = true;
  E.pv.invalidate();
  clearTimeout(E.timer);
  E.timer = setTimeout(savePage, 800);
  updateUndo();
}

async function savePage() {
  clearTimeout(E.timer);
  if (!E.page) return;
  try { await S.savePage(E.page); } catch (e) { toast('保存できませんでした: ' + e.message, true); }
}

function doUndo() {
  const pv = E.pv;
  if (pv.hasPending()) { pv.undoPendingStroke(); updateUndo(); return; }
  if (!E.undo.length) return;
  E.redo.push(E.page.itemsJson());
  E.page.setItemsJson(E.undo.pop());
  pv.select(null);
  onChanged();
}

function doRedo() {
  if (!E.redo.length) return;
  E.undo.push(E.page.itemsJson());
  E.page.setItemsJson(E.redo.pop());
  E.pv.select(null);
  onChanged();
}

function updateUndo() {
  if (!ctl.bUndo || !E.pv) return;
  ctl.bUndo.classList.toggle('dim', !E.undo.length && !E.pv.hasPending());
  ctl.bRedo.classList.toggle('dim', !E.redo.length);
}

/** 書き終えたもの（小さな絵も）を保存する */
async function flushEditor() {
  if (!E.page) return;
  E.pv.commitInk();
  await savePage();
  if (E.dirty || !(await S.loadThumb(E.page.id))) {
    E.dirty = false;
    try { await makeThumb(E.page); } catch (e) { /* 一覧を開いたときに作る */ }
  }
}

async function closeEditor() {
  const a = E.album;
  await flushEditor();
  E.page = null;
  E.pv.setPage(null);
  R.clearCache();
  C.request();
  if (a) showAlbum(a.id); else showList();
}

// ---- 選んだ物の操作（ページの上の帯） ----

function selBtn(t, fn) { return btn(t, fn, t === '削除' ? 'del' : ''); }

function onSelection(s) {
  selbar.textContent = '';
  if (!s) return;
  const page = E.page, pv = E.pv;
  selbar.append(
    selBtn('削除', () => { beforeChange(); page.items.splice(page.items.indexOf(s), 1); pv.select(null); onChanged(); }),
    selBtn('複製', () => { beforeChange(); const c = s.copy(); c.move(page.pw * 0.04, page.pw * 0.04); page.items.push(c); pv.select(c); onChanged(); }),
    selBtn('前へ', () => {
      const i = page.items.indexOf(s);
      if (i < 0 || i === page.items.length - 1) return;
      beforeChange(); page.items.splice(i, 1); page.items.splice(i + 1, 0, s); onChanged();
    }),
    selBtn('後ろへ', () => {
      const i = page.items.indexOf(s);
      if (i <= 0) return;
      beforeChange(); page.items.splice(i, 1); page.items.splice(i - 1, 0, s); onChanged();
    }));
  if (s.type === PHOTO) {
    selbar.append(selBtn('切り抜く', () => openCrop(s, false)),
      selBtn(s.frame ? '枠をなくす' : '枠をつける', () => { beforeChange(); s.frame = !s.frame; onChanged(); onSelection(s); }));
  }
  if (s.type === TEXT) {
    selbar.append(selBtn('文字を直す', () => onTextTap(s, s.cx, s.cy)),
      selBtn(s.fill ? '帯をなくす' : '帯をつける', () => { beforeChange(); s.fill = !s.fill; onChanged(); onSelection(s); }));
  }
  if (s.type !== PHOTO) {
    selbar.append(selBtn(s.outline ? '縁をなくす' : '縁をつける', () => { beforeChange(); s.outline = !s.outline; onChanged(); onSelection(s); }));
  }
  if (s.type !== LINE) selbar.append(selBtn('まっすぐ', () => { beforeChange(); s.r = 0; onChanged(); }));
}

function groupOutline(on) {
  beforeChange();
  for (const it of E.pv.group) if (it.type !== PHOTO) it.outline = on;
  onChanged();
  onGroup(E.pv.group);
}

function onGroup(g) {
  selbar.textContent = '';
  const gs = g.slice(), page = E.page, pv = E.pv;
  const keep = () => page.items.filter(it => gs.includes(it));
  selbar.append(el('div', 'count', gs.length + ' 個'),
    selBtn('削除', () => { beforeChange(); page.items = page.items.filter(it => !gs.includes(it)); pv.select(null); onChanged(); }),
    selBtn('複製', () => {
      beforeChange();
      const cs = keep().map(it => { const c = it.copy(); c.move(page.pw * 0.04, page.pw * 0.04); return c; });
      page.items.push(...cs);
      pv.setGroup(cs);
      onChanged();
    }),
    selBtn('一番前へ', () => { beforeChange(); const k = keep(); page.items = page.items.filter(it => !gs.includes(it)).concat(k); onChanged(); }),
    selBtn('一番後ろへ', () => { beforeChange(); const k = keep(); page.items = k.concat(page.items.filter(it => !gs.includes(it))); onChanged(); }));
  const others = gs.filter(it => it.type !== PHOTO);
  if (others.length) {
    const to = !others.every(it => it.outline);
    selbar.append(selBtn(to ? '縁をつける' : '縁をなくす', () => groupOutline(to)));
  }
  selbar.append(selBtn('選ぶのをやめる', () => pv.select(null)));
}

// ---- 文字・日付 ----

function placeText(t, x, y) {
  const page = E.page, pv = E.pv;
  beforeChange();
  const it = new Item();
  it.type = TEXT;
  it.text = t;
  it.color = (pv.color === (0xFFFFFFFF | 0) && page.bg === (0xFFFFFFFF | 0)) ? (0xFF222222 | 0) : pv.color;
  it.size = 56;
  it.outline = pv.outline;
  it.textChanged();
  const maxW = page.pw * 0.94;
  if (it.w > maxW) it.s = maxW / it.w;
  const hw = it.w * it.s / 2, hh = it.h * it.s / 2;
  it.cx = Math.max(hw, Math.min(page.pw - hw, x));
  it.cy = Math.max(hh, Math.min(page.ph - hh, y));
  page.items.push(it);
  setTool(SELECT);
  pv.select(it);
  onChanged();
}

async function onTextTap(existing, px, py) {
  const pv = E.pv;
  const cb = check('白い縁取り（写真の上でも読みやすい）', existing ? existing.outline : pv.outline);
  const v = await askText({
    title: existing ? '文字を直す' : '文字を入れる',
    value: existing ? existing.text : '',
    hint: 'ここに文字（キーボードのマイクで声でも入れられます）',
    multi: true, extra: cb,
    quick: [{ text: '＋ 今日の日付', value: today }, { text: '＋ 今の時刻', value: nowTime }]
  });
  if (v == null || !E.page) return;
  const t = v.replace(/\s+$/, '');
  const ol = isIPad() ? (existing ? existing.outline : pv.outline) : cb.input.checked;
  if (!existing) {
    if (ol !== pv.outline) setOutline(ol, false);
    if (t) placeText(t, px, py);
    return;
  }
  if (t === existing.text && ol === existing.outline) return;
  beforeChange();
  if (!t) {
    E.page.items.splice(E.page.items.indexOf(existing), 1);
    pv.select(null);
  } else {
    existing.text = t;
    existing.outline = ol;
    existing.textChanged();
    pv.select(existing);
  }
  onChanged();
}

async function dateMenu() {
  const d = new Date();
  const vals = [today(), nowTime(), today() + ' ' + nowTime(),
    `${d.getFullYear()}/${two(d.getMonth() + 1)}/${two(d.getDate())}`, `${d.getMonth() + 1}月${d.getDate()}日`];
  const v = await dialog({ title: '日付・時刻を入れる', items: vals.map(t => ({ text: t, value: t })) });
  if (v == null) return;
  const c = E.pv.center();
  placeText(v, c[0], c[1]);
}

// ---- 写真 ----

const pickIn = $('pick'), camIn = $('cam');

/** 写真を入れる箱。ファイルを選ぶ画面は、ボタンを押したその場で開かないと iPhone で開かないので、箱の中のボタンから直接開く */
function photoMenu() {
  const on = S.settings().cropOnImport;
  const body = el('div');
  body.style.display = 'flex';
  body.style.flexDirection = 'column';
  const close = () => { const b = document.querySelector('.dlg-back'); if (b && b.closeWith) b.closeWith(null); };
  const b1 = btn('📷 カメラで撮る', () => { camIn.value = ''; camIn.click(); close(); }, 'wide');
  const b2 = btn('🖼 写真を選ぶ（何枚でも）', () => { pickIn.value = ''; pickIn.click(); close(); }, 'wide gold');
  const b3 = btn(`入れたらすぐ切り抜く: ${on ? 'する ✓' : 'しない'}（押すと切り替え）`, () => {
    S.setSettings({ cropOnImport: !on });
    toast(!on ? '写真を入れたら、すぐ切り抜きの画面を出します' : '入れたときの切り抜きをやめました');
    close();
    setTimeout(photoMenu, 50);
  }, 'wide');
  b3.style.fontSize = '14px';
  body.append(b1, b2, b3);
  dialog({ title: '写真を入れる', body });
}

async function importFiles(files) {
  files = Array.from(files || []).filter(f => !f.type || f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|gif|webp)$/i.test(f.name));
  if (!files.length || !E.page) return;
  const b = busy(`${files.length} 枚の写真を入れています…`);
  const got = [];
  let fail = 0;
  for (let i = 0; i < files.length; i++) {
    b.set(`写真を入れています ${i + 1} / ${files.length}`);
    try { got.push(await S.importPhoto(files[i])); } catch (e) { fail++; }
  }
  b.close();
  addPhotos(got, fail);
}
pickIn.addEventListener('change', () => importFiles(pickIn.files));
camIn.addEventListener('change', () => importFiles(camIn.files));

async function addPhotos(list, fail) {
  if (fail > 0) toast(fail + ' 枚は読めませんでした', true);
  if (!list.length || !E.page) return;
  const page = E.page, pv = E.pv;
  beforeChange();
  const n = list.length, added = [];
  let cols = n === 1 ? 1 : n <= 4 ? 2 : 3;
  if (page.pw > page.ph * 1.2 && n > 1) cols = Math.min(n, cols + 1);
  const rows = Math.ceil(n / cols);
  const cw = page.pw * (n === 1 ? 0.65 : 0.92) / cols, ch = page.ph * (n === 1 ? 0.6 : 0.86) / rows;
  list.forEach((ph, i) => {
    const it = new Item();
    it.type = PHOTO;
    it.file = ph.name;
    const asp = ph.w > 0 ? ph.h / ph.w : 0.75;
    const fw = cw * 0.84, fh = ch * 0.84;
    it.w = Math.min(fw, fh / asp);
    it.h = it.w * asp;
    const c = i % cols, r = Math.floor(i / cols), inRow = Math.min(cols, n - r * cols);
    it.cx = page.pw / 2 + (c - (inRow - 1) / 2) * cw;
    it.cy = page.ph / 2 + (r - (rows - 1) / 2) * ch;
    it.r = n === 1 ? 0 : (i % 2 === 0 ? -2 : 2);
    page.items.push(it);
    added.push(it);
  });
  if (E.viewing) setViewing(false);
  setTool(SELECT);
  pv.select(added[added.length - 1]);
  onChanged();
  if (S.settings().cropOnImport) {
    for (const it of added) { pv.select(it); await openCrop(it, true); }
    return;
  }
  if (n > 1) toast('写真を指で動かしたり、角の丸で大きさを変えたりできます');
}

// ---- 切り抜き ----

/** 写真の切り抜きの画面。閉じたら解決する。keepSize: 入れたときの切り抜き（切り抜いたあとも、元の枠いっぱいの大きさ） */
async function openCrop(it, keepSize) {
  const bmp = await R.getBitmap(it.file, 1600);
  if (!bmp) { toast('写真を読めませんでした'); return; }
  return new Promise(done => {
    const st = { cl: it.cl, ct: it.ct, cr: it.cr, cb: it.cb, aspect: 0 };
    const scr = $('scr-crop');
    scr.textContent = '';
    const cmid = el('div'); cmid.id = 'crop-mid';
    const cv = el('canvas'); cv.id = 'crop-cv';
    cmid.appendChild(cv);
    const text = el('div', 'ctext');
    const names = ['自由', '正方形', '4:3', '3:4', '16:9', '元の写真'], vals = [0, 1, 4 / 3, 3 / 4, 16 / 9, -1];
    const ratios = el('div', 'ratios');
    const rbs = names.map((nm, i) => btn(nm, () => {
      if (vals[i] < 0) { st.cl = st.ct = 0; st.cr = st.cb = 1; st.aspect = 0; } else setAspect(vals[i]);
      rbs.forEach((b, j) => b.classList.toggle('on', j === (vals[i] < 0 ? 0 : i)));
      draw();
    }));
    rbs[0].classList.add('on');
    ratios.append(...rbs);
    const cbtns = el('div', 'cbtns');
    const finish = okd => {
      window.removeEventListener('resize', onRs);
      ro2.disconnect();
      if (okd) {
        const changed = Math.abs(st.cl - it.cl) + Math.abs(st.ct - it.ct) + Math.abs(st.cr - it.cr) + Math.abs(st.cb - it.cb) > 0.0005;
        if (changed && E.page && E.page.items.includes(it)) {
          beforeChange();
          const bw = it.w * it.s, bh = it.h * it.s, ox = it.cx, oy = it.cy;
          it.applyCrop(st.cl, st.ct, st.cr, st.cb);
          if (keepSize) { it.s = it.clampScale(Math.min(bw / it.w, bh / it.h)); it.cx = ox; it.cy = oy; }
          onChanged();
        }
      }
      scr.textContent = '';
      show('scr-edit');
      E.pv.resize();
      done();
    };
    cbtns.append(btn('やめる', () => finish(false)), btn('決定', () => finish(true), 'gold'));

    let land = null;
    const lay = () => {
      const l = isLand();
      if (l === land) return;
      land = l;
      scr.textContent = '';
      scr.classList.toggle('land', l);
      if (l) {
        text.textContent = '切り抜く\n黄色い角や辺を引っぱります';
        text.style.whiteSpace = 'pre-line';
        const side = el('div', 'side');
        side.append(text, ratios, cbtns);
        scr.append(cmid, side);
      } else {
        text.textContent = '切り抜く ― 黄色い角や辺を引っぱって、残す所を決めます';
        scr.append(text, cmid, ratios, cbtns);
      }
    };
    const onRs = () => lay();
    window.addEventListener('resize', onRs);
    lay();
    show('scr-crop');

    // 描く
    let W = 0, H = 0, dpr = 1, img = { l: 0, t: 0, w: 1, h: 1 };
    const fitCv = () => {
      const r = cv.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      W = r.width; H = r.height;
      cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
      const m = 22, k = Math.min((W - 2 * m) / bmp.width, (H - 2 * m) / bmp.height);
      const w = bmp.width * k, h = bmp.height * k;
      img = { l: (W - w) / 2, t: (H - h) / 2, w, h };
      draw();
    };
    const sx = v => img.l + v * img.w, sy = v => img.t + v * img.h;
    function draw() {
      const c = cv.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = '#1E1A24';
      c.fillRect(0, 0, W, H);
      if (W < 10) return;
      c.imageSmoothingQuality = 'high';
      c.drawImage(bmp, img.l, img.t, img.w, img.h);
      const L = sx(st.cl), T = sy(st.ct), Rr = sx(st.cr), Bb = sy(st.cb);
      c.fillStyle = 'rgba(0,0,0,0.67)';
      c.beginPath();
      c.rect(img.l, img.t, img.w, img.h);
      c.rect(L, T, Rr - L, Bb - T);
      c.fill('evenodd');
      c.strokeStyle = 'rgba(255,255,255,0.53)';
      c.lineWidth = 1;
      c.beginPath();
      for (let i = 1; i < 3; i++) {
        const x = L + (Rr - L) * i / 3, y = T + (Bb - T) * i / 3;
        c.moveTo(x, T); c.lineTo(x, Bb); c.moveTo(L, y); c.lineTo(Rr, y);
      }
      c.stroke();
      c.strokeStyle = '#fff'; c.lineWidth = 2;
      c.strokeRect(L, T, Rr - L, Bb - T);
      c.strokeStyle = '#FFC94D'; c.lineWidth = 5; c.lineCap = 'butt';
      const k = 22;
      c.beginPath();
      for (const [x, y, dx, dy] of [[L, T, 1, 1], [Rr, T, -1, 1], [L, Bb, 1, -1], [Rr, Bb, -1, -1]]) {
        c.moveTo(x + dx * k, y); c.lineTo(x, y); c.lineTo(x, y + dy * k);
      }
      const mx = (L + Rr) / 2, my = (T + Bb) / 2, hm = 12;
      c.moveTo(mx - hm, T); c.lineTo(mx + hm, T); c.moveTo(mx - hm, Bb); c.lineTo(mx + hm, Bb);
      c.moveTo(L, my - hm); c.lineTo(L, my + hm); c.moveTo(Rr, my - hm); c.lineTo(Rr, my + hm);
      c.stroke();
    }
    function setAspect(a) {
      st.aspect = a;
      const bw = bmp.width, bh = bmp.height;
      const mx = (st.cl + st.cr) / 2 * bw, my = (st.ct + st.cb) / 2 * bh;
      let w = (st.cr - st.cl) * bw, h = (st.cb - st.ct) * bh;
      if (w / h > a) w = h * a; else h = w / a;
      const maxW = Math.min(mx, bw - mx) * 2, maxH = Math.min(my, bh - my) * 2;
      if (w > maxW) { w = maxW; h = w / a; }
      if (h > maxH) { h = maxH; w = h * a; }
      st.cl = (mx - w / 2) / bw; st.cr = (mx + w / 2) / bw;
      st.ct = (my - h / 2) / bh; st.cb = (my + h / 2) / bh;
    }
    // 指
    let mode = 0, eL = false, eT = false, eR = false, eB = false, lx = 0, ly = 0, pid = null;
    const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    cv.addEventListener('pointerdown', e => {
      if (pid !== null) return;
      e.preventDefault();
      pid = e.pointerId;
      try { cv.setPointerCapture(pid); } catch (x) { /* なくてよい */ }
      const [x, y] = pos(e), tol = 28;
      const L = sx(st.cl), T = sy(st.ct), Rr = sx(st.cr), Bb = sy(st.cb);
      const inY = y > T - tol && y < Bb + tol, inX = x > L - tol && x < Rr + tol;
      eL = inY && Math.abs(x - L) < tol;
      eR = inY && Math.abs(x - Rr) < tol && !eL;
      eT = inX && Math.abs(y - T) < tol;
      eB = inX && Math.abs(y - Bb) < tol && !eT;
      mode = (eL || eR || eT || eB) ? 2 : (x > L && x < Rr && y > T && y < Bb) ? 1 : 0;
      lx = x; ly = y;
    });
    cv.addEventListener('pointermove', e => {
      if (e.pointerId !== pid) return;
      e.preventDefault();
      const [x, y] = pos(e);
      let dx = (x - lx) / img.w, dy = (y - ly) / img.h;
      lx = x; ly = y;
      const min = 0.05;
      if (mode === 1) {
        dx = Math.max(-st.cl, Math.min(1 - st.cr, dx));
        dy = Math.max(-st.ct, Math.min(1 - st.cb, dy));
        st.cl += dx; st.cr += dx; st.ct += dy; st.cb += dy;
      } else if (mode === 2) {
        if (eL) st.cl = Math.max(0, Math.min(st.cr - min, st.cl + dx));
        if (eR) st.cr = Math.min(1, Math.max(st.cl + min, st.cr + dx));
        if (eT) st.ct = Math.max(0, Math.min(st.cb - min, st.ct + dy));
        if (eB) st.cb = Math.min(1, Math.max(st.ct + min, st.cb + dy));
        if (st.aspect > 0) keepAspect();
      }
      draw();
    });
    const up = e => { if (e.pointerId === pid) { pid = null; mode = 0; } };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    function keepAspect() {
      const bw = bmp.width, bh = bmp.height, a = st.aspect;
      const w = (st.cr - st.cl) * bw, h = (st.cb - st.ct) * bh;
      const byWidth = ((eL || eR) && !(eT || eB)) || ((eL || eR) && w / h > a);
      if (byWidth) {
        const nh = w / a / bh;
        if (eT) st.ct = st.cb - nh; else if (eB) st.cb = st.ct + nh;
        else { const m = (st.ct + st.cb) / 2; st.ct = m - nh / 2; st.cb = m + nh / 2; }
      } else {
        const nw = h * a / bw;
        if (eL) st.cl = st.cr - nw; else if (eR) st.cr = st.cl + nw;
        else { const m = (st.cl + st.cr) / 2; st.cl = m - nw / 2; st.cr = m + nw / 2; }
      }
      if (st.cl < 0 || st.ct < 0 || st.cr > 1 || st.cb > 1) {
        let cw = st.cr - st.cl, ch = st.cb - st.ct, sx2 = 1, sy2 = 1;
        if (cw > 1) sx2 = 1 / cw;
        if (ch > 1) sy2 = 1 / ch;
        const s = Math.min(sx2, sy2);
        cw *= s; ch *= s;
        const mx = Math.max(cw / 2, Math.min(1 - cw / 2, (st.cl + st.cr) / 2));
        const my = Math.max(ch / 2, Math.min(1 - ch / 2, (st.ct + st.cb) / 2));
        st.cl = mx - cw / 2; st.cr = mx + cw / 2; st.ct = my - ch / 2; st.cb = my + ch / 2;
      }
    }
    const ro2 = new ResizeObserver(() => fitCv());
    ro2.observe(cmid);
  });
}

// ---- ︙ のメニュー・送る・紙の色 ----

async function editMenu() {
  E.pv.commitInk();
  const v = await dialog({ items: [{ text: '送る・保存する（LINE・メール・写真アプリ・ファイルなど）', value: 1 }, { text: '背景の色（紙の色）を選ぶ', value: 2 }] });
  if (v === 1) sendFromEditor();
  else if (v === 2) paper();
}

async function sendFromEditor() {
  E.pv.commitInk();
  await savePage();
  const a = E.album ? await S.loadAlbum(E.album.id) : null;
  sendPageMenu(E.page, a);
}

function paper() {
  const page = E.page, a = E.album;
  const body = el('div');
  const grid = el('div', 'papers');
  const all = check('このアルバムの全ページをこの色にする（これから足すページも）', false);
  all.style.fontSize = '14px';
  PAPER.forEach((col, i) => {
    const b = el('button', 'paper' + (col === page.bg ? ' on' : ''));
    b.type = 'button';
    const dot = el('i');
    dot.style.setProperty('--c', css(col));
    b.append(dot, el('span', null, PAPER_NAMES[i]));
    b.onclick = () => {
      page.bg = col;
      onChanged();
      if (all.input.checked && a) paperAll(a.id, col);
      const bk = document.querySelector('.dlg-back');
      if (bk && bk.closeWith) bk.closeWith(null);
    };
    grid.appendChild(b);
  });
  body.appendChild(grid);
  if (a) body.appendChild(all);
  dialog({ title: '背景の色（紙の色）', body });
}

async function paperAll(albumId, col) {
  const a = await S.loadAlbum(albumId);
  if (!a) return;
  a.bg = col;
  await S.saveAlbum(a);
  if (E.album && E.album.id === albumId) E.album.bg = col;
  for (const id of a.pages) {
    if (E.page && id === E.page.id) continue;
    const p = await S.loadPage(id);
    if (!p || p.bg === col) continue;
    p.bg = col;
    p.updated = Date.now();
    await S.savePage(p);
    await S.deleteThumb(id);
  }
  toast('アルバムの全ページを同じ色にしました');
}

// ---- 保存・バックアップ ----

let scriptText = null;
function loadScript() {
  if (scriptText) return;
  fetch('Code.gs.txt', { cache: 'no-cache' }).then(r => r.ok ? r.text() : null).then(t => { if (t) scriptText = t; }, () => {});
}

function showSettings() {
  const back = curScreen === 'scr-album' && curAlbum ? () => showAlbum(curAlbum.id) : () => showList();
  loadScript();
  const scr = $('scr-set');
  scr.textContent = '';
  const head = el('div', 'head');
  head.style.paddingLeft = '4px';
  const bb = btn('＜', back, 'plain');
  bb.style.fontSize = '22px';
  head.append(bb, el('div', 'title', '保存・バックアップ'));
  const box = el('div');
  box.id = 'set-box';
  scr.append(head, box);
  const sec = t => box.appendChild(el('div', 'section', t));
  const note = t => box.appendChild(el('div', 'note', t));
  const wide = (t, fn, gold) => box.appendChild(btn(t, fn, 'wide' + (gold ? ' gold' : '')));

  // ファイル
  sec('ファイルでバックアップ（準備いらず）');
  note('全部のアルバム（ページと写真）を 1 つのファイル（zip）にして保存します。出てきた画面で「ファイルに保存」を選び、'
    + '「Google ドライブ」や「iCloud Drive」を選ぶと、そこに入ります（Google ドライブは、Google ドライブのアプリを入れておくと選べます）。\n'
    + '読み込むと、Android 版で書き出したファイルからも戻せます。zip の中には、アルバムごとの見る用の PDF も入っています。');
  const last = S.settings().lastExport;
  const lastT = el('div', 'note', '最後に書き出した日時: ' + (last ? `${ymd(last)} ${new Date(last).getHours()}:${two(new Date(last).getMinutes())}` : 'まだありません'));
  box.appendChild(lastT);
  const fileRes = el('div', 'result');
  wide('書き出す（バックアップを取る）', async () => {
    const b = busy('書き出しています…');
    let r;
    try { r = await B.exportAll(m => b.set(m)); } catch (e) { b.close(); fileRes.textContent = '書き出せませんでした。\n' + e.message; return; }
    b.close();
    fileRes.textContent = `書き出しました。アルバム ${r.albums} 冊、ページ ${r.pages} ページ、写真 ${r.imgs} 枚（戻す用のデータと、アルバムごとの PDF）。`;
    lastT.textContent = '最後に書き出した日時: ' + `${ymd(Date.now())} ${new Date().getHours()}:${two(new Date().getMinutes())}`;
    await shareAfterWork(new File([r.blob], B.fileName(), { type: 'application/zip' }), '書き出しました');
  }, true);
  const zipIn = $('zipin');
  wide('読み込む（バックアップから戻す）', () => { zipIn.value = ''; zipIn.click(); });
  zipIn.onchange = async () => {
    const f = zipIn.files && zipIn.files[0];
    if (!f) return;
    fileRes.textContent = 'ファイルを調べています…';
    let pl;
    try { pl = await B.plan(f); } catch (e) { fileRes.textContent = '読み込めませんでした。\n' + e.message; return; }
    const info = `ファイルの中のアルバム: ${pl.albums.length} 冊（ここにもあるもの ${pl.localAlbums} 冊）\n`
      + `ファイルの中のページ: ${pl.inFile} ページ\n`
      + `ここにない・ファイルのほうが新しい: ${pl.pages.length} ページ\n`
      + `ここのほうが新しいか同じ（そのまま）: ${pl.newer} ページ`;
    const newAlbums = pl.albums.length - pl.localAlbums;
    if (!pl.pages.length && !newAlbums) { fileRes.textContent = info + '\n\n戻すものはありません。'; return; }
    const ok = await dialog({ title: `${pl.pages.length} ページを戻しますか?`, message: info + '\n\nここのアルバムは消えません（ないページを足します）。', buttons: [{ text: '戻す', value: true }] });
    if (!ok) { fileRes.textContent = ''; return; }
    const b = busy('戻しています…');
    try {
      const n = await B.apply(pl, m => b.set(m));
      fileRes.textContent = `${n} ページを戻しました。アルバムの一覧で見られます。`;
      C.request();
    } catch (e) {
      fileRes.textContent = '途中で失敗しました。もう一度読み込むと、残りを戻します。\n' + e.message;
    }
    b.close();
  };
  box.appendChild(fileRes);

  // クラウド
  sec('自動でクラウドに保存（Google Apps Script）');
  note('準備（下の「はじめての準備」）をすると、ページを書き終えて一覧に戻るたびに、自分の Google ドライブの「超！アルバム」フォルダへ自動で保存します。'
    + 'アルバムごとに、全部のページを 1 つにまとめた PDF（ファイルの名前はアルバムの名前）が入ります。\n'
    + 'Android 版で準備したスクリプトがあれば、同じ URL と合言葉を入れるだけで使えます（同じフォルダに入り、「クラウドから戻す」で Android 版のアルバムも見られます）。');
  const s = S.settings();
  box.appendChild(el('div', 'label', 'ウェブアプリの URL（/exec で終わるもの）'));
  const urlF = el('button', 'field');
  urlF.type = 'button';
  const showUrl = () => { const u = S.settings().url; urlF.textContent = u || 'https://script.google.com/macros/s/…/exec（タップして入れる）'; urlF.classList.toggle('empty', !u); };
  showUrl();
  urlF.onclick = () => {
    const v = window.prompt('ウェブアプリの URL（/exec で終わるもの）', S.settings().url);
    if (v == null) return;
    S.setSettings({ url: v.trim() });
    showUrl();
  };
  box.appendChild(urlF);
  box.appendChild(el('div', 'label', '合言葉（スクリプト プロパティの PASSWORD と同じもの）'));
  const keyF = el('button', 'field');
  keyF.type = 'button';
  let showKey = false;
  const paintKey = () => { const k = S.settings().key; keyF.textContent = k ? (showKey ? k : '●'.repeat(Math.min(12, k.length))) : '（タップして入れる）'; keyF.classList.toggle('empty', !k); };
  paintKey();
  keyF.onclick = () => {
    const v = window.prompt('合言葉', '');
    if (v == null || v === '') return;
    S.setSettings({ key: v.trim() });
    paintKey();
  };
  box.appendChild(keyF);
  const sk = check('合言葉を見せる', false);
  sk.input.onchange = () => { showKey = sk.input.checked; paintKey(); };
  box.appendChild(sk);
  const auto = check('書き終えたら自動でクラウドに保存する', s.auto);
  auto.input.onchange = () => { S.setSettings({ auto: auto.input.checked }); C.request(); };
  box.appendChild(auto);
  const res = el('div', 'result');
  wide('保存して、つながるか試す', async () => {
    if (!C.configured()) { res.textContent = 'URL と合言葉の両方を入れてください。'; return; }
    res.textContent = '試しています…';
    try {
      const r = await C.ping();
      res.textContent = `つながりました。\nGoogle ドライブのフォルダ「${r.folder || ''}」に保存します。\nいまクラウドにあるアルバム: ${r.albums || 0} 冊`;
      C.request();
    } catch (e) { res.textContent = 'つながりませんでした。\n' + e.message; }
  }, true);
  wide('今すぐ全部をクラウドに保存', () => {
    if (!C.configured()) { res.textContent = 'URL と合言葉の両方を入れてください。'; return; }
    C.onStatus(st => { res.textContent = st; setFoot(st); });
    C.syncNow();
  });
  wide('クラウドから戻す', async () => {
    if (!C.configured()) { res.textContent = '先に URL と合言葉を入れてください。'; return; }
    res.textContent = 'クラウドのアルバムを調べています…';
    let plan;
    try { plan = await C.planRestore(); } catch (e) { res.textContent = '調べられませんでした。\n' + e.message; return; }
    const info = `クラウドにあるアルバム: ${plan.albums.length} 冊（ここにもあるもの ${plan.localAlbums} 冊）\n`
      + `クラウドにあるページ: ${plan.cloudPages} ページ\n`
      + `ここにない・クラウドのほうが新しい: ${plan.pages.length} ページ\n`
      + `ここのほうが新しいか同じ（そのまま）: ${plan.newer} ページ`;
    if (!plan.pages.length && plan.albums.length === plan.localAlbums) { res.textContent = info + '\n\n戻すものはありません。'; return; }
    const ok = await dialog({ title: `${plan.pages.length} ページを戻しますか?`, message: info + '\n\n写真も一緒に戻すので、Wi-Fi のときがおすすめです。', buttons: [{ text: '戻す', value: true }] });
    if (!ok) { res.textContent = ''; return; }
    const b = busy('戻しています…');
    try {
      const n = await C.restore(plan, m => b.set(m));
      res.textContent = `${n} ページを戻しました。アルバムの一覧で見られます。`;
    } catch (e) { res.textContent = '途中で失敗しました。もう一度押すと、残りを戻します。\n' + e.message; }
    b.close();
  });
  box.appendChild(res);

  sec('はじめての準備（パソコンでするのがおすすめ）');
  note('Android 版で準備が済んでいれば、ここはいりません（同じ URL と合言葉を上に入れてください）。\n\n'
    + '1. https://script.google.com/ を開き、「新しいプロジェクト」を作る（名前は「超！アルバム保存」など）。\n'
    + '2. 下の「スクリプトをコピー」で写したもの（またはパソコンで https://chocorin0000.github.io/chou-album/Code.gs.txt を開いた中身）を、最初からある文と入れ替えて貼り、保存する。\n'
    + '3. 左の歯車（プロジェクトの設定）→ いちばん下の「スクリプト プロパティを追加」→ プロパティ PASSWORD、値に好きな合言葉 →「スクリプト プロパティを保存」。\n'
    + '4. 右上の「デプロイ」→「新しいデプロイ」→ 種類の歯車で「ウェブアプリ」→ 次のユーザーとして実行「自分」、アクセスできるユーザー「全員」→「デプロイ」。\n'
    + '5. 「アクセスを承認」→ 自分のアカウント →「詳細」→「（安全ではないページ）に移動」→「許可」。\n'
    + '6. 出てきたウェブアプリの URL と合言葉を、この画面に入れて「保存して、つながるか試す」。\n\n'
    + '超！手書きのスクリプトとは別のものです（別のプロジェクトを作ってください）。\n\n'
    + '保存されるもの: マイドライブの「超！アルバム」フォルダに、アルバムの名前の PDF。「復元用データ」フォルダに、アプリに戻す用のデータと写真。'
    + 'アプリで消したページ・アルバムは「消したもの」フォルダに移ります（クラウドからは消えません）。');
  wide('スクリプトをコピー', () => {
    if (!scriptText) { toast('まだ読み込み中です。もう一度押してください'); loadScript(); return; }
    navigator.clipboard.writeText(scriptText).then(() => toast('スクリプトをコピーしました'), e => toast('コピーできませんでした: ' + e.message, true));
  });

  sec('この iPhone・iPad の中の保存について');
  note('アルバムは、この iPhone・iPad の中（Safari の保存場所）に入ります。Safari の「履歴と Web サイトデータを消去」をすると消えてしまうので、'
    + 'ときどき上の「書き出す」でバックアップを取るか、クラウドへの自動保存を使ってください。'
    + (standalone() ? '' : '\n\nSafari の共有ボタン（□に↑）→「ホーム画面に追加」で、アプリのように画面いっぱいで使えます。'));
  box.appendChild(el('div', 'ver', '超！アルバム Web 版 ' + VERSION));
  show('scr-set');
  // 一覧に戻ったときの表示を元に戻す
  C.onStatus(st => setFoot(st));
}

// ---- 起動 ----

function onResize() {
  applyFull();
  if (curScreen === 'scr-edit' && E.pv && E.land !== null && E.land !== isLand()) {
    layoutEdit();
    E.pv.resetZoom();
  }
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 300));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && curScreen === 'scr-edit' && E.page) flushEditor();
});
window.addEventListener('pagehide', () => { if (E.page) { E.pv.commitInk(); savePage(); } });
window.addEventListener('online', () => C.request());
// iPhone の Safari で、2 本指の拡大で画面ごと大きくならないように
document.addEventListener('gesturestart', e => e.preventDefault());

applyFull();
S.askPersist();
showList();
setTimeout(() => S.cleanup().catch(() => {}), 5000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
