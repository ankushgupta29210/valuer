// Backend-neutral query constraints. Pages build queries with these; the
// Firebase data layer converts them to Firestore constraints and the demo
// store evaluates them in memory.

import { where as fsWhere, orderBy as fsOrderBy, limit as fsLimit, type QueryConstraint } from 'firebase/firestore';

export type Op = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains';
export type Constraint =
  | { kind: 'where'; field: string; op: Op; value: unknown }
  | { kind: 'orderBy'; field: string; direction: 'asc' | 'desc' }
  | { kind: 'limit'; n: number };

export const where = (field: string, op: Op, value: unknown): Constraint => ({ kind: 'where', field, op, value });
export const orderBy = (field: string, direction: 'asc' | 'desc' = 'asc'): Constraint => ({ kind: 'orderBy', field, direction });
export const limit = (n: number): Constraint => ({ kind: 'limit', n });

export function toFirestore(constraints: Constraint[]): QueryConstraint[] {
  return constraints.map((c) => {
    if (c.kind === 'where') return fsWhere(c.field, c.op, c.value);
    if (c.kind === 'orderBy') return fsOrderBy(c.field, c.direction);
    return fsLimit(c.n);
  });
}

function cmp(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

/** Evaluate constraints against plain objects (demo mode). */
export function applyConstraints<T extends Record<string, unknown>>(rows: T[], constraints: Constraint[]): T[] {
  let out = rows;
  for (const c of constraints) {
    if (c.kind !== 'where') continue;
    out = out.filter((r) => {
      const v = r[c.field];
      switch (c.op) {
        case '==': return v === c.value || (v == null && c.value == null);
        case '!=': return v !== c.value;
        case '<': return cmp(v, c.value) < 0;
        case '<=': return cmp(v, c.value) <= 0;
        case '>': return cmp(v, c.value) > 0;
        case '>=': return cmp(v, c.value) >= 0;
        case 'in': return Array.isArray(c.value) && (c.value as unknown[]).includes(v);
        case 'array-contains': return Array.isArray(v) && v.includes(c.value);
        default: return true;
      }
    });
  }
  const orders = constraints.filter((c): c is Extract<Constraint, { kind: 'orderBy' }> => c.kind === 'orderBy');
  if (orders.length) {
    out = [...out].sort((a, b) => {
      for (const o of orders) {
        const d = cmp(a[o.field], b[o.field]);
        if (d !== 0) return o.direction === 'desc' ? -d : d;
      }
      return 0;
    });
  }
  const lim = constraints.find((c): c is Extract<Constraint, { kind: 'limit' }> => c.kind === 'limit');
  if (lim) out = out.slice(0, lim.n);
  return out;
}
