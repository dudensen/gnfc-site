// src/pages/ChampionsRacePage.jsx
import React, { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"

/* ----------------------------- config ----------------------------- */

const SHEET_ID = "1Z8EbGi1rGDhg7dAQoPypJ2FTUQoMO730yx3Mm-cEMow"
const GID = "1647785996"
const START_COL = "BI"

/* ----------------------------- tiny utils ----------------------------- */

function s(x) {
  return String(x ?? "").replace(/\r/g, "").trim()
}

function norm(x) {
  return s(x).toLowerCase().replace(/\s+/g, " ")
}

function cell(v) {
  const x = s(v)
  return x || "—"
}

function colToIndex(col) {
  let n = 0
  const t = s(col).toUpperCase()
  for (let i = 0; i < t.length; i++) {
    n = n * 26 + (t.charCodeAt(i) - 64)
  }
  return Math.max(0, n - 1)
}

function isRowEmpty(arr = []) {
  return !arr.some(v => s(v))
}

function parseCsvLine(line) {
  const out = []
  let cur = ""
  let q = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    const nx = line[i + 1]

    if (ch === `"`) {
      if (q && nx === `"`) {
        cur += `"`
        i++
      } else {
        q = !q
      }
    } else if (ch === "," && !q) {
      out.push(cur)
      cur = ""
    } else {
      cur += ch
    }
  }

  out.push(cur)
  return out
}

function parseCsv(text) {
  return String(text ?? "")
    .replace(/^\uFEFF/, "")
    .split(/\n/)
    .map(parseCsvLine)
}

function getNonEmptyBounds(row) {
  const idxs = row
    .map((v, i) => (s(v) ? i : -1))
    .filter(i => i >= 0)

  if (!idxs.length) return null
  return { left: idxs[0], right: idxs[idxs.length - 1] }
}

function trimColumns(headers, rows) {
  const keep = headers.map((h, c) => {
    const hasHeader = s(h)
    const hasData = rows.some(r => s(r[c]) && r[c] !== "—")
    return hasHeader || hasData
  })

  return {
    headers: headers.filter((_, i) => keep[i]),
    rows: rows.map(r => r.filter((_, i) => keep[i])),
  }
}

function cleanTitle(title) {
  return s(title)
    .replace(/\s+/g, " ")
    .replace(/\bcategory champion\b/i, "Category Champion")
    .replace(/\bchampion\b/i, "Champion")
}

function findTeamColumn(headers = []) {
  const exact = headers.findIndex(h => norm(h) === "team")
  if (exact >= 0) return exact

  const includesTeam = headers.findIndex(h => norm(h).includes("team"))
  if (includesTeam >= 0) return includesTeam

  return headers.length > 1 ? 1 : 0
}

function teamLink(name) {
  return `/team/${encodeURIComponent(s(name))}`
}

function isProbablyNumeric(v) {
  const t = s(v).replace(/[%,$]/g, "")
  return !!t && !Number.isNaN(Number(t))
}

function looksLikeTeamName(v) {
  const t = s(v)
  if (!t) return false
  if (isProbablyNumeric(t)) return false
  if (t.length < 2) return false

  const bad = [
    "final",
    "semifinal",
    "group",
    "stage",
    "team",
    "w",
    "l",
    "t",
    "w%",
    "rank",
    "standing",
    "category champion",
    "champion",
  ]
  const n = norm(t)
  if (bad.includes(n)) return false

  return /[a-zα-ω]/i.test(t)
}

function firstTextCell(row = []) {
  for (const v of row) {
    if (looksLikeTeamName(v)) return s(v)
  }
  return ""
}

function findScoreInRow(row = []) {
  const nums = row
    .map(v => s(v))
    .filter(v => /^-?\d+(\.\d+)?$/.test(v))

  if (!nums.length) return ""
  if (nums.length === 1) return nums[0]
  return nums[0]
}

/* ----------------------------- champion extraction ----------------------------- */

function isChampionTitleRow(row) {
  const vals = row.map(s).filter(Boolean)
  if (!vals.length) return false

  return vals.some(v => {
    const t = norm(v)
    return t.includes("category champion") || t.includes("champion")
  })
}

