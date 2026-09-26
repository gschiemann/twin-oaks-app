// Minimal .xlsx (SpreadsheetML) writer — just enough for accountant
// workpapers: several sheets, bold headers, money/date/percent formats,
// frozen header rows, filters, and formulas that carry their computed value
// (every viewer shows the right number; Excel recomputes on open).
//
// Deterministic: the same input gives the same bytes (fixed zip timestamps,
// no generated ids), so a saved return can be regenerated exactly.

import { strToU8, zipSync, type Zippable } from "fflate";

export type CellStyle =
  | "default"
  | "header"
  | "title"
  | "subtitle"
  | "bold"
  | "money"
  | "moneyTotal"
  | "rate"
  | "date"
  | "int"
  | "code"
  | "wrap"
  | "note"
  | "good"
  | "bad"
  | "total";

export type Cell =
  | null
  | { t: "text"; v: string; s?: CellStyle }
  | { t: "num"; v: number; s?: CellStyle }
  | { t: "date"; v: string; s?: CellStyle } // YYYY-MM-DD
  | { t: "formula"; f: string; v: number | string; s?: CellStyle };

export const txt = (v: string, s?: CellStyle): Cell => ({ t: "text", v, s });
export const num = (v: number, s?: CellStyle): Cell => ({ t: "num", v, s });
/** Integer cents -> numeric dollars with a two-decimal format. */
export const money = (cents: number, s: CellStyle = "money"): Cell => ({
  t: "num",
  v: Math.trunc(cents) / 100,
  s,
});
/** A calendar day ("2026-09-12") as a real date cell; blank stays blank. */
export const day = (iso: string): Cell => (iso ? { t: "date", v: iso, s: "date" } : null);
export const fx = (f: string, cached: number | string, s?: CellStyle): Cell => ({
  t: "formula",
  f,
  v: cached,
  s,
});

export type SheetSpec = {
  name: string; // <= 31 chars, none of []:*?/\
  rows: Cell[][];
  /** Column widths in characters. */
  widths?: number[];
  /** Freeze this many top rows (the header). */
  freezeRows?: number;
  /** 1-based row of a filterable table's header; the filter covers every row below it. */
  filterHeaderRow?: number;
  /** Repeat the first N rows on every printed page. */
  printTitleRows?: number;
};

// Style name -> cellXfs index in styles.xml below. Order matters.
const STYLE_INDEX: Record<CellStyle, number> = {
  default: 0,
  header: 1,
  title: 2,
  subtitle: 3,
  bold: 4,
  money: 5,
  moneyTotal: 6,
  rate: 7,
  date: 8,
  int: 9,
  code: 10,
  wrap: 11,
  note: 12,
  good: 13,
  bad: 14,
  total: 15,
};

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="0.00##%"/></numFmts>
<fonts count="7">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="16"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="12"/><color rgb="FF404040"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="10"/><color rgb="FF595959"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF006100"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF9C0006"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE7E6E6"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>
<border><left/><right/><top style="thin"><color auto="1"/></top><bottom/><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="16">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="5" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="6" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="0"/>
<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;

