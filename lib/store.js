'use strict';
/*
 * Server-side storage on SQLite (built into Node 22.13+ / 24, no packages).
 *
 *   docs     one row per document: path, parent collection, JSON body, who/when
 *   history  every write, with the body after the change, for audit and recovery
 *   meta     a version counter that changes on every write (drives polling ETags)
 *
 * Writes run inside transactions, so a check such as "has someone saved since?" and the
 * write that follows can't interleave with another request.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function open(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'estimator.db');
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS docs (
      path TEXT PRIMARY KEY, parent TEXT NOT NULL, body TEXT NOT NULL,
      updated_at TEXT NOT NULL, updated_by TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS docs_parent ON docs(parent);
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, op TEXT NOT NULL,
      body TEXT, at TEXT NOT NULL, by TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS history_path ON history(path);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    INSERT OR IGNORE INTO meta(key, value) VALUES ('version', '1');
  `);
  const q = {
    get: db.prepare('SELECT body FROM docs WHERE path = ?'),
    list: db.prepare('SELECT path, body FROM docs WHERE parent = ? ORDER BY path'),
    upsert: db.prepare(`INSERT INTO docs(path, parent, body, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, updated_by = excluded.updated_by`),
    // The document itself, plus everything stored under it. Matched on an exact prefix,
    // not LIKE, so purging projects/a_b can never touch projects/axb.
    del: db.prepare('DELETE FROM docs WHERE path = ? OR substr(path, 1, ?) = ?'),
    hist: db.prepare('INSERT INTO history(path, op, body, at, by) VALUES (?, ?, ?, ?, ?)'),
    histFor: db.prepare('SELECT id, op, at, by FROM history WHERE path = ? ORDER BY id DESC LIMIT ?'),
    bump: db.prepare("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'version'"),
    version: db.prepare("SELECT value FROM meta WHERE key = 'version'"),
    count: db.prepare('SELECT COUNT(*) AS n FROM docs')
  };
  const parentOf = p => p.split('/').slice(0, -1).join('/');
  const now = () => new Date().toISOString();

  const store = {
    file,
    get(p) { const r = q.get.get(p); return r ? JSON.parse(r.body) : null; },
    list(col) { return q.list.all(col).map(r => ({ id: r.path.split('/').pop(), data: JSON.parse(r.body) })); },
    version() { return q.version.get().value; },
    history(p, limit = 50) { return q.histFor.all(p, limit); },
    // Run fn inside a transaction; fn may call store.put/remove; returns fn's result.
    tx(fn) {
      db.exec('BEGIN IMMEDIATE');
      try { const out = fn(); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    put(p, body, user, op = 'PUT') {
      const json = JSON.stringify(body), t = now();
      q.upsert.run(p, parentOf(p), json, t, user);
      q.hist.run(p, op, json, t, user);
      q.bump.run();
    },
    remove(p, user) {
      q.del.run(p, p.length + 1, p + '/');
      q.hist.run(p, 'PURGE', null, now(), user);
      q.bump.run();
    },
    // A consistent copy of the database, safe while the server is running.
    backup(toFile) { try { fs.unlinkSync(toFile); } catch (e) { } db.exec(`VACUUM INTO '${toFile.replace(/'/g, "''")}'`); },
    close() { db.close(); }
  };

  // First start after upgrading: bring over the old JSON file once.
  const legacy = path.join(dataDir, 'db.json');
  if (fs.existsSync(legacy) && q.count.get().n === 0) {
    const old = JSON.parse(fs.readFileSync(legacy, 'utf8'));
    store.tx(() => Object.entries(old).forEach(([p, body]) => store.put(p, body, body.updatedBy || 'migrated', 'MIGRATE')));
    fs.renameSync(legacy, legacy + '.migrated');
    console.log(`Moved ${Object.keys(old).length} saved records from db.json into ${file}`);
  }
  return store;
}

module.exports = { open };