function extractBlocks(rows) {
  const startIdx = colToIndex(START_COL)
  const sliced = rows.map(r => r.slice(startIdx))
  const blocks = []

  for (let r = 0; r < sliced.length; r++) {
    const row = sliced[r] || []
    if (!isChampionTitleRow(row)) continue

    const titleBounds = getNonEmptyBounds(row)
    if (!titleBounds) continue

    const title = row.slice(titleBounds.left, titleBounds.right + 1).map(s).join(" ").trim()

    let headerRow = -1
    for (let k = r + 1; k < sliced.length; k++) {
      if (!isRowEmpty(sliced[k])) {
        headerRow = k
        break
      }
    }
    if (headerRow < 0) continue

    const hBounds = getNonEmptyBounds(sliced[headerRow])
    if (!hBounds) continue

    const left = Math.min(titleBounds.left, hBounds.left)
    const right = Math.max(titleBounds.right, hBounds.right)

    const headers = sliced[headerRow].slice(left, right + 1).map(cell)

    const outRows = []
    let emptyStreak = 0

    for (let k = headerRow + 1; k < sliced.length; k++) {
      const next = sliced[k] || []

      if (isChampionTitleRow(next)) break

      const blockRow = next.slice(left, right + 1)

      if (isRowEmpty(blockRow)) {
        emptyStreak++
        if (emptyStreak >= 2) break
        continue
      }

      emptyStreak = 0
      outRows.push(blockRow.map(cell))
    }

    const trimmed = trimColumns(headers, outRows)

    if (trimmed.headers.length && trimmed.rows.length) {
      blocks.push({
        title: cleanTitle(title || "Champions Race"),
        headers: trimmed.headers,
        rows: trimmed.rows,
        teamCol: findTeamColumn(trimmed.headers),
      })
    }

    r = Math.max(r, headerRow)
  }

  return blocks
}

/* ----------------------------- finals extraction ----------------------------- */

function isFinalTitleText(text) {
  const t = norm(text)
  if (!t) return false
  if (t.includes("semifinal")) return false
  if (t.includes("final 8")) return false
  return t === "final" || t.includes(" final") || t.startsWith("final ")
}

function rowHasFinalTitle(row = []) {
  return row.some(v => isFinalTitleText(v))
}

function rowText(row = []) {
  return row.map(s).filter(Boolean).join(" ").trim()
}

