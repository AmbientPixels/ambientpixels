// project-store.js
// IndexedDB-backed storage for TileForge Projects

(function(){
  const DB_NAME = 'tileforge-projects';
  const DB_VERSION = 1;
  const STORE = 'projects';

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('by_updatedAt', 'updatedAt');
          os.createIndex('by_name', 'name', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function withStore(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const result = fn(store);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  function uuid() {
    return (crypto && crypto.randomUUID) ? crypto.randomUUID() : 'proj-' + Math.random().toString(36).slice(2);
  }

  // Public API
  const ProjectStore = {
    async list() {
      return withStore('readonly', (store) => new Promise((resolve, reject) => {
        const items = [];
        const idx = store.index('by_updatedAt');
        const curReq = idx.openCursor(null, 'prev');
        curReq.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) { items.push(cursor.value); cursor.continue(); } else { resolve(items); }
        };
        curReq.onerror = () => reject(curReq.error);
      }));
    },

    async get(id) {
      return withStore('readonly', (store) => new Promise((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      }));
    },

    async create(name, data) {
      const now = new Date().toISOString();
      const rec = {
        id: uuid(),
        name: name || 'Untitled Project',
        createdAt: now,
        updatedAt: now,
        schemaVersion: 1,
        data: data || { csvs: [], activeCsv: null, image: null, template: 'toh', settings: {} }
      };
      await withStore('readwrite', (store) => store.add(rec));
      return rec;
    },

    async update(id, patch) {
      const cur = await this.get(id);
      if (!cur) throw new Error('Project not found');
      const now = new Date().toISOString();
      const updated = { ...cur, ...patch, updatedAt: now };
      await withStore('readwrite', (store) => store.put(updated));
      return updated;
    },

    async saveSnapshot(id, data) {
      const cur = await this.get(id);
      if (!cur) throw new Error('Project not found');
      const now = new Date().toISOString();
      cur.data = data;
      cur.updatedAt = now;
      await withStore('readwrite', (store) => store.put(cur));
      return cur;
    },

    async clone(id, newName) {
      const cur = await this.get(id);
      if (!cur) throw new Error('Project not found');
      const copy = JSON.parse(JSON.stringify(cur));
      delete copy.id;
      copy.name = newName || (cur.name + ' (Copy)');
      const rec = await this.create(copy.name, copy.data);
      return rec;
    },

    async remove(id) {
      await withStore('readwrite', (store) => store.delete(id));
      return true;
    },
  };

  window.ProjectStore = ProjectStore;
})();
