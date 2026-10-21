// Small edits to a game instead of the whole game, so two players changing
// it at the same time don't overwrite each other: the page sends what it
// changed, the server applies that to the latest copy.
//
// Counters travel as "add this much" (two players tapping +1 CP make +2),
// list items added at the end as "push" (both log lines are kept), and
// anything else as "set this field" (the last one wins, per field).

export type Path = (string | number)[];
export type Op = { path: Path; set: unknown } | { path: Path; inc: number } | { path: Path; push: unknown } | { path: Path; del: true };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Game fields that count up and down (CP, fury, rage, damage, a round's VP and CP). */
export function isCounter(path: Path): boolean {
  const p = path.join(".");
  return (
    /^state\.(cp|fury|rage)\.(me|opponent)$/.test(p) ||
    /^state\.units\.[^.]+\.damage$/.test(p) ||
    /^state\.rounds\.\d+\.(me|opponent)\.(extraVp|cpGained|cpSpent)$/.test(p)
  );
}

/** The edits that turn `a` into `b`. */
export function diff(a: unknown, b: unknown, path: Path = [], counter: (path: Path) => boolean = isCounter): Op[] {
  if (same(a, b)) return [];
  if (b === undefined) return [{ path, del: true }];
  if (typeof a === "number" && typeof b === "number" && Number.isFinite(a) && Number.isFinite(b) && counter(path)) return [{ path, inc: b - a }];
  if (Array.isArray(a) && Array.isArray(b) && b.length >= a.length) {
    const ops = a.flatMap((x, i) => diff(x, b[i], [...path, i], counter));
    return [...ops, ...b.slice(a.length).map((item) => ({ path, push: item }))];
  }
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) => diff(a[k], b[k], [...path, k], counter));
  }
  return [{ path, set: b }];
}

const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** A copy of `target` with the edits applied. Edits with a broken path are skipped. */
export function applyOps<T>(target: T, ops: Op[]): T {
  const root = structuredClone(target) as unknown;
  for (const op of ops) {
    if (!Array.isArray(op?.path) || !op.path.length || op.path.some((k) => BAD_KEYS.has(String(k)) || (typeof k !== "string" && typeof k !== "number"))) continue;
    let parent = root as Record<string | number, unknown>;
    let ok = true;
    for (let i = 0; i < op.path.length - 1; i++) {
      const k = op.path[i];
      if (parent[k] === undefined || parent[k] === null) parent[k] = typeof op.path[i + 1] === "number" ? [] : {};
      if (typeof parent[k] !== "object") {
        ok = false;
        break;
      }
      parent = parent[k] as Record<string | number, unknown>;
    }
    if (!ok) continue;
    const k = op.path[op.path.length - 1];
    if ("del" in op) {
      if (Array.isArray(parent) && typeof k === "number") parent[k] = undefined;
      else delete parent[k];
    } else if ("inc" in op) {
      if (typeof op.inc === "number" && Number.isFinite(op.inc)) parent[k] = (typeof parent[k] === "number" ? (parent[k] as number) : 0) + op.inc;
    } else if ("push" in op) {
      if (Array.isArray(parent[k])) (parent[k] as unknown[]).push(op.push);
      else parent[k] = [op.push];
    } else if ("set" in op) {
      parent[k] = op.set;
    }
  }
  return root as T;
}
