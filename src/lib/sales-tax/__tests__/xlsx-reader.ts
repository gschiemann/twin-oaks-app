// Test-only .xlsx reader + tiny formula evaluator. It recomputes every
// formula from the raw cells (ignoring cached values), so a test can prove
// that what Excel will calculate on open equals what the engine computed.
// Supports exactly what the workpaper uses: + - unary-minus, cell/range
// references (incl. 'Sheet name'!), SUM, SUMIFS, COUNTIFS, HYPERLINK.

import { strFromU8, unzipSync } from "fflate";

export type XCell = { v: number | string | null; f?: string; t?: string; s?: string };
export type XSheet = Map<string, XCell>;
export type XBook = { sheets: Map<string, XSheet>; names: string[]; parts: Record<string, string> };

function unxml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Throws unless tags balance and every & starts an entity. */
export function assertWellFormed(xml: string, label: string) {
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, "");
  const bad = /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/.exec(body);
  if (bad) throw new Error(`${label}: bare & at ${bad.index}`);
  const stack: string[] = [];
  for (const m of body.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"]|"[^"]*")*?)(\/?)>/g)) {
    const [, close, name, , selfClose] = m;
    if (selfClose) continue;
    if (close) {
      const open = stack.pop();
      if (open !== name) throw new Error(`${label}: </${name}> closes <${open}>`);
    } else stack.push(name);
  }
  if (stack.length) throw new Error(`${label}: unclosed <${stack.join("><")}>`);
}

function parseSheet(xml: string): XSheet {
  const cells: XSheet = new Map();
  const re = /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  for (const m of xml.matchAll(re)) {
    const [, ref, attrs, inner = ""] = m;
    const t = /\bt="(\w+)"/.exec(attrs)?.[1];
    const s = /\bs="(\d+)"/.exec(attrs)?.[1];
    const f = /<f>([\s\S]*?)<\/f>/.exec(inner)?.[1];
    let v: number | string | null = null;
    if (t === "inlineStr") {
      v = unxml(/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] ?? "");
    } else {
      const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      if (raw !== undefined) v = t === "str" ? unxml(raw) : Number(raw);
    }
    cells.set(ref, { v, f: f === undefined ? undefined : unxml(f), t, s });
  }
  return cells;
}

export function readXlsx(bytes: Uint8Array): XBook {
  const files = unzipSync(bytes);
  const parts: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) parts[k] = strFromU8(v);
  const rels = new Map(
    [
      ...parts["xl/_rels/workbook.xml.rels"].matchAll(
        /<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g,
      ),
    ].map((m) => [m[1], m[2]]),
  );
  const sheets = new Map<string, XSheet>();
  const names: string[] = [];
  for (const m of parts["xl/workbook.xml"].matchAll(
    /<sheet name="([^"]+)" sheetId="\d+" r:id="([^"]+)"\/>/g,
  )) {
    const name = unxml(m[1]);
    names.push(name);
    sheets.set(name, parseSheet(parts[`xl/${rels.get(m[2])}`]));
  }
  return { sheets, names, parts };
}

// ——————————————————————————— evaluator ———————————————————————————

type Range = { kind: "range"; sheet: string; c1: number; r1: number; c2: number; r2: number };
type Val = number | string | null | Range;

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function colLetters(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

type Token =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "ref"; sheet: string | null; a: string; b: string | null }
  | { k: "fn"; v: string }
  | { k: "op"; v: string };

