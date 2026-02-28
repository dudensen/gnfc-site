// src/pages/HistoryPage.jsx
import React, { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { RANKING_SHEET_ID, RANKING_GIDS } from "../config/rankingGids"

/* ----------------------------- tiny utils ----------------------------- */

function s(x) {
  return String(x ?? "").replace(/\r/g, "").trim()
}
function norm(x) {
  return s(x).toLowerCase().replace(/\s+/g, " ")
}
function toNum(v) {
  const t = s(v).replace(/[%,$]/g, "").trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
function cell(v) {
  const t = s(v)
  return t ? t : "—"
}
function teamHref(teamName) {
  return `/team/${encodeURIComponent(s(teamName))}`
}

/* ----------------------------- config ----------------------------- */

const TEAM_COL = "Team"
const LEAGUE_COL = "League"
const LEAGUE_RANK_COL = "League Ranking"

// These exist (sometimes twice). Tab picks which version to use.
const RANK_COL = "Category Standing"
const BASE_COLS = ["GP", "FG%", "3P", "FT%", "PTS", "REB", "AST", "ST", "BLK", "TO"]

function isHigherBetterForTab(baseCol, tab) {
  const c = norm(baseCol)

  if (tab === "rankings") {
    // rankings tab: smaller is ALWAYS better
    return false
  }

  // totals tab: bigger is better, except TO (smaller is better)
  if (c === "to") return false
  return true
}

function parseStat(_col, v) {
  return toNum(v)
}

/* ----------------------------- CSV fetch + parse ----------------------------- */

function csvUrl(sheetId, gid) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${encodeURIComponent(
    gid
  )}`
}

// Simple but solid CSV parser (quoted commas + escaped quotes)
function parseCSV(text) {
  const rows = []
  let row = []
  let cur = ""
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]

    if (inQuotes) {
      if (ch === `"` && next === `"`) {
        cur += `"`
        i++
      } else if (ch === `"`) {
        inQuotes = false
      } else {
        cur += ch
      }
      continue
    }

    if (ch === `"`) {
      inQuotes = true
      continue
    }

    if (ch === ",") {
      row.push(cur)
      cur = ""
      continue
    }

    if (ch === "\n") {
      row.push(cur)
      rows.push(row)
      row = []
      cur = ""
      continue
    }

    if (ch === "\r") continue
    cur += ch
  }

  row.push(cur)
  rows.push(row)
  return rows
}

/**
 * Header row is where column B (index 1) === "Team"
 */
function findHeaderRowIndex(rows) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || []
    if (norm(row[1]) === "team") return i
  }
  return -1
}

/**
 * If header appears twice, rename 2nd occurrence to "X_2", 3rd to "X_3" etc.
 * Example: GP, FG%, ... => GP_2, FG%_2 ...
 */
function dedupeHeadersWithNumericSuffix(headerRow) {
  const seen = new Map()
  return (headerRow || []).map((raw) => {
    const h = s(raw).replace(/\s+/g, " ").trim()
    if (!h) return ""

    const cnt = (seen.get(h) || 0) + 1
    seen.set(h, cnt)

    if (cnt === 1) return h
    return `${h}_${cnt}`
  })
}

function buildItemsFromSingleHeader(rows) {
  const headerIdx = findHeaderRowIndex(rows)
  if (headerIdx < 0) {
    throw new Error('Could not detect header row. Expected "Team" in column B.')
  }

  const rawHeaderRow = rows[headerIdx] || []
  const headerRow = dedupeHeadersWithNumericSuffix(rawHeaderRow)

  const headers = headerRow.filter(Boolean)

  const items = []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || []
    if (!r.some((v) => s(v))) continue

    const obj = {}
    const n = Math.min(headerRow.length, r.length)
    for (let j = 0; j < n; j++) {
      const h = headerRow[j]
      if (!h) continue
      obj[h] = r[j]
    }

    // Must have Team + League to count as a team row
    if (!s(obj[TEAM_COL]) || !s(obj[LEAGUE_COL])) continue

    items.push(obj)
  }

  return { headers, items, headerIdx }
}

