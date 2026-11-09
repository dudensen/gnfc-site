// A visitor's explicit choice takes priority over their device preference.
export const THEME_STORAGE_KEY = "gnfc-theme"

let currentTheme = "light"
let preference = null
let initialized = false
const listeners = new Set()

function validTheme(value) {
  return value === "light" || value === "dark"
}

function deviceTheme() {
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

function applyTheme(theme) {
  const changed = currentTheme !== theme
  currentTheme = theme
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  if (changed) listeners.forEach((listener) => listener())
}

export function initializeTheme() {
  if (initialized || typeof window === "undefined") return
  initialized = true
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
    preference = validTheme(saved) ? saved : null
  } catch {
    // Theme switching still works when the browser blocks storage.
  }
  applyTheme(preference || deviceTheme())

  const onDeviceChange = () => {
    if (!preference) applyTheme(deviceTheme())
  }
  if (typeof window.matchMedia === "function") {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    if (media.addEventListener) media.addEventListener("change", onDeviceChange)
    else if (media.addListener) media.addListener(onDeviceChange)
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return
    preference = validTheme(event.newValue) ? event.newValue : null
    applyTheme(preference || deviceTheme())
  })
}

export function getTheme() {
  return currentTheme
}

export function getServerTheme() {
  return "light"
}

export function subscribeTheme(listener) {
  initializeTheme()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setTheme(theme) {
  if (!validTheme(theme) || typeof window === "undefined") return
  initializeTheme()
  preference = theme
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Keep the in-memory choice for this visit.
  }
  applyTheme(theme)
}

export function toggleTheme() {
  initializeTheme()
  setTheme(currentTheme === "dark" ? "light" : "dark")
}
