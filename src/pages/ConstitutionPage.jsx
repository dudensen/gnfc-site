import React, { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import mammoth from "mammoth/mammoth.browser"
import DOMPurify from "dompurify"

const DOCX_URL = "/docs/constitution.docx"

const CONSTITUTION_TITLE = "GNFC Constitution"
const CONSTITUTION_SUBTITLE = "Καταστατικό • Rules • Governance"
const CONSTITUTION_SEASON = "2023-2024"

function slug(x) {
  return String(x ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9α-ω]+/gi, "-")
    .replace(/^-+|-+$/g, "")
}

function isGarbageHeading(text) {
  const t = String(text ?? "").trim()
  if (!t) return true
  if (/^section-\d+$/i.test(t)) return true
  if (/^section\s+\d+$/i.test(t)) return true
  if (/^[—–-]+$/.test(t)) return true
  if (/^_+$/.test(t)) return true
  if (/^\d+$/.test(t)) return true
  return false
}

function cleanupHtml(rawHtml) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(rawHtml, "text/html")
  const body = doc.body

  // Remove paragraphs that are just fake section labels
  ;[...body.querySelectorAll("p")].forEach((el) => {
    const text = (el.textContent || "").trim()
    if (/^section[-\s]?\d+$/i.test(text)) {
      el.remove()
    }
  })

  // Remove everything before the first real heading we want
  const allNodes = [...body.children]
  const introNode =
    allNodes.find((el) => /^εισαγωγή$/i.test((el.textContent || "").trim())) ||
    allNodes.find((el) => /^h1$|^h2$/i.test(el.tagName))

  if (introNode) {
    let keep = false
    allNodes.forEach((el) => {
      if (el === introNode) keep = true
      if (!keep) el.remove()
    })
  }

  // Remove the Word table of contents block from the main article
  const children = [...body.children]
  let tocStarted = false

  children.forEach((el) => {
    const text = (el.textContent || "").trim()

    if (!tocStarted && /^περιεχόμενα$/i.test(text)) {
      tocStarted = true
      el.remove()
      return
    }

    if (tocStarted) {
      const isHeading =
        el.tagName === "H1" || el.tagName === "H2" || el.tagName === "H3"

      const looksLikeRealSection = [
        "Εισαγωγή",
        "Γενικά",
        "Οι Ρόλοι του Πρωταθλήματος",
        "Το Πρωτάθλημα και η δομή του",
        "Οι Λίγκες και οι κανόνες τους",
        "Το Κύπελλο",
        "Το Champions League",
        "Τα Βραβεία του Πρωταθλήματος",
      ].includes(text)

      if (isHeading && looksLikeRealSection) {
        tocStarted = false
        return
      }

      el.remove()
    }
  })

  // Remove garbage headings
  ;[...body.querySelectorAll("h1, h2, h3, p")].forEach((el) => {
    const text = (el.textContent || "").trim()
    if (isGarbageHeading(text)) el.remove()
  })

  // Build clean TOC
  const toc = []
  ;[...body.querySelectorAll("h1, h2")].forEach((el) => {
    const text = (el.textContent || "").trim()

    if (isGarbageHeading(text)) {
      el.remove()
      return
    }

    const id = slug(text)
    if (!id) {
      el.remove()
      return
    }

    el.id = id

    toc.push({
      id,
      text,
      level: el.tagName.toLowerCase(),
    })
  })

  return {
    html: body.innerHTML,
    toc,
  }
}