/* ----------------------------- tab helpers ----------------------------- */

function keyForTab(baseKey, tab) {
  // totals -> first occurrence
  // rankings -> second occurrence (suffix _2)
  return tab === "rankings" ? `${baseKey}_2` : baseKey
}

function pickKey(items, baseKey, tab) {
  // Use tab key if it exists anywhere, else fallback to base key
  const k = keyForTab(baseKey, tab)
  const hasTabKey = items?.some((r) => r && r[k] != null && s(r[k]) !== "")
  return hasTabKey ? k : baseKey
}

/* ----------------------------- component ----------------------------- */

export default function HistoryPage() {
  const navigate = useNavigate()
  const { year: yearParam } = useParams()

  const yearOptions = useMemo(() => {
    return Object.keys(RANKING_GIDS || {})
      .map((k) => s(k))
      .filter((k) => /^\d{4}$/.test(k))
      .sort((a, b) => Number(b) - Number(a))
  }, [])

  const defaultYear = yearOptions[0] || "2025"
  const year = s(yearParam) || defaultYear
  const gid = RANKING_GIDS?.[year]

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")
  const [headers, setHeaders] = useState([])
  const [items, setItems] = useState([])

  // Tabs: Totals (default) / Rankings
  const [activeTab, setActiveTab] = useState("totals") // totals | rankings

  useEffect(() => {
    let alive = true
    async function run() {
      try {
        setLoading(true)
        setErr("")

        if (!gid) throw new Error(`No GID found for year ${year} in rankingGids.js`)

        const url = csvUrl(RANKING_SHEET_ID, gid)
        const res = await fetch(url)
        if (!res.ok) throw new Error(`CSV fetch failed (${res.status})`)

        const txt = await res.text()
        const rows = parseCSV(txt)

        const built = buildItemsFromSingleHeader(rows)

        if (!alive) return
        setHeaders(built.headers)
        setItems(built.items)

        // default tab = totals
        setActiveTab("totals")
      } catch (e) {
        if (!alive) return
        setErr(e?.message || "Failed to load history")
      } finally {
        if (!alive) return
        setLoading(false)
      }
    }

    run()
    return () => {
      alive = false
    }
  }, [year, gid])

  // Resolve which keys to use per tab (if _2 doesn't exist, fallback to base)
  const tabRankKey = useMemo(() => pickKey(items, RANK_COL, activeTab), [items, activeTab])
  const tabLeagueRankKey = useMemo(
    () => pickKey(items, LEAGUE_RANK_COL, activeTab),
    [items, activeTab]
  )

  const tabCols = useMemo(() => {
    // columns for the active tab (GP vs GP_2 etc), with fallback if missing
    return BASE_COLS.map((c) => pickKey(items, c, activeTab))
  }, [items, activeTab])

  // Podiums: Top 3 per league based on League + League Ranking (tab-sensitive for ranking key)
  const leagueCards = useMemo(() => {
    if (!items?.length) return []

    const hasLeague = items.some((r) => s(r?.[LEAGUE_COL]))
    const hasLeagueRank = items.some((r) => s(r?.[tabLeagueRankKey]))
    if (!hasLeague || !hasLeagueRank) return []

    const map = new Map()
    for (const r of items) {
      const league = s(r?.[LEAGUE_COL])
      if (!league) continue
      if (!map.has(league)) map.set(league, [])
      map.get(league).push(r)
    }

    const leagueKeys = Array.from(map.keys()).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    )

    return leagueKeys.map((lk) => {
      const rows = map.get(lk) || []
      const sorted = [...rows].sort(
        (x, y) => (toNum(x?.[tabLeagueRankKey]) ?? 999999) - (toNum(y?.[tabLeagueRankKey]) ?? 999999)
      )
      return { league: lk, total: rows.length, top3: sorted.slice(0, 3) }
    })
  }, [items, tabLeagueRankKey])

  // Top/bottom 5 per category for ACTIVE tab
  const catRanks = useMemo(() => {
    const out = {}

    for (let i = 0; i < BASE_COLS.length; i++) {
      const baseCol = BASE_COLS[i]
      const col = tabCols[i] // resolved key (e.g., GP or GP_2)

      const arr = items
        .map((r) => {
          const team = s(r?.[TEAM_COL])
          const val = parseStat(baseCol, r?.[col])
          return { team, val }
        })
        .filter((x) => x.team && x.val != null)

      if (!arr.length) {
        out[col] = { top5: new Set(), bottom5: new Set() }
        continue
      }

      const higherBetter = isHigherBetterForTab(baseCol, activeTab)
      arr.sort((a, b) => (higherBetter ? b.val - a.val : a.val - b.val))

      out[col] = {
        top5: new Set(arr.slice(0, 5).map((x) => x.team)),
        bottom5: new Set(arr.slice(-5).map((x) => x.team))
      }
    }

    return out
  }, [items, tabCols])

  // Full standings sorted by (tab) Category Standing
  const fullSorted = useMemo(() => {
    const copy = [...items]
    copy.sort((a, b) => (toNum(a?.[tabRankKey]) ?? 999999) - (toNum(b?.[tabRankKey]) ?? 999999))
    return copy
  }, [items, tabRankKey])

  const yearSelectStyle = {
    background: "#ffffff",
    border: "1px solid rgba(15, 23, 42, .14)",
    color: "#0f172a",
    padding: "8px 10px",
    borderRadius: 12,
    fontWeight: 800,
    boxShadow: "0 6px 18px rgba(2,6,23,.06)"
  }

  const hasSecondSet = useMemo(() => {
    // if any of the important columns exist with _2, enable Rankings tab
    const sample = [`${RANK_COL}_2`, `${LEAGUE_RANK_COL}_2`, ...BASE_COLS.map((c) => `${c}_2`)]
    return items.some((r) => sample.some((k) => s(r?.[k])))
  }, [items])

  return (
    <div className="histPage">
      {/* header bar */}
      <div className="histHeader">
        <div className="brandRow">
          <div
            className="brandLeft"
            onClick={() => navigate("/")}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && navigate("/")}
          >
            <img src="/gnfc-logo.png" alt="GNFC Logo" className="logo" />
            <div>
              <div className="titleMain">The Greek NBA Fantasy Championship</div>
              <div className="crumbs">Rankings • History</div>
            </div>
          </div>

          <div className="brandRight">
            <select
              value={year}
              onChange={(e) => navigate(`/history/${encodeURIComponent(e.target.value)}`)}
              style={yearSelectStyle}
              aria-label="Select year"
              disabled={loading || !yearOptions.length}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>

            <Link to="/" className="ghostBtn">
              Home
            </Link>
          </div>
        </div>
      </div>

      <div className="histWrap">
        {err && <div className="note error">{err}</div>}
        {loading && <div className="note">Loading season {year}…</div>}

        {!loading && !err && (
          <>
            {/* Top row */}
            <div className="topRow">
              <div className="card">
                <div className="cardHead">
                  <div className="cardTitle">Season</div>
                  <div className="cardMeta">{items.length} teams</div>
                </div>

                <div className="bigYear">{year}</div>

                <div className="miniMeta">
                  <span className="chip">GID: {gid}</span>
                  <span className="chip">CSV export (no GViz)</span>
                  <span className="chip">Header: col B = Team</span>
                </div>

                {/* Tabs */}
                <div className="tabs" style={{ marginTop: 12 }}>
                  <button
                    className={`tabBtn ${activeTab === "totals" ? "active" : ""}`}
                    onClick={() => setActiveTab("totals")}
                    type="button"
                  >
                    Totals
                  </button>

                  <button
                    className={`tabBtn ${activeTab === "rankings" ? "active" : ""}`}
                    onClick={() => setActiveTab("rankings")}
                    type="button"
                    disabled={!hasSecondSet}
                    title={!hasSecondSet ? "Second header set not detected" : ""}
                  >
                    Rankings
                  </button>
                </div>

                {/* optional debug */}
                {/* <div style={{ marginTop: 10, fontSize: 12, color: "rgba(15,23,42,.6)", fontWeight: 900 }}>
                  headers: {headers.join(" | ")}
                </div> */}
              </div>

              <div className="card">
                <div className="cardHead">
                  <div className="cardTitle">Podiums</div>
                  <div className="cardMeta">Top 3 per league</div>
                </div>

                {leagueCards.length ? (
                  <div className="leagueGrid">
                    {leagueCards.map((c) => (
                      <LeaguePodiumCard
                        key={`${activeTab}-${c.league}`}
                        league={c.league}
                        total={c.total}
                        top3={c.top3}
                        leagueRankKey={tabLeagueRankKey}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="noteLite">No League/League Ranking columns found.</div>
                )}
              </div>
            </div>

            {/* Full standings (active tab) */}
            <div className="card tableCard">
              <div className="cardHead">
                <div className="cardTitle">Full standings</div>
                <div className="cardMeta">
                  tab: <b>{activeTab}</b> • ranked by <b>{tabRankKey}</b> • top 5 green • bottom 5 red
                </div>
              </div>

              <div className="tableWrap">
                <table className="tbl tblTight">
                  <thead>
                    <tr>
                      <th className="colRank">#</th>
                      <th className="colTeam">Team</th>
                      {tabCols.map((h, i) => (
                        <th key={`${h}-${i}`} className="colStat">
                          {/* show base label, not suffix */}
                          {BASE_COLS[i]}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {fullSorted.map((r, idx) => {
                      const team = s(r?.[TEAM_COL])
                      const rank = toNum(r?.[tabRankKey]) ?? idx + 1

                      return (
                        <tr key={`${team}-${idx}`}>
                          <td className="rankCell">{rank}</td>

                          <td>
                            {team ? (
                              <Link className="teamLink" to={teamHref(team)}>
                                {team}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>

                          {tabCols.map((colKey, i) => {
                            const v = r?.[colKey]
                            const info = catRanks[colKey] || { top5: new Set(), bottom5: new Set() }
                            const isTop = team && info.top5.has(team)
                            const isBot = team && info.bottom5.has(team)

                            const pillClass = isTop ? "pillStat green" : isBot ? "pillStat red" : ""

                            return (
                              <td key={`${colKey}-${i}`} className="numCell">
                                {pillClass ? (
                                  <span className={pillClass}>{cell(v)}</span>
                                ) : (
                                  <span className="num">{cell(v)}</span>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      <style>{styles}</style>
    </div>
  )
}

/* ----------------------------- Podium Card (NO manager) ----------------------------- */

function LeaguePodiumCard({ league, total, top3, leagueRankKey }) {
  return (
    <div className="leagueCard">
      <div className="leagueCardHead">
        <div className="leagueTitle">{league}</div>
        <div className="leagueMeta">{total} teams</div>
      </div>

      <div className="podTable">
        <div className="podRow podHeader">
          <div className="cRank">#</div>
          <div className="cTeam">Team</div>
        </div>

        {top3.map((r, i) => {
          const lr = toNum(r?.[leagueRankKey]) ?? i + 1
          const team = s(r?.[TEAM_COL])

          return (
            <div className="podRow" key={`${league}-${i}`}>
              <div className="cRank">
                <span className={`rankPill r${Math.min(3, i + 1)}`}>{lr}</span>
              </div>

              <div className="cTeam">
                {team ? (
                  <Link className="teamLink" to={teamHref(team)}>
                    {team}
                  </Link>
                ) : (
                  "—"
                )}
              </div>
            </div>
          )
        })}

        {!top3.length && <div className="empty">No teams found for this league.</div>}
      </div>
    </div>
  )
}

/* ----------------------------- styles ----------------------------- */

const styles = `
.histPage { min-height: 100vh; background: #f6fbfb; color: #0f172a; }

.histHeader {
  background: #eaf6f6;
  border-bottom: 1px solid rgba(15,23,42,.08);
  padding: 14px 16px;
}

.brandRow {
  max-width: 1320px;
  margin: 0 auto;
  display: flex;
  gap: 14px;
  align-items: center;
  justify-content: space-between;
}

.brandLeft { display: flex; align-items: center; gap: 12px; cursor: pointer; }

.logo {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  box-shadow: 0 10px 22px rgba(2,6,23,.10);
}

.titleMain { font-weight: 900; font-size: 18px; line-height: 1.1; }
.crumbs { color: rgba(15,23,42,.70); font-size: 12.5px; font-weight: 700; margin-top: 3px; }

.brandRight { display: flex; align-items: center; gap: 10px; }
.ghostBtn {
  text-decoration: none;
  font-weight: 900;
  color: #0f172a;
  padding: 8px 12px;
  border-radius: 12px;
  border: 1px solid rgba(15,23,42,.12);
  background: rgba(255,255,255,.65);
  box-shadow: 0 6px 18px rgba(2,6,23,.06);
}
.ghostBtn:hover { border-color: rgba(249,115,22,.35); }

.histWrap { max-width: 1320px; margin: 0 auto; padding: 16px; }

.note {
  background: rgba(255,255,255,.8);
  border: 1px solid rgba(15,23,42,.12);
  border-left: 4px solid rgba(249,115,22,.75);
  padding: 12px 12px;
  border-radius: 14px;
  box-shadow: 0 12px 30px rgba(2,6,23,.06);
  font-weight: 900;
}
.note.error { border-left-color: rgba(239,68,68,.75); color: #991b1b; }
.noteLite {
  background: rgba(255,255,255,.72);
  border: 1px dashed rgba(15,23,42,.18);
  padding: 12px;
  border-radius: 14px;
  font-weight: 900;
  color: rgba(15,23,42,.65);
}

/* layout */
.topRow { display: grid; grid-template-columns: 360px 1fr; gap: 14px; }
@media (max-width: 980px) { .topRow { grid-template-columns: 1fr; } }

.card {
  background: rgba(255,255,255,.86);
  border: 1px solid rgba(249,115,22,.30);
  border-radius: 18px;
  box-shadow: 0 16px 40px rgba(2,6,23,.06);
  padding: 14px;
}

.cardHead { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.cardTitle { font-weight: 1000; letter-spacing: .04em; text-transform: uppercase; color: rgba(15,23,42,.90); }
.cardMeta { font-size: 12px; font-weight: 900; color: rgba(15,23,42,.55); }

.bigYear { font-size: 46px; font-weight: 1000; letter-spacing: -0.02em; margin-top: 4px; }
.miniMeta { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 8px; }

.chip {
  display: inline-flex;
  align-items: center;
  border: 1px solid rgba(15,23,42,.10);
  background: rgba(255,255,255,.75);
  padding: 6px 10px;
  border-radius: 999px;
  font-weight: 900;
  font-size: 12px;
  color: rgba(15,23,42,.75);
}

/* tabs */
.tabs { display: flex; gap: 10px; flex-wrap: wrap; }
.tabBtn {
  appearance: none;
  border: 1px solid rgba(15,23,42,.12);
  background: rgba(255,255,255,.75);
  border-radius: 999px;
  padding: 8px 12px;
  font-weight: 1000;
  cursor: pointer;
  box-shadow: 0 10px 20px rgba(2,6,23,.06);
}
.tabBtn:hover { border-color: rgba(249,115,22,.35); }
.tabBtn.active {
  border-color: rgba(249,115,22,.55);
  background: rgba(249,115,22,.10);
}
.tabBtn:disabled { opacity: .45; cursor: not-allowed; box-shadow: none; }

/* league podium cards grid */
.leagueGrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 1200px) { .leagueGrid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 920px) { .leagueGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { .leagueGrid { grid-template-columns: 1fr; } }

.leagueCard {
  border: 1px solid rgba(15,23,42,.10);
  background: rgba(255,255,255,.78);
  border-radius: 16px;
  padding: 12px;
}

.leagueCardHead { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.leagueTitle { font-weight: 1000; font-size: 18px; }
.leagueMeta { font-weight: 900; font-size: 12px; color: rgba(15,23,42,.55); }

.podTable { display: grid; gap: 8px; }
.podRow { display: grid; grid-template-columns: 42px 1fr; gap: 10px; align-items: center; }
.podHeader {
  font-weight: 1000; font-size: 11px; letter-spacing: .04em; text-transform: uppercase;
  color: rgba(15,23,42,.60); padding-bottom: 6px; border-bottom: 1px solid rgba(15,23,42,.08);
}

.rankPill {
  display: inline-flex; min-width: 32px; height: 28px; align-items: center; justify-content: center;
  border-radius: 999px; font-weight: 1000; border: 1px solid rgba(15,23,42,.12);
  background: rgba(255,255,255,.7); box-shadow: 0 10px 20px rgba(2,6,23,.06);
  font-variant-numeric: tabular-nums;
}
.rankPill.r1 { border-color: rgba(245,158,11,.45); background: rgba(245,158,11,.14); }
.rankPill.r2 { border-color: rgba(148,163,184,.55); background: rgba(148,163,184,.18); }
.rankPill.r3 { border-color: rgba(234,88,12,.45); background: rgba(234,88,12,.14); }

.teamLink { color: rgba(15,23,42,.95); font-weight: 1000; text-decoration: none; }
.teamLink:hover { color: rgb(249,115,22); text-decoration: underline; }
.empty { color: rgba(15,23,42,.55); font-weight: 900; font-size: 12.5px; }

/* tables */
.tableCard { margin-top: 14px; }
.tableWrap {
  overflow: auto;
  border-radius: 14px;
  border: 1px solid rgba(15,23,42,.10);
  background: rgba(255,255,255,.85);
}

.tbl { width: 100%; border-collapse: collapse; min-width: 980px; }
.tbl th, .tbl td { padding: 9px 10px; border-bottom: 1px solid rgba(15,23,42,.08); font-size: 13px; }
.tbl th {
  position: sticky; top: 0;
  background: rgba(255,255,255,.92);
  text-align: left;
  font-weight: 1000;
  text-transform: uppercase;
  letter-spacing: .04em;
  font-size: 11.5px;
  color: rgba(15,23,42,.70);
  user-select: none;
}

.tbl tr:hover td { background: rgba(249,115,22,.06); }

.tblTight { min-width: 980px; }
.colRank { width: 54px; }
.colTeam { min-width: 220px; }
.colStat { width: 86px; }
.rankCell { font-weight: 1000; }
.numCell, .num { font-variant-numeric: tabular-nums; }

/* pills for top/bottom 5 */
.pillStat {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 10px;
  border-radius: 999px;
  font-weight: 1000;
  border: 1px solid rgba(15,23,42,.12);
  background: rgba(255,255,255,.75);
  box-shadow: 0 10px 18px rgba(2,6,23,.06);
}
.pillStat.green { border-color: rgba(34,197,94,.45); background: rgba(34,197,94,.14); color: rgba(15,23,42,.95); }
.pillStat.red { border-color: rgba(239,68,68,.45); background: rgba(239,68,68,.14); color: rgba(15,23,42,.95); }
`