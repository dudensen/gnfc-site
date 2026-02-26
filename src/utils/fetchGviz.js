// src/utils/fetchGviz.js
function stripGviz(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("Invalid GViz response");
  return JSON.parse(text.slice(start, end + 1));
}

function cellValue(cell) {
  if (!cell) return "";
  if (cell.f != null) return String(cell.f);
  if (cell.v != null) return String(cell.v);
  return "";
}

function makeUniqueHeaders(headers) {
  const seen = new Map();
  return headers.map((h) => {
    const key = String(h || "").trim() || "col";
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    return n === 1 ? key : `${key}__${n}`; // e.g. "FG%__2"
  });
}

export async function fetchSheetGviz({ sheetId, gid }) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&gid=${gid}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const text = await res.text();

  const payload = stripGviz(text);
  const cols = payload?.table?.cols ?? [];
  const rows = payload?.table?.rows ?? [];

  const rawHeaders = cols.map((c, i) => (c.label && String(c.label).trim()) || `col_${i}`);
  const headers = makeUniqueHeaders(rawHeaders);

  const data = rows.map((r) => {
    const out = {};
    const cells = r.c ?? [];
    headers.forEach((h, i) => (out[h] = cellValue(cells[i])));
    return out;
  });

  return { headers, data, rawHeaders };
}

// ADD THIS to src/utils/fetchGviz.js (do not remove your existing functions)

function stripGvizToJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Invalid GViz response");
  return JSON.parse(text.slice(start, end + 1));
}


export async function fetchSheetGvizGrid({ sheetId, gid }) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&gid=${gid}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const text = await res.text();

  const payload = stripGvizToJson(text);
  const cols = payload?.table?.cols ?? [];
  const rows = payload?.table?.rows ?? [];

  // return raw grid by index, ignoring labels entirely
  const grid = rows.map(r => (r.c ?? []).map(cellValue));

  return { grid, colCount: cols.length };
}