export default function ConstitutionPage() {
  const navigate = useNavigate()
  const [html, setHtml] = useState("")
  const [toc, setToc] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [activeId, setActiveId] = useState("")

  useEffect(() => {
    let mounted = true

    async function loadDoc() {
      try {
        setLoading(true)
        setError("")

        const res = await fetch(DOCX_URL, { cache: "no-store" })
        if (!res.ok) {
          throw new Error(`Failed to fetch document: ${res.status}`)
        }

        const contentType = res.headers.get("content-type") || ""
        if (
          contentType.includes("text/html") ||
          contentType.includes("application/json")
        ) {
          throw new Error(
            "The fetched file is not a DOCX. Check that /public/docs/constitution.docx exists and the path is correct."
          )
        }

        const arrayBuffer = await res.arrayBuffer()

        const result = await mammoth.convertToHtml(
          { arrayBuffer },
          {
            styleMap: [
              "p[style-name='Title'] => h1:fresh",
              "p[style-name='Heading 1'] => h1:fresh",
              "p[style-name='Heading 2'] => h2:fresh",
              "p[style-name='Heading 3'] => h3:fresh",
            ],
            includeDefaultStyleMap: true,
          }
        )

        const cleaned = DOMPurify.sanitize(result.value)
        const processed = cleanupHtml(cleaned)

        if (!mounted) return

        setHtml(processed.html)
        setToc(processed.toc)
        setActiveId(processed.toc[0]?.id || "")
      } catch (err) {
        if (!mounted) return
        setError(err.message || "Could not load constitution file.")
      } finally {
        if (mounted) setLoading(false)
      }
    }

    loadDoc()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!toc.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)

        if (visible[0]?.target?.id) {
          setActiveId(visible[0].target.id)
        }
      },
      {
        rootMargin: "-20% 0px -65% 0px",
        threshold: [0.1, 0.25, 0.5],
      }
    )

    toc.forEach((item) => {
      const el = document.getElementById(item.id)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [toc, html])

  const stats = useMemo(() => {
    const h1Count = toc.filter((x) => x.level === "h1").length
    const h2Count = toc.filter((x) => x.level === "h2").length
    return { h1Count, h2Count }
  }, [toc])

  return (
    <>
      <div id="top" className="topbar">
        <div className="brand">
          <Link to="/" aria-label="Go to homepage" style={{ display: "inline-flex" }}>
            <img src="/gnfc-logo.png" alt="GNFC Logo" style={{ cursor: "pointer" }} />
          </Link>

          <div className="brand-title">
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h1 style={{ margin: 0 }}>{CONSTITUTION_TITLE}</h1>
              <span className="badge" style={{ opacity: 0.95 }}>
                {CONSTITUTION_SEASON}
              </span>
            </div>
            <p>{CONSTITUTION_SUBTITLE}</p>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            <button
              type="button"
              className="badge"
              onClick={() => navigate(-1)}
              style={{ cursor: "pointer" }}
            >
              Back
            </button>

            <Link to="/" className="badge" style={{ textDecoration: "none" }}>
              Home
            </Link>
          </div>
        </div>
      </div>

      <div className="container">
        <div
          className="card"
          style={{
            padding: 18,
            marginBottom: 14,
            borderColor: "rgba(216,120,32,0.35)",
            background:
              "linear-gradient(180deg, rgba(216,120,32,0.10), rgba(10,122,114,0.12))",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 950,
                  letterSpacing: 0.7,
                  color: "#db7d12",
                  textTransform: "uppercase",
                  marginBottom: 8,
                }}
              >
                Official League Document
              </div>

              <div
                style={{
                  fontSize: 28,
                  fontWeight: 1000,
                  lineHeight: 1.05,
                }}
              >
                {CONSTITUTION_TITLE}
              </div>

              <div
                style={{
                  marginTop: 10,
                  color: "var(--gnfc-muted)",
                  fontSize: 14,
                  lineHeight: 1.6,
                  maxWidth: 900,
                }}
              >

              </div>
            </div>

            <div style={{ display: "grid", gap: 8, minWidth: 220 }}>
              <div className="card" style={{ padding: 12, background: "rgba(255,255,255,0.04)" }}>
                <div style={{ fontSize: 11, color: "var(--gnfc-muted)", fontWeight: 900 }}>
                  Sections
                </div>
                <div style={{ fontSize: 24, fontWeight: 1000, lineHeight: 1.1 }}>
                  {stats.h1Count}
                </div>
              </div>


            </div>
          </div>
        </div>

        <div className="constitutionLayout">
          <aside className="card constitutionSidebar" style={{ padding: 14 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 950,
                letterSpacing: 0.6,
                color: "#db7d12",
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              Table of Contents
            </div>

            {loading ? (
              <div style={{ color: "var(--gnfc-muted)", fontSize: 14 }}>Loading document…</div>
            ) : error ? (
              <div style={{ color: "#ffb4b4", fontSize: 14 }}>{error}</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {toc.map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    style={{
  display: "block",
  textDecoration: "none",
  color: activeId === item.id ? "#ffffff" : "rgba(235,244,243,0.92)",
                      padding: item.level === "h2" ? "9px 12px 9px 20px" : "10px 12px",
                      borderRadius: 12,
                      border:
                        activeId === item.id
                          ? "1px solid rgba(216,120,32,0.45)"
                          : "1px solid rgba(255,255,255,0.08)",
                      background:
                        activeId === item.id
                          ? "rgba(216,120,32,0.12)"
                          : "rgba(255,255,255,0.03)",
                      fontWeight: item.level === "h1" ? 900 : 700,
                      fontSize: item.level === "h1" ? 13 : 12,
                      lineHeight: 1.2,
                    }}
                  >
                    {item.text}
                  </a>
                ))}
              </div>
            )}
          </aside>

          <main style={{ minWidth: 0 }}>
            <div className="card constitutionMainCard">
              {loading ? (
                <div style={{ color: "var(--gnfc-muted)", fontSize: 15 }}>Loading constitution…</div>
              ) : error ? (
                <div style={{ color: "#ffb4b4", fontSize: 15 }}>{error}</div>
              ) : (
                <article
                  className="constitutionDoc"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              )}
            </div>
          </main>
        </div>
      </div>

      <style>{`
        html{
          scroll-behavior:smooth;
        }

        .constitutionLayout{
          display:grid;
          grid-template-columns: 1fr;
          gap:14px;
          align-items:start;
        }

        .constitutionSidebar{
          position:relative;
          background: linear-gradient(180deg, rgba(7,44,43,0.96), rgba(6,31,30,0.96));
        }

        .constitutionMainCard{
          padding: 22px;
          background:
            linear-gradient(180deg, rgba(7,44,43,0.98), rgba(6,31,30,0.98));
          border: 1px solid rgba(255,255,255,0.08);
        }

        @media (min-width: 1040px){
          .constitutionLayout{
            grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
          }

          .constitutionSidebar{
            position: sticky;
            top: 86px;
          }
        }

        .constitutionDoc{
          color: var(--gnfc-ink);
        }

        .constitutionDoc h1{
          font-size: 28px;
          line-height: 1.1;
          font-weight: 1000;
          margin: 0 0 16px;
          padding-bottom: 10px;
          border-bottom: 1px solid rgba(216,120,32,0.28);
          color: #ffffff;
          scroll-margin-top: 92px;
        }

        .constitutionDoc h2{
          font-size: 20px;
          line-height: 1.15;
          font-weight: 950;
          margin: 26px 0 12px;
          color: #db7d12;
          scroll-margin-top: 92px;
        }

        .constitutionDoc h3{
          font-size: 16px;
          line-height: 1.2;
          font-weight: 900;
          margin: 20px 0 10px;
          color: #f2f7f7;
        }

        .constitutionDoc p{
          margin: 0 0 12px;
          font-size: 14px;
          line-height: 1.8;
          color: rgba(235,244,243,0.94);
        }

        .constitutionDoc ul,
        .constitutionDoc ol{
          margin: 0 0 16px;
          padding-left: 22px;
        }

        .constitutionDoc li{
          margin: 0 0 8px;
          font-size: 14px;
          line-height: 1.75;
          color: rgba(235,244,243,0.94);
        }

        .constitutionDoc table{
          width: 100%;
          border-collapse: collapse;
          margin: 14px 0 18px;
          overflow: hidden;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.03);
        }

        .constitutionDoc th,
        .constitutionDoc td{
          padding: 10px 12px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          text-align: left;
          font-size: 14px;
          line-height: 1.5;
          vertical-align: top;
          color: rgba(235,244,243,0.94);
        }

        .constitutionDoc th{
          color: #db7d12;
          font-weight: 900;
          background: rgba(10,122,114,0.16);
        }

        .constitutionDoc a{
          color: #db7d12;
        }

        .constitutionDoc strong{
          color: #ffffff;
        }

        .constitutionDoc blockquote{
          margin: 16px 0;
          padding: 12px 14px;
          border-left: 3px solid rgba(216,120,32,0.45);
          background: rgba(216,120,32,0.08);
          border-radius: 10px;
        }
      `}</style>
    </>
  )
}