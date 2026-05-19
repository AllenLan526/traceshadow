import React from 'react'
import ReactDOM from 'react-dom/client'
import TraceShadowApp from './TraceShadowApp'
import './index.css'

const root = document.getElementById('root')

if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((regs) => {
      for (const reg of regs) void reg.unregister()
    })
    .catch(() => {})
}

function showBootError(message: string) {
  document.body.innerHTML = `
    <main style="min-height:100vh;padding:32px;background:#071016;color:#d8f7f8;font-family:system-ui,sans-serif">
      <h1 style="margin:0 0 12px;font-size:32px">TraceShadow could not start</h1>
      <p id="boot-error-message" style="max-width:680px;line-height:1.6;color:#9fb4bd"></p>
      <p style="max-width:680px;line-height:1.6;color:#9fb4bd">Try a hard refresh, or clear site data for localhost:5173.</p>
    </main>
  `

  const messageEl = document.getElementById('boot-error-message')
  if (messageEl) messageEl.textContent = message
}

function BootErrorScreen({ message }: { message: string }) {
  return (
    <main style={{ minHeight: '100vh', padding: 32, background: '#071016', color: '#d8f7f8', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ margin: '0 0 12px', fontSize: 32 }}>TraceShadow could not start</h1>
      <p style={{ maxWidth: 680, lineHeight: 1.6, color: '#9fb4bd' }}>{message}</p>
      <p style={{ maxWidth: 680, lineHeight: 1.6, color: '#9fb4bd' }}>
        Try a hard refresh, or clear site data for localhost:5173.
      </p>
    </main>
  )
}

class BootBoundary extends React.Component<{ children: React.ReactNode }, { message: string }> {
  state = { message: '' }

  static getDerivedStateFromError(err: unknown) {
    return { message: err instanceof Error ? err.message : 'Unknown render error.' }
  }

  componentDidCatch(err: unknown) {
    console.error(err)
  }

  render() {
    if (this.state.message) return <BootErrorScreen message={this.state.message} />
    return this.props.children
  }
}

try {
  if (!root) throw new Error('Missing #root element.')

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <BootBoundary>
        <TraceShadowApp />
      </BootBoundary>
    </React.StrictMode>
  )
} catch (err) {
  showBootError(err instanceof Error ? err.message : 'Unknown startup error.')
}
