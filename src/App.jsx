// src/App.jsx
import React from "react"
import { Routes, Route } from "react-router-dom"
import Home from "./pages/Home"
import DivisionPage from "./pages/DivisionPage"
import LeaguePage from "./pages/LeaguePage"
import TeamPage from "./pages/TeamPage"
import HistoryPage from "./pages/HistoryPage"

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/division/:div" element={<DivisionPage />} />
      <Route path="/league/:league" element={<LeaguePage />} />
      <Route path="/team/:teamName" element={<TeamPage />} />
      <Route path="/history/:year" element={<HistoryPage />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="*" element={<Home />} />
    </Routes>
  )
}