function tokenize(f: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const ref = /^(?:'((?:[^']|'')+)'!|([A-Za-z][\w.]*)!)?(\$?[A-Z]+\$?\d+)(?::(\$?[A-Z]+\$?\d+))?/;
  while (i < f.length) {
    const rest = f.slice(i);
    const ch = f[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let s = "";
      for (;;) {
        if (j >= f.length) throw new Error(`Unterminated string in ${f}`);
        if (f[j] === '"') {
          if (f[j + 1] === '"') {
            s += '"';
            j += 2;
            continue;
          }
          break;
        }
        s += f[j];
        j += 1;
      }
      out.push({ k: "str", v: s });
      i = j + 1;
      continue;
    }
    const fn = /^([A-Z]+)\(/.exec(rest);
    if (fn) {
      out.push({ k: "fn", v: fn[1] });
      i += fn[1].length; // leave "(" for the parser
      continue;
    }
    const r = ref.exec(rest);
    if (r) {
      const sheet = r[1] !== undefined ? r[1].replace(/''/g, "'") : (r[2] ?? null);
      out.push({
        k: "ref",
        sheet,
        a: r[3].replace(/\$/g, ""),
        b: r[4] ? r[4].replace(/\$/g, "") : null,
      });
      i += r[0].length;
      continue;
    }
    const n = /^\d+(\.\d+)?/.exec(rest);
    if (n) {
      out.push({ k: "num", v: Number(n[0]) });
      i += n[0].length;
      continue;
    }
    if ("+-(),".includes(ch)) {
      out.push({ k: "op", v: ch });
      i += 1;
      continue;
    }
    throw new Error(`Unsupported formula syntax at "${rest}" in ${f}`);
  }
  return out;
}

export class Evaluator {
  private memo = new Map<string, number | string | null>();
  constructor(private book: XBook) {}

  cell(sheet: string, ref: string, stack: string[] = []): number | string | null {
    const key = `${sheet}!${ref}`;
    if (this.memo.has(key)) return this.memo.get(key)!;
    if (stack.includes(key)) throw new Error(`Circular reference at ${key}`);
    const c = this.book.sheets.get(sheet)?.get(ref);
    let v: number | string | null = null;
    if (c?.f !== undefined) v = this.formula(sheet, c.f, [...stack, key]);
    else if (c) v = c.v;
    this.memo.set(key, v);
    return v;
  }

