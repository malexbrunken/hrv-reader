import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root')

// StrictMode remounts effects in development and would drop a GATT connection
// immediately after the strap is paired.
createRoot(root).render(<App />)
