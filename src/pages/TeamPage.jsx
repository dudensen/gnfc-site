// src/pages/TeamPage.jsx
import React, { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useTeams } from "../hooks/useTeams"

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
  const s = String(v ?? "").trim()
  if (!s) return null
  const n = Number(s.replace(/[^\d.]/g, ""))
  return Number.isFinite(n) ? n : null
}

function val(v) {
  const s = String(v ?? "").trim()
  return s ? s : "—"
}

function StatGrid({ title, items }) {
  return (
    <div className="card" style={{ padding: 16, marginTop: 14 }}>
      <div className="sectionTitle" style={{ marginTop: 0 }}>
        <span className="badge">{title}</span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 10
        }}
      >
        {items.map(({ label, value }) => (
          <div
            key={label}
            style={{
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 14,
              padding: 12,
              background: "rgba(0,0,0,0.12)"
            }}
          >
            <div style={{ fontSize: 12, color: "var(--gnfc-muted)", fontWeight: 900 }}>
              {label}
            </div>
            <div style={{ marginTop: 8, fontSize: 18, fontWeight: 1000 }}>
              {val(value)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function TeamPage() {
  const navigate = useNavigate()
  const { teamName } = useParams()
  const decodedName = decodeURIComponent(teamName || "")
  const { loading, error, teams } = useTeams()

  const team = useMemo(() => {
    const needle = decodedName.trim().toLowerCase()
    return teams.find(t => String(t.team).trim().toLowerCase() === needle) || null
  }, [teams, decodedName])

  // ✅ dropdown selected value (keeps in sync with route)
  const [selectedTeam, setSelectedTeam] = useState("")
  useEffect(() => {
    setSelectedTeam(team?.team || "")
  }, [team?.team])

  // ✅ teams in SAME league as current team
  const leagueTeams = useMemo(() => {
    const league = String(team?.league ?? "").trim()
    if (!league) return []
    return teams
      .filter(t => String(t.league ?? "").trim() === league)
      .slice()
      .sort((a, b) =>
        String(a.team ?? "").localeCompare(String(b.team ?? ""), undefined, { sensitivity: "base" })
      )
  }, [teams, team?.league])

  // bottom-5 threshold (across ALL teams)
  const totalTeams = teams.length
  const worst5From = Math.max(1, totalTeams - 4)

  const leagueW = team?.raw ? getFirst(team.raw, "GENERAL PERFORMANCE League W%") : ""

  const quickRanks = useMemo(() => {
    if (!team?.raw) return null
    const raw = team.raw

    // Rankings (positions)
    const map = {
      GP: raw["GENERAL STATISTICS RANKINGS GP"],
      "FG%": raw["FG%"],
      "3P": raw["3P__2"] ?? raw["3P"],
      "FT%": raw["FT%__2"] ?? raw["FT%"],
      PTS: raw["PTS__2"] ?? raw["PTS"],
      REB: raw["REB__2"] ?? raw["REB"],
      AST: raw["AST__2"] ?? raw["AST"],
      ST: raw["ST__2"] ?? raw["ST"],
      BLK: raw["BLK__2"] ?? raw["BLK"],
      TO: raw["TO__2"] ?? raw["TO"]
    }

    const order = ["GP", "FG%", "3P", "FT%", "PTS", "REB", "AST", "ST", "BLK", "TO"]
    return order.map(k => ({ key: k, value: map[k] }))
  }, [team])

  const generalPerformanceStats = useMemo(() => {
    if (!team?.raw) return []
    const raw = team.raw

    // These are the ACTUAL stat values (not rankings).
    // From your headers: GP, 3P, FT%, PTS, REB, AST, ST, BLK, TO
    // (FG% intentionally excluded as requested)
    const items = [
      { label: "GP", value: raw["GP"] },
      { label: "3P", value: raw["3P"] },
      { label: "FT%", value: raw["FT%"] },
      { label: "PTS", value: raw["PTS"] },
      { label: "REB", value: raw["REB"] },
      { label: "AST", value: raw["AST"] },
      { label: "ST", value: raw["ST"] },
      { label: "BLK", value: raw["BLK"] },
      { label: "TO", value: raw["TO"] }
    ].filter(x => !isJunkKey(x.label))

    return items
  }, [team])

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <img src="/gnfc-logo.png" alt="GNFC Logo" />

          {/* ✅ Brand title with Team dropdown (same pattern as DivisionPage) */}
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

                {leagueTeams.map(t => (
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
            {/* FIRST BOX (profile + quick stats) */}
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 1000, letterSpacing: 0.3 }}>{team.team}</div>
                  <div style={{ marginTop: 6, color: "var(--gnfc-muted)", fontSize: 14 }}>
                    Manager:{" "}
                    <span style={{ color: "var(--gnfc-text)", fontWeight: 800 }}>
                      {team.manager || "—"}
                    </span>
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
                  gap: 12
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

            {/* CATEGORY POSITIONS BOX */}
            <div className="card" style={{ padding: 16, marginTop: 14 }}>
              <div className="sectionTitle" style={{ marginTop: 0 }}>
                <span className="badge">Category Positions</span>
                <span style={{ color: "var(--gnfc-muted)", fontSize: 13 }}>
                  Top 5 (green) • Bottom 5 (red) • Always shows #rank
                </span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: 10
                }}
              >
                {quickRanks?.map(({ key, value }) => {
                  const r = toRank(value)
                  const isTop5 = r != null && r <= 5
                  const isWorst5 = r != null && r >= worst5From
                  const showBadge = isTop5 || isWorst5

                  const badgeStyle = isTop5
                    ? { borderColor: "rgba(0, 160, 120, 0.65)", background: "rgba(0, 160, 120, 0.18)" }
                    : { borderColor: "rgba(220, 38, 38, 0.70)", background: "rgba(220, 38, 38, 0.18)" }

                  return (
                    <div
                      key={key}
                      style={{
                        border: "1px solid rgba(255,255,255,0.10)",
                        borderRadius: 14,
                        padding: 12,
                        background: "rgba(0,0,0,0.12)"
                      }}
                    >
                      <div style={{ fontSize: 12, color: "var(--gnfc-muted)", fontWeight: 900 }}>
                        {key}
                      </div>

                      {/* ✅ Show ONLY one thing: pill for top/bottom, otherwise plain rank */}
{showBadge ? (
  <div style={{ marginTop: 10 }}>
    <span
      className="badge"
      style={{
        ...badgeStyle,
        fontWeight: 1000,
        fontSize: 18,          // ✅ match plain rank size
        padding: "10px 16px",  // ✅ make it bigger
        borderRadius: 999,
        display: "inline-block",
        lineHeight: 1
      }}
      title={isTop5 ? "Top 5" : "Bottom 5"}
    >
      #{r ?? "—"}
    </span>
  </div>
) : (
  <div style={{ marginTop: 10, fontSize: 18, fontWeight: 1000 }}>
    {r == null ? "—" : `#${r}`}
  </div>
)}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ONLY ONE MORE SECTION: rename to General Performance and keep only requested fields */}
            <StatGrid title="General Performance" items={generalPerformanceStats} />
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
  maxWidth: 280
}

const miniBox = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 14,
  padding: 12,
  background: "rgba(0,0,0,0.12)"
}

const miniLabel = {
  fontSize: 12,
  color: "var(--gnfc-muted)",
  fontWeight: 800,
  letterSpacing: 0.2
}

const miniValue = {
  marginTop: 6,
  fontSize: 18,
  fontWeight: 1000
}