function extractFinalMatchups(rows) {
  const finals = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || []
    if (!rowHasFinalTitle(row)) continue

    const title = rowText(row) || "Final"
    const candidates = []

    for (let k = i + 1; k < Math.min(rows.length, i + 8); k++) {
      const next = rows[k] || []
      if (isRowEmpty(next)) {
        if (candidates.length >= 2) break
        continue
      }
      if (rowHasFinalTitle(next)) break
      if (isChampionTitleRow(next)) break

      const team = firstTextCell(next)
      if (!team) continue

      candidates.push({
        team,
        score: findScoreInRow(next),
      })

      if (candidates.length >= 2) break
    }

    if (candidates.length >= 2) {
      finals.push({
        title,
        teamA: candidates[0].team,
        scoreA: candidates[0].score,
        teamB: candidates[1].team,
        scoreB: candidates[1].score,
      })
    }
  }

  const seen = new Set()
  return finals.filter(f => {
    const key = `${norm(f.title)}|${norm(f.teamA)}|${norm(f.teamB)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/* ----------------------------- ui helpers ----------------------------- */

function renderCell(value, cIdx, block) {
  const v = cell(value)
  const isTeam = cIdx === block.teamCol

  if (isTeam && v !== "—" && !isProbablyNumeric(v)) {
    return (
      <Link
        to={teamLink(v)}
        style={{
          color: "inherit",
          textDecoration: "none",
          fontWeight: 700,
        }}
      >
        {v}
      </Link>
    )
  }

  return v
}

/* ----------------------------- component ----------------------------- */

export default function ChampionsRacePage() {
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [rawRows, setRawRows] = useState([])

  useEffect(() => {
    let dead = false

    async function run() {
      try {
        setLoading(true)
        setError("")

        const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`
        const res = await fetch(url, { cache: "no-store" })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const text = await res.text()
        if (dead) return

        setRawRows(parseCsv(text))
      } catch (e) {
        if (!dead) setError(`Failed to load Champions Race table: ${e.message}`)
      } finally {
        if (!dead) setLoading(false)
      }
    }

    run()
    return () => {
      dead = true
    }
  }, [])

  const blocks = useMemo(() => extractBlocks(rawRows), [rawRows])
  const finals = useMemo(() => extractFinalMatchups(rawRows), [rawRows])

  return (
    <div className="page-shell">
      <div className="topbar">
        <div className="brand">
          <Link to="/" style={{ display: "inline-flex", textDecoration: "none" }}>
            <img src="/gnfc-logo.png" alt="GNFC Logo" />
          </Link>

          <div className="brand-title">
            <h1>Champions Race</h1>
            <p>Category champion standings</p>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="badge"
              onClick={() => navigate(-1)}
              style={{ cursor: "pointer", border: "none" }}
            >
              Back
            </button>

            <Link to="/" className="badge" style={{ textDecoration: "none" }}>
              Home
            </Link>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card">
          <div className="section-title">Loading…</div>
        </div>
      ) : error ? (
        <div className="card">
          <div className="section-title">Error</div>
          <div style={{ color: "#b91c1c", fontWeight: 700 }}>{error}</div>
        </div>
      ) : (
        <>
          {!!finals.length && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="section-title">Finals Matchups</div>

              <div
                style={{
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                }}
              >
                {finals.map((m, idx) => (
                  <div
                    key={`${m.title}-${idx}`}
                    style={{
                      border: "1px solid var(--line, rgba(0,0,0,.08))",
                      borderRadius: 16,
                      padding: 14,
                      background: "var(--card, rgba(255,255,255,.55))",
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 800,
                        marginBottom: 10,
                        color: "var(--text, inherit)",
                      }}
                    >
                      {m.title}
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr auto",
                          gap: 12,
                          alignItems: "center",
                        }}
                      >
                        <Link
                          to={teamLink(m.teamA)}
                          style={{
                            color: "inherit",
                            textDecoration: "none",
                            fontWeight: 700,
                          }}
                        >
                          {m.teamA}
                        </Link>

                        <div style={{ fontWeight: 800, minWidth: 24, textAlign: "right" }}>
                          {m.scoreA || "—"}
                        </div>
                      </div>

                      <div
                        style={{
                          textAlign: "center",
                          fontSize: 12,
                          opacity: 0.75,
                          fontWeight: 700,
                        }}
                      >
                        VS
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr auto",
                          gap: 12,
                          alignItems: "center",
                        }}
                      >
                        <Link
                          to={teamLink(m.teamB)}
                          style={{
                            color: "inherit",
                            textDecoration: "none",
                            fontWeight: 700,
                          }}
                        >
                          {m.teamB}
                        </Link>

                        <div style={{ fontWeight: 800, minWidth: 24, textAlign: "right" }}>
                          {m.scoreB || "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!blocks.length ? (
            <div className="card">
              <div className="section-title">Champions Race</div>
              <div>No champion tables found starting from column BI.</div>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gap: 16,
                gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
                alignItems: "start",
              }}
            >
              {blocks.map((block, idx) => (
                <div className="card" key={`${block.title}-${idx}`}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      marginBottom: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div className="section-title" style={{ marginBottom: 0 }}>
                      {block.title}
                    </div>

                    <span className="badge" style={{ whiteSpace: "nowrap" }}>
                      {block.rows.length} teams
                    </span>
                  </div>

                  <div style={{ overflowX: "auto" }}>
                    <table className="standings-table">
                      <thead>
                        <tr>
                          {block.headers.map((h, i) => (
                            <th
                              key={`${block.title}-h-${i}`}
                              style={{
                                whiteSpace: "normal",
                                wordBreak: "keep-all",
                                overflowWrap: "break-word",
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>

                      <tbody>
                        {block.rows.map((row, rIdx) => (
                          <tr key={`${block.title}-r-${rIdx}`}>
                            {row.map((v, cIdx) => {
                              const isTeam = cIdx === block.teamCol
                              const isFirst = cIdx === 0

                              return (
                                <td
                                  key={`${block.title}-${rIdx}-${cIdx}`}
                                  style={{
                                    whiteSpace: "normal",
                                    wordBreak: isTeam ? "keep-all" : "normal",
                                    overflowWrap: "break-word",
                                    fontWeight: isTeam || isFirst ? 700 : 500,
                                  }}
                                >
                                  {renderCell(v, cIdx, block)}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}