  formula(sheet: string, f: string, stack: string[] = []): number | string | null {
    const tokens = tokenize(f);
    let p = 0;
    const peek = () => tokens[p];
    const take = () => tokens[p++];
    const expectOp = (v: string) => {
      const t = take();
      if (!t || t.k !== "op" || t.v !== v) throw new Error(`Expected "${v}" in ${f}`);
    };

    const scalar = (v: Val): number | string | null => {
      if (v && typeof v === "object") {
        if (v.c1 !== v.c2 || v.r1 !== v.r2) throw new Error(`Range used as a value in ${f}`);
        return this.cell(v.sheet, `${colLetters(v.c1)}${v.r1}`, stack);
      }
      return v;
    };
    const asNum = (v: Val): number => {
      const s = scalar(v);
      if (s === null || s === "") return 0;
      if (typeof s === "number") return s;
      throw new Error(`Text "${s}" used in arithmetic in ${f}`);
    };
    const cellsOf = (v: Val): (number | string | null)[] => {
      if (!v || typeof v !== "object") return [v as number | string | null];
      const out: (number | string | null)[] = [];
      for (let r = v.r1; r <= v.r2; r++) {
        for (let c = v.c1; c <= v.c2; c++)
          out.push(this.cell(v.sheet, `${colLetters(c)}${r}`, stack));
      }
      return out;
    };
    const matches = (value: number | string | null, crit: number | string | null): boolean => {
      if (crit === null) crit = 0; // Excel: an empty criteria cell means 0
      if (typeof crit === "number") return typeof value === "number" && value === crit;
      const m = /^(<>|>=|<=|=|>|<)?([\s\S]*)$/.exec(crit)!;
      const op = m[1] ?? "=";
      const target = m[2];
      const numeric = target !== "" && !Number.isNaN(Number(target));
      let cmp: number | null;
      if (numeric) cmp = typeof value === "number" ? value - Number(target) : null;
      else if (target === "") cmp = value === null || value === "" ? 0 : null;
      else
        cmp =
          typeof value === "string"
            ? value.toLowerCase().localeCompare(target.toLowerCase())
            : null;
      switch (op) {
        case "=":
          return cmp === 0;
        case "<>":
          return cmp !== 0;
        case ">":
          return cmp !== null && cmp > 0;
        case "<":
          return cmp !== null && cmp < 0;
        case ">=":
          return cmp !== null && cmp >= 0;
        default:
          return cmp !== null && cmp <= 0;
      }
    };
    const ifs = (sumRange: Val | null, pairs: [Val, Val][]): { sum: number; count: number } => {
      const critCells = pairs.map(([range]) => cellsOf(range));
      const crits = pairs.map(([, c]) => scalar(c));
      const sums = sumRange ? cellsOf(sumRange) : null;
      const n = critCells[0].length;
      let sum = 0;
      let count = 0;
      for (let i = 0; i < n; i++) {
        if (critCells.every((cells, k) => matches(cells[i], crits[k]))) {
          count += 1;
          const x = sums?.[i];
          if (typeof x === "number") sum += x;
        }
      }
      return { sum, count };
    };

    const call = (name: string, args: Val[]): Val => {
      switch (name) {
        case "SUM":
          return args
            .flatMap(cellsOf)
            .reduce<number>((s, x) => s + (typeof x === "number" ? x : 0), 0);
        case "SUMIFS": {
          const pairs: [Val, Val][] = [];
          for (let i = 1; i < args.length; i += 2) pairs.push([args[i], args[i + 1]]);
          return ifs(args[0], pairs).sum;
        }
        case "COUNTIFS": {
          const pairs: [Val, Val][] = [];
          for (let i = 0; i < args.length; i += 2) pairs.push([args[i], args[i + 1]]);
          return ifs(null, pairs).count;
        }
        case "HYPERLINK":
          return scalar(args[1] ?? args[0]);
        default:
          throw new Error(`Unsupported function ${name}`);
      }
    };

    const primary = (): Val => {
      const t = take();
      if (!t) throw new Error(`Unexpected end of ${f}`);
      if (t.k === "num" || t.k === "str") return t.v;
      if (t.k === "ref") {
        const target = t.sheet ?? sheet;
        const a = /^([A-Z]+)(\d+)$/.exec(t.a)!;
        const b = /^([A-Z]+)(\d+)$/.exec(t.b ?? t.a)!;
        return {
          kind: "range",
          sheet: target,
          c1: colIndex(a[1]),
          r1: Number(a[2]),
          c2: colIndex(b[1]),
          r2: Number(b[2]),
        };
      }
      if (t.k === "fn") {
        expectOp("(");
        const args: Val[] = [];
        if (!(peek()?.k === "op" && (peek() as { v: string }).v === ")")) {
          for (;;) {
            args.push(expr());
            const sep = take();
            if (sep?.k === "op" && sep.v === ",") continue;
            if (sep?.k === "op" && sep.v === ")") break;
            throw new Error(`Bad argument list in ${f}`);
          }
        } else take();
        return call(t.v, args);
      }
      if (t.k === "op" && t.v === "(") {
        const v = expr();
        expectOp(")");
        return v;
      }
      if (t.k === "op" && t.v === "-") return -asNum(primary());
      throw new Error(`Unexpected token in ${f}`);
    };
    const expr = (): Val => {
      let left: Val = primary();
      while (peek()?.k === "op" && ["+", "-"].includes((peek() as { v: string }).v)) {
        const op = (take() as { v: string }).v;
        const right = primary();
        left = op === "+" ? asNum(left) + asNum(right) : asNum(left) - asNum(right);
      }
      return left;
    };

    const result = expr();
    if (p !== tokens.length) throw new Error(`Trailing tokens in ${f}`);
    return scalar(result);
  }
}

/** Every formula cell in the book, recomputed, next to its cached value. */
export function recomputeAll(
  book: XBook,
): { ref: string; formula: string; cached: XCell["v"]; computed: XCell["v"] }[] {
  const ev = new Evaluator(book);
  const out: { ref: string; formula: string; cached: XCell["v"]; computed: XCell["v"] }[] = [];
  for (const [name, cells] of book.sheets) {
    for (const [ref, c] of cells) {
      if (c.f === undefined) continue;
      out.push({ ref: `${name}!${ref}`, formula: c.f, cached: c.v, computed: ev.cell(name, ref) });
    }
  }
  return out;
}
