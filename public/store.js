/* Browser adapter: gives the estimator the same storage and download interface it uses
   on claude.ai, backed by this server's REST API. Changes from other users appear within a few seconds. */
(function () {
  const POLL_MS = 4000;
  const err = (code, message) => ({ code, message: message || code });
  async function call(method, url, body) {
    let r;
    try { r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { throw err('unavailable', 'Server not reachable'); }
    if (!r.ok) { let j = {}; try { j = await r.json(); } catch (e) { } throw err(j.code || (r.status === 413 ? 'quota_exceeded' : 'unavailable'), j.message); }
    return r.json();
  }
  const enc = p => p.split('/').map(encodeURIComponent).join('/');
  const snapDoc = d => { const data = Object.freeze(d.data); return { id: d.id, exists: true, data: () => data, metadata: { fromCache: false, hasPendingWrites: false } }; };
  const listeners = new Set();
  const refreshAll = () => listeners.forEach(fn => fn());

  function docRef(path) {
    return {
      id: path.split('/').pop(), path,
      async get() { try { return snapDoc(await call('GET', '/api/doc/' + enc(path))); } catch (e) { if (e.code === 'not_found') return { id: path.split('/').pop(), exists: false, data: () => undefined, metadata: { fromCache: false, hasPendingWrites: false } }; throw e; } },
      async set(data) { await call('PUT', '/api/doc/' + enc(path), data); refreshAll(); },
      async update(data) { const cur = await this.get(); if (!cur.exists) throw err('invalid_argument', 'Document does not exist'); await this.set(Object.assign({}, cur.data(), data)); },
      async delete() { await call('DELETE', '/api/doc/' + enc(path)); refreshAll(); },
      collection: sub => colRef(path + '/' + sub)
    };
  }
  function query(path, order, lim) {
    const fetchDocs = async () => {
      const { docs } = await call('GET', '/api/col/' + enc(path));
      if (order) docs.sort((a, b) => { const x = a.data[order.f], y = b.data[order.f]; const c = x === y ? 0 : x === undefined ? 1 : y === undefined ? -1 : x < y ? -1 : 1; return order.dir === 'desc' ? -c : c; });
      else docs.sort((a, b) => a.id < b.id ? -1 : 1);
      return lim ? docs.slice(0, lim) : docs;
    };
    const wrap = docs => { const d = docs.map(snapDoc); return { docs: d, size: d.length, empty: !d.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } }; };
    return {
      orderBy: (f, dir = 'asc') => query(path, { f, dir }, lim),
      limit: n => query(path, order, n),
      where() { throw new Error('where() is not supported by the self-hosted store'); },
      async get() { return wrap(await fetchDocs()); },
      onSnapshot(next, onErr) {
        let last = null, stopped = false, busy = false;
        const tick = async () => {
          if (stopped || busy) return; busy = true;
          try { const docs = await fetchDocs(); const sig = JSON.stringify(docs); if (sig !== last && !stopped) { last = sig; next(wrap(docs)); } }
          catch (e) { /* transient: keep polling */ }
          busy = false;
        };
        tick();
        const t = setInterval(tick, POLL_MS);
        const vis = () => { if (!document.hidden) tick(); };
        document.addEventListener('visibilitychange', vis);
        listeners.add(tick);
        return () => { stopped = true; clearInterval(t); listeners.delete(tick); document.removeEventListener('visibilitychange', vis); };
      }
    };
  }
  function colRef(path) {
    const q = query(path);
    return Object.assign(q, { path, doc: id => docRef(path + '/' + (id || Math.random().toString(36).slice(2, 12))), async add(data) { const r = docRef(path + '/' + Math.random().toString(36).slice(2, 12)); await r.set(data); return r; } });
  }
  const db = { doc: docRef, collection: colRef };

  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      return { status: 'saved' };
    }
  };
  window.claude = { use: async name => name === 'db' ? db : name === 'downloads' ? downloads : null };
})();
