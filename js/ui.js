// 画面の部品: ボタン・短い知らせ（トースト）・確かめる箱・選ぶ一覧・文字を入れる箱（超！手書き Web 版と同じ作り）

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function btn(text, onClick, cls) {
  const b = el('button', 'btn' + (cls ? ' ' + cls : ''), text);
  b.type = 'button';
  b.addEventListener('click', e => { e.preventDefault(); onClick(e); });
  return b;
}

let toastTimer = 0;
export function toast(msg, long = false) {
  let t = document.getElementById('toast');
  if (!t) { t = el('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), long ? 4200 : 2400);
}

/**
 * 箱を出す。buttons = [{text, value, color}]、items = [{text, value}]（縦の一覧）、body に DOM を入れてもよい。
 * 選んだ value で解決（外をタップ・「やめる」は null）
 */
export function dialog({ title, message, items, buttons, body, cancel = 'やめる' }) {
  return new Promise(ok => {
    const back = el('div', 'dlg-back');
    const box = el('div', 'dlg');
    if (title) box.appendChild(el('div', 'dlg-title', title));
    if (message) box.appendChild(el('div', 'dlg-msg', message));
    if (body) { const w = el('div', 'dlg-body'); w.appendChild(body); box.appendChild(w); }
    const close = v => { back.remove(); ok(v); };
    if (items) {
      const list = el('div', 'dlg-items');
      for (const it of items) {
        const b = el('button', 'dlg-item', it.text);
        b.type = 'button';
        b.addEventListener('click', () => close(it.value));
        list.appendChild(b);
      }
      box.appendChild(list);
    }
    const row = el('div', 'dlg-btns');
    if (cancel) { const c = el('button', 'dlg-btn', cancel); c.type = 'button'; c.onclick = () => close(null); row.appendChild(c); }
    for (const b of buttons || []) {
      const x = el('button', 'dlg-btn strong', b.text);
      x.type = 'button';
      if (b.color) x.style.color = b.color;
      x.onclick = () => close(b.value);
      row.appendChild(x);
    }
    box.appendChild(row);
    back.appendChild(box);
    back.addEventListener('click', e => { if (e.target === back) close(null); });
    back.closeWith = close;
    document.body.appendChild(back);
  });
}

export function confirmDlg(message, okText, title, danger = true) {
  return dialog({ title, message, buttons: [{ text: okText, value: true, color: danger ? '#C0392B' : '#1E6FD9' }] });
}

/** iPad か（超！手書き Web 版で、iPad はページの中の入力の枠を押すと落ちることがあったため、入力の箱 prompt を使う） */
export const isIPad = () => {
  const t = navigator.maxTouchPoints > 1;
  const s = Math.min(screen.width || 0, screen.height || 0);
  return t && s >= 600;
};

/**
 * 文字を入れてもらう。iPhone は何行でも書ける箱、iPad は入力の箱（prompt。改行は「//」）。
 * extra: 箱の下に足すもの（チェックなど。iPhone のときだけ）。決定で文字、やめるで null
 */
export function askText({ title, value = '', hint = '', multi = false, extra = null, quick = [] }) {
  if (isIPad()) {
    const msg = title + (multi ? '\n（改行したい所には // と入れてください）' : '');
    const v = window.prompt(msg, multi ? value.replace(/\n/g, '//') : value);
    if (v == null) return Promise.resolve(null);
    return Promise.resolve(multi ? v.split('//').join('\n') : v);
  }
  const wrap = el('div', 'ask');
  const ta = el(multi ? 'textarea' : 'input', 'input');
  if (!multi) ta.type = 'text';
  ta.value = value;
  ta.placeholder = hint;
  if (multi) ta.rows = 3;
  wrap.appendChild(ta);
  if (quick.length) {
    const row = el('div', 'quick');
    for (const q of quick) {
      row.appendChild(btn(q.text, () => {
        const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a, s = q.value();
        ta.value = ta.value.slice(0, a) + s + ta.value.slice(b);
        ta.focus();
        ta.setSelectionRange(a + s.length, a + s.length);
      }, 'small'));
    }
    wrap.appendChild(row);
  }
  if (extra) wrap.appendChild(extra);
  const p = dialog({ title, body: wrap, buttons: [{ text: '決定', value: true }] }).then(okd => okd ? ta.value : null);
  setTimeout(() => { ta.focus(); try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) { /* なくてよい */ } }, 50);
  return p;
}

/** チェックの箱（ラベルつき） */
export function check(label, on) {
  const l = el('label', 'check');
  const c = el('input');
  c.type = 'checkbox';
  c.checked = !!on;
  l.append(c, el('span', null, label));
  l.input = c;
  return l;
}

/**
 * 本当の画面の大きさ。ホーム画面から開いたとき、iPhone は高さを少なく教えてきて、下に隙間ができることがある。
 * そのときは画面（screen）の大きさまで広げる（iPhone だけ。iPad では広げない。超！手書き Web 版の v5 と同じ）
 */
export function fullSize() {
  let W = innerWidth, H = innerHeight;
  if (navigator.standalone && screen.width && screen.height && Math.min(screen.width, screen.height) < 600) {
    const a = Math.max(screen.width, screen.height), b = Math.min(screen.width, screen.height);
    const [fw, fh] = W < H ? [b, a] : [a, b];
    if (fw >= W && fw - W <= 80) W = fw;
    if (fh >= H && fh - H <= 80) H = fh;
  }
  return [W, H];
}

let lastBody = '';
export function applyFull() {
  const [W, H] = fullSize();
  const full = W !== innerWidth || H !== innerHeight;
  const k = full ? W + 'x' + H : '';
  if (k === lastBody) return;
  lastBody = k;
  const r = document.documentElement, b = document.body.style;
  r.classList.toggle('full', full);
  if (full) Object.assign(b, { position: 'fixed', left: '0', top: '0', width: W + 'px', height: H + 'px' });
  else Object.assign(b, { position: '', left: '', top: '', width: '', height: '' });
}

/** ファイルを渡す（共有の画面。iPhone なら「ファイルに保存」「画像を保存」・LINE・メールなど）。使えないときはダウンロード */
export async function shareFile(file, text) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share(text ? { files: [file], title: text } : { files: [file] });
      return true;
    } catch (e) {
      if (e && e.name === 'AbortError') return true;     // 自分でやめた
      if (e && (e.name === 'NotAllowedError' || e.name === 'InvalidStateError')) return false; // 押してから時間がたった
      throw e;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
  return true;
}

/** 時間のかかる作り物のあとで共有する: 共有の画面は「押した直後」にしか出せないので、出せなかったら、もう一度押してもらう */
export async function shareAfterWork(file, label = 'できました') {
  const ok = await shareFile(file);
  if (ok) return;
  await dialog({ title: label, message: '下の「送る・保存する」を押してください。', buttons: [{ text: '送る・保存する', value: true }] })
    .then(v => v ? shareFile(file) : null);
}
