import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/architects-daughter/400.css'
import '@fontsource/fira-code/400.css'
import '@fontsource/fira-code/500.css'
import './style.css'
import App from './App'

const el = document.getElementById('root')
if (!el) throw new Error('#root missing')
createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)