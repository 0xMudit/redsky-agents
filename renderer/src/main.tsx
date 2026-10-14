import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/architects-daughter/400.css'
import '@fontsource/fira-code/400.css'
import '@fontsource/fira-code/500.css'
import '@fontsource/outfit/400.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/antic/400.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/montserrat/400.css'
import '@fontsource/inter/400.css'
import './style.css'
import App from './App'

const el = document.getElementById('root')
if (!el) throw new Error('#root missing')
createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)