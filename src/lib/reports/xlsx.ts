/**
 * A report table as a real Excel file (.xlsx), made on the phone with nothing but the zip library
 * already in the app. One sheet, a bold header row that stays put when you scroll, numbers as numbers
 * (money with two decimals), dates as dates (dd/mm/yyyy), total rows in bold, columns wide enough
 * to read. Text is stored as UTF-8 inside the file, so names with accents or the euro sign cannot
 * turn into odd characters the way a plain CSV can in some programs.
 */
import { strToU8, zipSync } from 'fflate';
import type { FlatTable } from './doc';

const esc = (s: string) => s
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A1, B1 ... Z1, AA1 */
const colName = (i: number): string => { let n = i + 1; let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

/** Days since 30 Dec 1899, which is how a spreadsheet stores a date */
function serial(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return Math.round((Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - Date.UTC(1899, 11, 30)) / 86400000);
}

// Cell styles: 0 plain, 1 header, 2 money, 3 date, 4 whole number, then the bold versions of 0, 2 and 4
const S = { plain: 0, head: 1, money: 2, date: 3, int: 4, boldText: 5, boldMoney: 6, boldInt: 7 } as const;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F1E4"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF3B4A3A"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment horizontal="left"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>
<xf numFmtId="1" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const sheetName = (s: string) => esc(s.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Report');

export function tableXlsx(t: FlatTable, name: string): Uint8Array {
  const strong = new Set(t.strong ?? []);
  const widths = t.columns.map((c) => Math.max(c.label.length, 8));
  const rowsXml: string[] = [];
  rowsXml.push(`<row r="1" ht="22" customHeight="1">${t.columns.map((c, i) => `<c r="${colName(i)}1" s="${S.head}" t="inlineStr"><is><t>${esc(c.label)}</t></is></c>`).join('')}</row>`);
  t.rows.forEach((row, ri) => {
    const r = ri + 2;
    const cells = t.columns.map((c, i) => {
      const v = row[i];
      const ref = `${colName(i)}${r}`;
      if (v === null || v === undefined || v === '') return '';
      const bold = strong.has(ri);
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) return '';
        widths[i] = Math.max(widths[i], v.toFixed(2).length + 3);
        const style = c.type === 'money' ? (bold ? S.boldMoney : S.money) : (bold ? S.boldInt : S.int);
        return `<c r="${ref}" s="${style}"><v>${c.type === 'money' ? Math.round((v + Number.EPSILON) * 100) / 100 : v}</v></c>`;
      }
      if (c.type === 'date') {
        const d = serial(v);
        if (d !== null) { widths[i] = Math.max(widths[i], 11); return `<c r="${ref}" s="${S.date}"><v>${d}</v></c>`; }
      }
      widths[i] = Math.max(widths[i], Math.min(v.length + 2, 48));
      return `<c r="${ref}" s="${bold ? S.boldText : S.plain}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('');
    rowsXml.push(`<row r="${r}">${cells}</row>`);
  });
  const last = `${colName(Math.max(t.columns.length - 1, 0))}${t.rows.length + 1}`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${last}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(w + 2, 52)}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rowsXml.join('')}</sheetData>
</worksheet>`;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(STYLES),
    'xl/worksheets/sheet1.xml': strToU8(sheet)
  };
  return zipSync(files, { level: 6 });
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
