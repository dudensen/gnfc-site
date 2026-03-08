// src/App.jsx
import React from "react"
import { Routes, Route } from "react-router-dom"
import Home from "./pages/Home"
import DivisionPage from "./pages/DivisionPage"
import LeaguePage from "./pages/LeaguePage"
import TeamPage from "./pages/TeamPage"
import HistoryPage from "./pages/HistoryPage"
import ChampionsLeaguePage from "./pages/ChampionsLeaguePage"
import GnfcCupPage from "./pages/GnfcCupPage.jsx"
import ChampionsRacePage from "./pages/ChampionsRacePage.jsx"

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/division/:div" element={<DivisionPage />} />
      <Route path="/league/:league" element={<LeaguePage />} />
      <Route path="/team/:teamName" element={<TeamPage />} />
      <Route path="/history/:year" element={<HistoryPage />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="/champions-league" element={<ChampionsLeaguePage />} />
      <Route path="/cup" element={<GnfcCupPage />} />
      <Route path="/championsrace" element={<ChampionsRacePage />} />
      <Route path="*" element={<Home />} />
    </Routes>
  )
}