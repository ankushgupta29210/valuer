// In-browser data store for demo mode. Mirrors the Firestore collections,
// persists to localStorage so a refresh keeps changes, and notifies
// subscribers so the same realtime hooks work unchanged.

import { applyConstraints, type Constraint } from '../query';

export type DemoDoc = Record<string, unknown> & { id: string };
type Collections = Record<string, Record<string, DemoDoc>>;

const STORAGE_KEY = 'valeur.demo.v1';
const SESSION_KEY = 'valeur.demo.session';

export const isDemo = import.meta.env.VITE_DEMO_MODE === 'true';

export const nowIso = () => new Date().toISOString();
let counter = 0;
export const newId = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

class DemoStore {
  private data: Collections = {};
  private listeners = new Set<() => void>();
  private loaded = false;

  private load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.data = JSON.parse(raw);
    } catch {
      this.data = {};
    }
  }
  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      /* quota or private mode — keep in memory */
    }
    for (const l of this.listeners) l();
  }

  isEmpty(): boolean {
    this.load();
    return Object.keys(this.data).length === 0;
  }
  replaceAll(data: Collections) {
    this.load();
    this.data = data;
    this.persist();
  }
  reset() {
    this.data = {};
    this.loaded = true;
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    this.persist();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get<T = DemoDoc>(path: string): T | null {
    this.load();
    const [coll, id, sub, subId] = path.split('/');
    const key = sub ? `${coll}/${id}/${sub}` : coll;
    const docId = sub ? subId : id;
    const d = this.data[key]?.[docId];
    return d ? (structuredClone(d) as T) : null;
  }
  list<T = DemoDoc>(collection: string, constraints: Constraint[] = []): T[] {
    this.load();
    const rows = Object.values(this.data[collection] ?? {});
    return applyConstraints(rows, constraints).map((r) => structuredClone(r)) as T[];
  }
  set(collection: string, id: string, doc: Record<string, unknown>) {
    this.load();
    this.data[collection] ??= {};
    this.data[collection][id] = { ...doc, id };
    this.persist();
    return id;
  }
  add(collection: string, doc: Record<string, unknown>): string {
    const id = newId();
    return this.set(collection, id, { createdAt: nowIso(), updatedAt: nowIso(), ...doc });
  }
  update(collection: string, id: string, patch: Record<string, unknown>) {
    this.load();
    const cur = this.data[collection]?.[id];
    if (!cur) throw new Error(`not found: ${collection}/${id}`);
    this.data[collection][id] = { ...cur, ...patch, updatedAt: nowIso() };
    this.persist();
  }
  delete(collection: string, id: string) {
    this.load();
    if (this.data[collection]) delete this.data[collection][id];
    this.persist();
  }

  // ---- session (which demo user is signed in) ----
  getSessionUid(): string | null {
    return sessionStorage.getItem(SESSION_KEY);
  }
  setSessionUid(uid: string | null) {
    if (uid) sessionStorage.setItem(SESSION_KEY, uid);
    else sessionStorage.removeItem(SESSION_KEY);
    for (const l of this.listeners) l();
  }
}

export const demoStore = new DemoStore();
