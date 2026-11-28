import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import './styles.css'

// Errors in the window go in Arete's log too, for Copy diagnostics.
const report = (message: string) => void window.arete?.logWindowError(message).catch(() => undefined)
window.addEventListener('error', (e) => report(`${e.message} at ${e.filename?.split('/').pop()}:${e.lineno}`))
window.addEventListener('unhandledrejection', (e) =>
  report(`unhandled: ${e.reason instanceof Error ? `${e.reason.message} ${e.reason.stack?.split('\n')[1]?.trim() ?? ''}` : String(e.reason)}`)
)

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 } }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
)
