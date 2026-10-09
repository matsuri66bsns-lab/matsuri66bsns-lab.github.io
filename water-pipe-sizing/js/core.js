/* 共通ユーティリティ。ビルド不要・file:// でも動くよう、クラシックスクリプト + グローバル名前空間 WPS で構成する。 */
(function (WPS) {
  'use strict';

  const util = {
    uid(prefix) {
      return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 9);
    },

    fmt(v, digits) {
      if (v === null || v === undefined || !isFinite(v)) return '—';
      return Number(v).toFixed(digits === undefined ? 2 : digits);
    },

    num(v, fallback) {
      const n = parseFloat(v);
      return isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
    },

    clone(o) {
      return JSON.parse(JSON.stringify(o));
    },

    debounce(fn, ms) {
      let t = null;
      return function () {
        const args = arguments;
        clearTimeout(t);
        t = setTimeout(() => fn.apply(null, args), ms);
      };
    },

    esc(s) {
      return String(s === undefined || s === null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    /* 小さなDOMビルダー: h('div', {class:'x', onclick: fn}, 'text', child) */
    h(tag, attrs) {
      const el = document.createElement(tag);
      if (attrs) {
        Object.keys(attrs).forEach((k) => {
          const v = attrs[k];
          if (v === undefined || v === null || v === false) return;
          if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
          else if (k === 'class') el.className = v;
          else if (k === 'html') el.innerHTML = v;
          else if (k === 'value') el.value = v;
          else if (k === 'checked') el.checked = !!v;
          else el.setAttribute(k, v === true ? '' : v);
        });
      }
      for (let i = 2; i < arguments.length; i++) {
        const c = arguments[i];
        if (c === null || c === undefined || c === false) continue;
        if (Array.isArray(c)) c.forEach((cc) => cc && el.append(cc));
        else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
      }
      return el;
    },

    download(filename, content, mime) {
      const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    },

    downloadDataUrl(filename, dataUrl) {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    },

    storage: {
      get(key) {
        try {
          const s = localStorage.getItem(key);
          return s ? JSON.parse(s) : null;
        } catch (e) {
          return null;
        }
      },
      set(key, value) {
        try {
          localStorage.setItem(key, JSON.stringify(value));
          return true;
        } catch (e) {
          return false;
        }
      },
      remove(key) {
        try { localStorage.removeItem(key); } catch (e) { /* noop */ }
      },
    },
  };

  WPS.util = util;
})(globalThis.WPS = globalThis.WPS || {});