/** 1 -> "A", 27 -> "AA". */
export function colName(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/** "2026-09-12" -> Excel's day serial (1900 date system). */
export function excelSerial(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

// Characters XML 1.0 forbids outright (tab, LF, CR are fine).
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function xmlEscape(s: string): string {
  return s
    .replace(INVALID_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Quote a sheet name for use in a formula: Tax components -> 'Tax components'. */
export function sheetRef(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

/** A string literal inside a formula. */
export function formulaString(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

const MAX_CELL_TEXT = 32_767;

function numText(v: number): string | null {
  if (!Number.isFinite(v)) return null;
  return String(Object.is(v, -0) ? 0 : v);
}

function cellXml(ref: string, c: Exclude<Cell, null>): string {
  const s = STYLE_INDEX[c.s ?? (c.t === "date" ? "date" : "default")];
  const sAttr = s ? ` s="${s}"` : "";
  switch (c.t) {
    case "text": {
      const v = c.v.length > MAX_CELL_TEXT ? c.v.slice(0, MAX_CELL_TEXT) : c.v;
      return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;
    }
    case "num": {
      const v = numText(c.v);
      return v === null ? `<c r="${ref}"${sAttr}/>` : `<c r="${ref}"${sAttr}><v>${v}</v></c>`;
    }
    case "date":
      return `<c r="${ref}"${sAttr}><v>${excelSerial(c.v)}</v></c>`;
    case "formula": {
      const f = `<f>${xmlEscape(c.f)}</f>`;
      if (typeof c.v === "string") {
        return `<c r="${ref}"${sAttr} t="str">${f}<v>${xmlEscape(c.v)}</v></c>`;
      }
      const v = numText(c.v);
      return `<c r="${ref}"${sAttr}>${f}${v === null ? "" : `<v>${v}</v>`}</c>`;
    }
  }
}

function sheetXml(sheet: SheetSpec, index: number): string {
  const width = Math.max(1, ...sheet.rows.map((r) => r.length));
  const height = Math.max(1, sheet.rows.length);
  const lastRef = `${colName(width)}${height}`;
  const parts: string[] = [];
  parts.push(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`,
  );
  parts.push(`<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`);
  parts.push(`<dimension ref="A1:${lastRef}"/>`);
  const selected = index === 0 ? ` tabSelected="1"` : "";
  if (sheet.freezeRows && sheet.freezeRows > 0) {
    const top = `A${sheet.freezeRows + 1}`;
    parts.push(
      `<sheetViews><sheetView workbookViewId="0"${selected}><pane ySplit="${sheet.freezeRows}" topLeftCell="${top}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="${top}" sqref="${top}"/></sheetView></sheetViews>`,
    );
  } else {
    parts.push(`<sheetViews><sheetView workbookViewId="0"${selected}/></sheetViews>`);
  }
  parts.push(`<sheetFormatPr defaultRowHeight="15"/>`);
  if (sheet.widths?.length) {
    parts.push(
      `<cols>${sheet.widths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join("")}</cols>`,
    );
  }
  parts.push(`<sheetData>`);
  sheet.rows.forEach((row, ri) => {
    const cells = row.map((c, ci) => (c ? cellXml(`${colName(ci + 1)}${ri + 1}`, c) : "")).join("");
    if (cells) parts.push(`<row r="${ri + 1}">${cells}</row>`);
  });
  parts.push(`</sheetData>`);
  const filter = filterRange(sheet);
  if (filter) parts.push(`<autoFilter ref="${filter}"/>`);
  parts.push(
    `<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>`,
  );
  parts.push(`<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>`);
  parts.push(`</worksheet>`);
  return parts.join("\n");
}

function filterRange(sheet: SheetSpec): string | null {
  const h = sheet.filterHeaderRow;
  if (!h) return null;
  const header = sheet.rows[h - 1] ?? [];
  const lastCol = Math.max(1, header.length);
  const lastRow = Math.max(h + 1, sheet.rows.length); // at least one row under the header
  return `A${h}:${colName(lastCol)}${lastRow}`;
}

function absolute(range: string): string {
  return range.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2");
}

function validSheetName(name: string): boolean {
  return name.length > 0 && name.length <= 31 && !/[[\]:*?/\\]/.test(name);
}

function w3c(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Build the workbook. `modified` stamps the document properties and the zip
 * entries — pass the result's own timestamp, never "now", to stay reproducible.
 */
export function buildXlsx(
  sheets: SheetSpec[],
  opts: { title: string; modified: Date },
): Uint8Array {
  if (sheets.length === 0) throw new Error("A workbook needs at least one sheet.");
  const names = new Set<string>();
  for (const s of sheets) {
    if (!validSheetName(s.name)) throw new Error(`Invalid sheet name: ${s.name}`);
    const key = s.name.toLowerCase();
    if (names.has(key)) throw new Error(`Duplicate sheet name: ${s.name}`);
    names.add(key);
  }

  const definedNames: string[] = [];
  sheets.forEach((s, i) => {
    const filter = filterRange(s);
    if (filter) {
      definedNames.push(
        `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${xmlEscape(`${sheetRef(s.name)}!${absolute(filter)}`)}</definedName>`,
      );
    }
    if (s.printTitleRows && s.printTitleRows > 0) {
      definedNames.push(
        `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${xmlEscape(`${sheetRef(s.name)}!$1:$${s.printTitleRows}`)}</definedName>`,
      );
    }
  });

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<workbookPr/>
<bookViews><workbookView activeTab="0"/></bookViews>
<sheets>${sheets.map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
${definedNames.length ? `<definedNames>${definedNames.join("")}</definedNames>\n` : ""}<calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join(
      "",
    )}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join(
      "",
    )}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;

  const stamp = w3c(opts.modified);
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(opts.title)}</dc:title><dc:creator>Twin Oaks OS</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified></cp:coreProperties>`;

  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Twin Oaks OS</Application></Properties>`;

  const files: Zippable = {
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRels),
    "docProps/core.xml": strToU8(core),
    "docProps/app.xml": strToU8(app),
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRels),
    "xl/styles.xml": strToU8(STYLES_XML),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s, i));
  });

  // Zip entry times are local wall-clock fields; build the Date from the UTC
  // parts so every server writes identical bytes whatever its timezone.
  const m = opts.modified;
  const mtime = new Date(
    Math.max(1980, m.getUTCFullYear()),
    m.getUTCMonth(),
    m.getUTCDate(),
    m.getUTCHours(),
    m.getUTCMinutes(),
    m.getUTCSeconds(),
  );
  return zipSync(files, { level: 6, mtime });
}
