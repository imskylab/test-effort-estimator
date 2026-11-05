/* Browser adapter: gives the estimator the same storage and download interface it uses
   on claude.ai, backed by this server's REST API. Changes from other users appear within a few seconds. */
(function () {
  const POLL_MS = 4000;
  const err = (code, message, extra) => Object.assign({ code, message: message || code }, extra || {});
  async function call(method, url, body, headers) {
    let r;
    try { r = await fetch(url, { method, headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, headers || {}), body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { throw err('unavailable', 'Server not reachable'); }
    if (r.status === 304) return { notModified: true };
    if (!r.ok) {
      let j = {}; try { j = await r.json(); } catch (e) { }
      throw err(j.code || (r.status === 413 ? 'quota_exceeded' : r.status === 401 ? 'not_granted' : 'unavailable'), j.message, j.current ? { current: j.current } : null);
    }
    const data = await r.json();
    return { data, etag: r.headers.get('ETag') };
  }
  const enc = p => p.split('/').map(encodeURIComponent).join('/');
  const snapDoc = d => { const data = Object.freeze(d.data); return { id: d.id, exists: true, data: () => data, metadata: { fromCache: false, hasPendingWrites: false } }; };
  const listeners = new Set();
  const refreshAll = () => listeners.forEach(fn => fn(true));

  function docRef(path) {
    return {
      id: path.split('/').pop(), path,
      async get() { try { return snapDoc((await call('GET', '/api/doc/' + enc(path))).data); } catch (e) { if (e.code === 'not_found') return { id: path.split('/').pop(), exists: false, data: () => undefined, metadata: { fromCache: false, hasPendingWrites: false } }; throw e; } },
      // A body carrying prevRev is rejected with code 'conflict' if someone saved a newer revision.
      async set(data) { await call('PUT', '/api/doc/' + enc(path), data); refreshAll(); },
      // Merge-write: nested objects merge on the server, so two people editing different fields don't collide.
      async update(data) { await call('PATCH', '/api/doc/' + enc(path), data); refreshAll(); },
      async delete() { await call('DELETE', '/api/doc/' + enc(path)); refreshAll(); },
      collection: sub => colRef(path + '/' + sub)
    };
  }
  function query(path, order, lim) {
    let etag = null, cached = null;
    const fetchDocs = async (force) => {
      const res = await call('GET', '/api/col/' + enc(path), null, etag && !force ? { 'If-None-Match': etag } : null);
      if (res.notModified) return null;
      etag = res.etag; let docs = res.data.docs;
      if (order) docs.sort((a, b) => { const x = a.data[order.f], y = b.data[order.f]; const c = x === y ? 0 : x === undefined ? 1 : y === undefined ? -1 : x < y ? -1 : 1; return order.dir === 'desc' ? -c : c; });
      else docs.sort((a, b) => a.id < b.id ? -1 : 1);
      cached = lim ? docs.slice(0, lim) : docs;
      return cached;
    };
    const wrap = docs => { const d = docs.map(snapDoc); return { docs: d, size: d.length, empty: !d.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } }; };
    return {
      orderBy: (f, dir = 'asc') => query(path, { f, dir }, lim),
      limit: n => query(path, order, n),
      where() { throw new Error('where() is not supported by the self-hosted store'); },
      async get() { return wrap(await fetchDocs(true)); },
      onSnapshot(next, onErr) {
        let last = null, stopped = false, busy = false, fails = 0, reported = false;
        const tick = async (force) => {
          if (stopped || busy) return; busy = true;
          try {
            const docs = await fetchDocs(force);
            fails = 0;
            if (docs) { const sig = JSON.stringify(docs); if (sig !== last && !stopped) { last = sig; next(wrap(docs)); } }
          } catch (e) {
            // tell the page once the server has been unreachable for a while; keep polling
            if (++fails >= 3 && !reported && onErr) { reported = true; try { onErr(err(e.code || 'unavailable', e.message)); } catch (x) { } }
          }
          busy = false;
        };
        tick(true);
        const t = setInterval(() => tick(false), POLL_MS);
        const vis = () => { if (!document.hidden) tick(false); };
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
  const db = { doc: docRef, collection: colRef, selfHosted: true };

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
