// src/pages/TeamPage.jsx
import React, { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useTeams } from "../hooks/useTeams"

/* ----------------------------- general sheet source ----------------------------- */

const GENERAL_SHEET_ID = "1Z8EbGi1rGDhg7dAQoPypJ2FTUQoMO730yx3Mm-cEMow"
const GENERAL_GID = "2143242587"

function csvExportUrl(sheetId, gid) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`
}

/* ----------------------------- tiny utils ----------------------------- */

function s(x) {
  return String(x ?? "").replace(/\r/g, "").trim()
}

function norm(x) {
  return s(x).toLowerCase().replace(/\s+/g, " ")
}

function isJunkKey(k) {
  const key = String(k || "").trim()
  if (!key) return true
  if (key.startsWith("col_")) return true
  if (key.toUpperCase().includes("THE GREEK NBA FANTASY CHAMPIONSHIP GENERAL INFO")) return true
  if (key === "ar") return true
  return false
}

function getFirst(raw, baseKey) {
  const direct = String(raw?.[baseKey] ?? "").trim()
  if (direct) return direct
  for (let i = 2; i <= 6; i++) {
    const v = String(raw?.[`${baseKey}__${i}`] ?? "").trim()
    if (v) return v
  }
  return ""
}

function toRank(v) {
  const x = s(v)
  if (!x) return null
  const n = Number(x.replace(/[^\d.]/g, ""))
  return Number.isFinite(n) ? n : null
}

function val(v) {
  const x = s(v)
  return x ? x : "—"
}

function hasLetters(x) {
  return /[A-Za-zΑ-Ωα-ω]/.test(s(x))
}

function getPercentStat(raw, baseKey) {
  const values = []

  for (let i = 1; i <= 6; i++) {
    const key = i === 1 ? baseKey : `${baseKey}__${i}`
    const value = s(raw?.[key])
    if (value) values.push(value)
  }

  if (!values.length) return ""

  // Prefer values that look like real percentages/stat lines:
  // examples: 45.8, 45.8%, 81.4, 81.4%
  const percentLike =
    values.find((v) => /%/.test(v)) ||
    values.find((v) => /[.,]/.test(v)) ||
    values.find((v) => {
      const n = Number(String(v).replace("%", "").replace(",", "."))
      return Number.isFinite(n) && n >= 0 && n <= 100
    })

  return percentLike || values[0]
}

/* ----------------------------- csv parser ----------------------------- */

function parseCsv(text) {
  const rows = []
  let row = []
  let cur = ""
  let i = 0
  let inQuotes = false

  while (i < text.length) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      cur += ch
      i++
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }

    if (ch === ",") {
      row.push(cur)
      cur = ""
      i++
      continue
    }

    if (ch === "\n") {
      row.push(cur)
      rows.push(row)
      row = []
      cur = ""
      i++
      continue
    }

    if (ch === "\r") {
      i++
      continue
    }

    cur += ch
    i++
  }

  row.push(cur)
  rows.push(row)

  while (rows.length && rows[rows.length - 1].every((x) => !s(x))) rows.pop()
  return rows
}

/* ----------------------------- general sheet parsing ----------------------------- */

function parseGeneralSheet(rows) {
  if (!rows?.length || rows.length < 2) {
    throw new Error("General sheet CSV is missing rows.")
  }

  let headerRowIdx = -1
  let idxTeam = -1

  for (let r = 0; r < Math.min(rows.length, 8); r++) {
    const row = rows[r] || []
    const hit = row.findIndex((cell) => norm(cell) === "team")
    if (hit >= 0) {
      headerRowIdx = r
      idxTeam = hit
      break
    }
  }

  if (headerRowIdx < 0 || idxTeam < 0) {
    throw new Error("Could not find Team column in general sheet.")
  }

  const sectionRow = headerRowIdx > 0 ? rows[headerRowIdx - 1] || [] : []
  const headerRow = rows[headerRowIdx] || []
  const colCount = Math.max(sectionRow.length, headerRow.length)

  const sectionByIdx = []
  let currentSection = ""

  for (let i = 0; i < colCount; i++) {
    const sec = s(sectionRow[i])
    if (sec) currentSection = sec
    sectionByIdx[i] = currentSection || "OTHER"
  }

  const cols = Array.from({ length: colCount }, (_, idx) => ({
    idx,
    section: sectionByIdx[idx],
    label: s(headerRow[idx]) || "",
  }))

  const data = rows.slice(headerRowIdx + 1).filter((row) => {
    const team = s(row[idxTeam])
    return team && hasLetters(team)
  })

  return { cols, data, idxTeam }
}

function normalizeLoose(x) {
  return s(x)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
}

function findGeneralRowForTeam(parsed, teamName) {
  if (!parsed || !teamName) return null

  const targetExact = norm(teamName)
  const targetLoose = normalizeLoose(teamName)

  let hit = parsed.data.find((row) => norm(row[parsed.idxTeam]) === targetExact) || null
  if (hit) return hit

  hit = parsed.data.find((row) => normalizeLoose(row[parsed.idxTeam]) === targetLoose) || null
  if (hit) return hit

  hit =
    parsed.data.find((row) => {
      const candidate = normalizeLoose(row[parsed.idxTeam])
      return candidate.includes(targetLoose) || targetLoose.includes(candidate)
    }) || null

  return hit
}

export default function TeamPage() {
  const navigate = useNavigate()
  const { teamName } = useParams()
  const decodedName = decodeURIComponent(teamName || "")
  const { loading, error, teams } = useTeams()

  const [selectedTeam, setSelectedTeam] = useState("")
  const [generalParsed, setGeneralParsed] = useState(null)
  const [generalError, setGeneralError] = useState("")

  const team = useMemo(() => {
    const needle = norm(decodedName)
    return teams.find((t) => norm(t.team) === needle) || null
  }, [teams, decodedName])

  useEffect(() => {
    setSelectedTeam(team?.team || "")
  }, [team?.team])

  useEffect(() => {
    let alive = true

    async function loadGeneralSheetData() {
      try {
        setGeneralError("")
        const res = await fetch(csvExportUrl(GENERAL_SHEET_ID, GENERAL_GID))
        const text = await res.text()
        if (!res.ok) throw new Error(`General sheet fetch failed: ${res.status} ${res.statusText}`)

        const rows = parseCsv(text)
        const parsed = parseGeneralSheet(rows)

        if (alive) setGeneralParsed(parsed)
      } catch (e) {
        if (alive) {
          setGeneralParsed(null)
          setGeneralError(e?.message || String(e))
        }
      }
    }

    loadGeneralSheetData()

    return () => {
      alive = false
    }
  }, [])

  const generalRow = useMemo(() => {
    return findGeneralRowForTeam(generalParsed, team?.team)
  }, [generalParsed, team?.team])

  const leagueTeams = useMemo(() => {
    const league = s(team?.league)
    if (!league) return []

    return teams
      .filter((t) => s(t.league) === league)
      .slice()
      .sort((a, b) => s(a.team).localeCompare(s(b.team), undefined, { sensitivity: "base" }))
  }, [teams, team?.league])

  const totalTeams = teams.length
  const worst5From = Math.max(1, totalTeams - 4)

  const leagueW = team?.raw ? getFirst(team.raw, "GENERAL PERFORMANCE League W%") : ""

  const quickRanks = useMemo(() => {
    if (!team?.raw) return []

    const raw = team.raw
    const map = {
      GP: raw["GENERAL STATISTICS RANKINGS GP"],
      "FG%": raw["FG%_2"] ?? raw["FG%"],
      "3P": raw["3P__2"] ?? raw["3P"],
      "FT%": raw["FT%__2"] ?? raw["FT%"],
      PTS: raw["PTS__2"] ?? raw["PTS"],
      REB: raw["REB__2"] ?? raw["REB"],
      AST: raw["AST__2"] ?? raw["AST"],
      ST: raw["ST__2"] ?? raw["ST"],
      BLK: raw["BLK__2"] ?? raw["BLK"],
      TO: raw["TO__2"] ?? raw["TO"],
    }

    const order = ["GP", "FG%", "3P", "FT%", "PTS", "REB", "AST", "ST", "BLK", "TO"]
    return order.map((k) => ({ key: k, value: map[k] }))
  }, [team])

  const generalPerformanceStats = useMemo(() => {
  if (!team?.raw) return []

  const raw = team.raw
  return [
    { label: "GP", value: raw["GP"] },
    { label: "FG%", value: raw["GENERAL STATISTICS FG%"] ?? raw["FG%"] },
    { label: "3P", value: raw["3P"] },
    { label: "FT%", value: raw["FT%"] },
    { label: "PTS", value: raw["PTS"] },
    { label: "REB", value: raw["REB"] },
    { label: "AST", value: raw["AST"] },
    { label: "ST", value: raw["ST"] },
    { label: "BLK", value: raw["BLK"] },
    { label: "TO", value: raw["TO"] },
  ].filter((x) => !isJunkKey(x.label))
}, [team])

  const pointsSystemStats = useMemo(() => {
    if (!generalParsed || !generalRow) return []

    const wanted = [
      "league points",
      "category adj",
      "cup",
      "general standing",
      "stats winners",
      "tw",
      "rw",
      "extra",
      "total",
    ]

    const rankLike = new Set(["general standing"])

    const byLabel = new Map()

    parsedLoop: for (const c of generalParsed.cols) {
      const label = s(c.label)
      if (!label) continue

      const cleanLabel = norm(label)
      const cleanSection = norm(c.section)
      const value = s(generalRow[c.idx])
      if (!value) continue

      for (const want of wanted) {
        const fullLabel = norm(`${cleanSection} ${cleanLabel}`)

        if (
          cleanLabel === want ||
          fullLabel.includes(`points system ${want}`) ||
          fullLabel === want
        ) {
          if (!byLabel.has(want)) {
            byLabel.set(want, {
              label: want === "league points" ? "League Points" : label,
              value,
              rankLike: rankLike.has(want),
            })
          }
          continue parsedLoop
        }
      }
    }

    return wanted.map((key) => byLabel.get(key)).filter(Boolean)
  }, [generalParsed, generalRow])

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <img src="/gnfc-logo.png" alt="GNFC Logo" />

          <div className="brand-title">
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h1 style={{ margin: 0 }}>Team Profile</h1>

              <select
                value={selectedTeam}
                onChange={(e) => {
                  const next = e.target.value
                  setSelectedTeam(next)
                  navigate(`/team/${encodeURIComponent(next)}`)
                }}
                aria-label="Select team"
                disabled={loading || !team?.league || !leagueTeams.length}
                style={teamSelect}
              >
                {!selectedTeam ? (
                  <option value="" disabled>
                    Select team…
                  </option>
                ) : null}

                {leagueTeams.map((t) => (
                  <option key={t.team} value={t.team}>
                    {t.team}
                  </option>
                ))}
              </select>

              {team?.league ? (
                <span className="badge" style={{ opacity: 0.9 }}>
                  {team.league}
                </span>
              ) : null}
            </div>

            <p>{decodedName}</p>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            {team?.division && (
              <Link
                to={`/division/${encodeURIComponent(team.division)}`}
                className="badge"
                style={{ textDecoration: "none" }}
              >
                ← Division {team.division}
              </Link>
            )}
            <Link to="/" className="badge" style={{ textDecoration: "none" }}>
              Home
            </Link>
          </div>
        </div>
      </div>

      <div className="container">
        {loading && <div className="notice">Loading…</div>}
        {error && <div className="notice">Error: {error}</div>}

        {!loading && !error && !team && (
          <div className="notice">
            Team not found: <strong>{decodedName}</strong>
          </div>
        )}

        {!loading && !error && team && (
          <>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 1000, letterSpacing: 0.3 }}>{team.team}</div>
                  <div style={{ marginTop: 6, color: "var(--gnfc-muted)", fontSize: 14 }}>
                    Manager:{" "}
                    <span style={{ color: "var(--gnfc-text)", fontWeight: 800 }}>{team.manager || "—"}</span>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <Link
                    to={`/division/${encodeURIComponent(team.division)}`}
                    className="badge"
                    style={{ textDecoration: "none" }}
                  >
                    Division {team.division}
                  </Link>

                  <Link
                    to={`/league/${encodeURIComponent(team.league)}`}
                    className="badge"
                    style={{ textDecoration: "none" }}
                  >
                    {team.league}
                  </Link>
                </div>
              </div>

              <div
                style={{
                  marginTop: 14,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 12,
                }}
              >
                <div style={miniBox}>
                  <div style={miniLabel}>League Ranking</div>
                  <div style={miniValue}>{val(team.leagueRanking)}</div>
                </div>

                <div style={miniBox}>
                  <div style={miniLabel}>League W%</div>
                  <div style={miniValue}>{val(leagueW)}</div>
                </div>

                <div style={miniBox}>
                  <div style={miniLabel}>Category Standing</div>
                  <div style={miniValue}>{val(getFirst(team.raw, "Category Standing"))}</div>
                </div>

                <div style={miniBox}>
                  <div style={miniLabel}>Category Next Season</div>
                  <div style={miniValue}>{val(getFirst(team.raw, "Category Next Season"))}</div>
                </div>

                <div style={miniBox}>
                  <div style={miniLabel}>Playoffs</div>
                  <div style={miniValue}>{val(getFirst(team.raw, "Playoffs"))}</div>
                </div>

                <div style={miniBox}>
                  <div style={miniLabel}>Champions League</div>
                  <div style={miniValue}>{val(getFirst(team.raw, "Champions League"))}</div>
                </div>

                <div style={miniBox}>
                  <div style={miniLabel}>Cup</div>
                  <div style={miniValue}>{val(getFirst(team.raw, "Cup"))}</div>
                </div>
              </div>
            </div>

            {generalError ? (
              <div className="card" style={{ padding: 16, marginTop: 14 }}>
                <div style={{ fontWeight: 900 }}>Could not load Points System data</div>
                <div style={{ marginTop: 6, color: "var(--gnfc-muted)" }}>{generalError}</div>
              </div>
            ) : null}

            <div
              style={{
                marginTop: 14,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: 14,
                alignItems: "stretch",
              }}
            >
              <div className="card" style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                  <div style={{ fontSize: 18, fontWeight: 900 }}>Category Positions</div>
                  <div style={{ fontSize: 12, color: "var(--gnfc-muted)" }}>Top 5 / Bottom 5</div>
                </div>

                <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                  {quickRanks.map(({ key, value }) => {
                    const r = toRank(value)
                    const isTop5 = r != null && r <= 5
                    const isWorst5 = r != null && r >= worst5From
                    const showBadge = isTop5 || isWorst5

                    const badgeStyle = isTop5
                      ? {
                          borderColor: "rgba(0, 160, 120, 0.65)",
                          background: "rgba(0, 160, 120, 0.18)",
                        }
                      : {
                          borderColor: "rgba(220, 38, 38, 0.70)",
                          background: "rgba(220, 38, 38, 0.18)",
                        }

                    return (
                      <div
                        key={key}
                        style={{
                          border: "1px solid rgba(255,255,255,0.10)",
                          borderRadius: 14,
                          padding: 12,
                          background: "rgba(0,0,0,0.12)",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 900, color: "var(--gnfc-muted)" }}>{key}</div>

                        {showBadge ? (
                          <span
                            className="badge"
                            style={{
                              ...badgeStyle,
                              fontWeight: 1000,
                              fontSize: 16,
                              padding: "2px 10px",
                              borderRadius: 999,
                              display: "inline-block",
                              lineHeight: 1,
                            }}
                          >
                            #{r ?? "—"}
                          </span>
                        ) : (
                          <div style={{ fontSize: 16, fontWeight: 1000 }}>{r == null ? "—" : `#${r}`}</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 18, fontWeight: 900 }}>General Performance</div>

                <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                  {generalPerformanceStats.map(({ label, value }) => (
                    <div
                      key={label}
                      style={{
                        border: "1px solid rgba(255,255,255,0.10)",
                        borderRadius: 14,
                        padding: 12,
                        background: "rgba(0,0,0,0.12)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 900, color: "var(--gnfc-muted)" }}>{label}</div>
                      <div style={{ fontSize: 16, fontWeight: 1000 }}>{val(value)}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 18, fontWeight: 900 }}>Points System</div>

                <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                  {pointsSystemStats.map(({ label, value, rankLike }) => {
                    const rank = toRank(value)
                    const showTop5 = rankLike && rank != null && rank <= 5

                    return (
                      <div
                        key={label}
                        style={{
                          border: "1px solid rgba(255,255,255,0.10)",
                          borderRadius: 14,
                          padding: 12,
                          background: "rgba(0,0,0,0.12)",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 900, color: "var(--gnfc-muted)" }}>{label}</div>

                        {showTop5 ? (
                          <span
                            className="badge"
                            style={{
                              borderColor: "rgba(0, 160, 120, 0.65)",
                              background: "rgba(0, 160, 120, 0.18)",
                              fontWeight: 1000,
                              fontSize: 16,
                              padding: "2px 10px",
                              borderRadius: 999,
                              display: "inline-block",
                              lineHeight: 1,
                            }}
                          >
                            #{rank}
                          </span>
                        ) : (
                          <div style={{ fontSize: 16, fontWeight: 1000 }}>{val(value)}</div>
                        )}
                      </div>
                    )
                  })}

                  {!pointsSystemStats.length && !generalError ? (
                    <div
                      style={{
                        border: "1px solid rgba(255,255,255,0.10)",
                        borderRadius: 14,
                        padding: 12,
                        background: "rgba(0,0,0,0.12)",
                        color: "var(--gnfc-muted)",
                        fontWeight: 700,
                      }}
                    >
                      No points system data found for this team.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}

const teamSelect = {
  height: 38,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.18)",
  color: "var(--gnfc-text)",
  padding: "0 12px",
  fontWeight: 900,
  outline: "none",
  maxWidth: 280,
}

const miniBox = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 14,
  padding: 12,
  background: "rgba(0,0,0,0.12)",
}

const miniLabel = {
  fontSize: 12,
  color: "var(--gnfc-muted)",
  fontWeight: 800,
  letterSpacing: 0.2,
}

const miniValue = {
  marginTop: 6,
  fontSize: 18,
  fontWeight: 1000,
}