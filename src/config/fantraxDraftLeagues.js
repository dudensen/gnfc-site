// Fantrax league IDs for the 2026–27 draft results.
// Explicit keys keep the draft mapping independent of array order elsewhere.
export const FANTRAX_DRAFT_LEAGUES = {
  A1: "wc383ctemtd193s8",
  A2: "thm2s6izmutxw4m2",
  A3: "r3x39yvpmuuxmjo3",
  A4: "w4apbktbmutxw2ip",
  B1: "sdxvn6sfmutxw0aj",
  B2: "8wmazoi6mutycxi9",
  B3: "s14pc89smutycv8p",
  B4: "g1ibumr1muuybi9l",
  "Γ1": "3t2ugzv2muv2ggt3",
  "Γ2": "8lqulaoumuvo6i84",
  "Γ3": "47q8h5skmuvo6kk5",
  "Γ4": "vtjy3gqmmuvo9kjx",
  "Γ5": "kbdg5mqtmutyct79",
  R1: "76l6trvumtd190uo",
  R2: "t9eq8z28mur0ykpj",
  R3: "hq52tl1jmur0ymh1",
  R4: "jvapk3htmur0yo6f",
  R5: "g0r3sv7qmur0yptm",
  R6: "tmku1uj7mur0ys40",
}

export function normalizeDraftLeagueKey(value) {
  return String(value ?? "").trim().toUpperCase()
}

export function getDraftLeagueId(value) {
  const key = normalizeDraftLeagueKey(value)
  return Object.prototype.hasOwnProperty.call(FANTRAX_DRAFT_LEAGUES, key)
    ? FANTRAX_DRAFT_LEAGUES[key]
    : null
}
