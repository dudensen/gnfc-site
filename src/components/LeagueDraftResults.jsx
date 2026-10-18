import React, { useEffect, useMemo, useState } from "react"
import { getDraftLeagueId } from "../config/fantraxDraftLeagues"

const display = value => value == null || value === "" ? "—" : value

export default function LeagueDraftResults({ leagueKey }) {
  const leagueId = getDraftLeagueId(leagueKey)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const [team, setTeam] = useState("")
  const [round, setRound] = useState("")
  const [search, setSearch] = useState("")

  useEffect(() => {
    if (!leagueId) {
      setLoading(false)
      return
    }
    let alive = true
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 25000)
    setLoading(true)
    setError("")

    ;(async () => {
      try {
        const response = await fetch(`/api/gnfc-draft?league=${encodeURIComponent(leagueKey)}`, {
          signal: controller.signal,
          cache: "no-store",
        })
        // Vite's static dev server falls back to index.html for unknown API routes.
        if (!response.headers.get("content-type")?.includes("application/json")) {
          throw new Error("The draft service is unavailable. Please try again later.")
        }
        const result = await response.json()
        if (!response.ok) throw new Error(result?.error || `Draft request failed (${response.status}).`)
        if (result?.leagueId !== leagueId || !Array.isArray(result?.picks)) {
          throw new Error("The draft service returned unexpected data.")
        }
        if (alive) setData(result)
      } catch (e) {
        if (alive) {
          setError(e?.name === "AbortError"
            ? "The draft request timed out. Please try again."
            : e?.message || "Failed to load draft results.")
        }
      } finally {
        clearTimeout(timeout)
        if (alive) setLoading(false)
      }
    })()

    return () => {
      alive = false
      clearTimeout(timeout)
      controller.abort()
    }
  }, [leagueKey, leagueId, reload])

  const picks = data?.leagueId === leagueId ? data.picks : []
  const teams = useMemo(() => {
    const names = new Map(picks.map(pick => [pick.teamId, pick.teamName]))
    return [...names].sort((a, b) => a[1].localeCompare(b[1]))
  }, [picks])
  const rounds = useMemo(() => [...new Set(picks.map(pick => pick.round).filter(Boolean))]
    .sort((a, b) => a - b), [picks])
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return picks.filter(pick =>
      (!team || pick.teamId === team) &&
      (!round || String(pick.round) === round) &&
      (!query || `${pick.playerName} ${pick.teamName} ${pick.nbaTeam} ${pick.position}`.toLocaleLowerCase().includes(query))
    )
  }, [picks, team, round, search])

  if (!leagueId) {
    return <div className="notice">Draft results are not configured for {leagueKey}.</div>
  }

  return (
    <section aria-label={`${leagueKey} draft results`} className="gnfcDraft">
      <div className="gnfcDraftToolbar">
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Draft Results</h2>
          <p style={{ margin: "6px 0 0", color: "var(--gnfc-muted)", fontSize: 13 }}>
            {data?.leagueId === leagueId ? data.leagueName : leagueKey}
            {data?.leagueId === leagueId && data.draftState
              ? ` • ${data.draftState.replace(/_/g, " ")}` : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <a className="badge" href={`https://www.fantrax.com/fantasy/league/${leagueId}/home`}
            target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
            Open in Fantrax ↗
          </a>
          <button type="button" className="gnfcDraftControl" disabled={loading}
            onClick={() => setReload(value => value + 1)}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {loading && <div className="notice" role="status">Loading draft results…</div>}
      {!loading && error && <div className="notice" role="alert">{error}</div>}
      {!loading && !error && picks.length === 0 && (
        <div className="notice">No draft selections are available yet for {leagueKey}.</div>
      )}

      {!loading && !error && picks.length > 0 && (
        <>
          <div className="gnfcDraftFilters">
            <label>
              Fantasy team
              <select className="gnfcDraftControl" value={team} onChange={event => setTeam(event.target.value)}>
                <option value="">All teams</option>
                {teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label>
              Round
              <select className="gnfcDraftControl" value={round} onChange={event => setRound(event.target.value)}>
                <option value="">All rounds</option>
                {rounds.map(value => <option key={value} value={value}>Round {value}</option>)}
              </select>
            </label>
            <label style={{ flex: "1 1 220px" }}>
              Search
              <input className="gnfcDraftControl" type="search" value={search}
                onChange={event => setSearch(event.target.value)} placeholder="Player, team or position…" />
            </label>
            <button type="button" className="gnfcDraftControl" onClick={() => { setTeam(""); setRound(""); setSearch("") }}>
              Clear filters
            </button>
          </div>
          <p role="status" style={{ color: "var(--gnfc-muted)", fontSize: 13 }}>
            {visible.length} of {picks.length} selections
          </p>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table className="gnfcDraftTable">
                <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>
                  {leagueKey} draft selections in overall pick order
                </caption>
                <thead>
                  <tr>{["Overall", "Round", "Pick in round", "Player", "Pos", "NBA team", "Fantasy team"].map(label =>
                    <th key={label} scope="col">{label}</th>
                  )}</tr>
                </thead>
                <tbody>
                  {visible.map(pick => (
                    <tr key={pick.key}>
                      <td style={{ fontWeight: 900, color: "#db7d12" }}>{display(pick.overall)}</td>
                      <td>{display(pick.round)}</td>
                      <td>{display(pick.pickInRound)}</td>
                      <td style={{ fontWeight: 900 }}>{pick.playerName}</td>
                      <td>{display(pick.position)}</td>
                      <td>{display(pick.nbaTeam)}</td>
                      <td style={{ fontWeight: 800 }}>{pick.teamName}</td>
                    </tr>
                  ))}
                  {!visible.length && <tr><td colSpan={7}>No selections match these filters.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <style>{`
        .gnfcDraft { margin-bottom: 18px; }
        .gnfcDraftToolbar { display: flex; gap: 14px; justify-content: space-between; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
        .gnfcDraftFilters { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
        .gnfcDraftFilters label { display: flex; flex-direction: column; gap: 6px; flex: 1 1 150px; font-size: 12px; font-weight: 800; color: var(--gnfc-muted); min-width: 0; }
        .gnfcDraftControl { box-sizing: border-box; min-height: 36px; min-width: 0; max-width: 100%; border-radius: 10px; padding: 8px 12px; border: 1px solid var(--gnfc-border); background: var(--gnfc-surface); color: var(--gnfc-ink); font: inherit; font-size: 13px; }
        .gnfcDraftControl:focus-visible { outline: 2px solid #db7d12; outline-offset: 2px; }
        button.gnfcDraftControl { cursor: pointer; font-weight: 800; }
        button.gnfcDraftControl:disabled { opacity: .6; cursor: wait; }
        .gnfcDraftTable { width: 100%; min-width: 720px; border-collapse: collapse; color: var(--gnfc-ink); font-size: 13px; }
        .gnfcDraftTable th { text-align: left; padding: 12px; color: var(--gnfc-muted); font-size: 12px; background: rgba(0,0,0,.18); white-space: nowrap; }
        .gnfcDraftTable td { padding: 11px 12px; border-top: 1px solid rgba(255,255,255,.08); }
        .gnfcDraftTable td:nth-child(-n+3) { font-variant-numeric: tabular-nums; }
        .gnfcDraftTable tbody tr:nth-child(even) { background: rgba(255,255,255,.025); }
        .gnfcDraftTable tbody tr:hover { background: rgba(216,120,32,.08); }
      `}</style>
    </section>
  )
}
