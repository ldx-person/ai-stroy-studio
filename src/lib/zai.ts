import ZAI from 'z-ai-web-dev-sdk'

// Singleton pattern for ZAI instance to avoid memory leaks in dev mode
// In development, Next.js hot reloads modules, but we want to reuse the same instance

declare global {
  var zaiInstance: Awaited<ReturnType<typeof ZAI.create>> | undefined
}

let zaiPromise: Promise<Awaited<ReturnType<typeof ZAI.create>>> | null = null

export async function getZAI() {
  // In development, use global to persist across hot reloads
  if (process.env.NODE_ENV !== 'production') {
    if (!globalThis.zaiInstance) {
      globalThis.zaiInstance = await ZAI.create()
    }
    return globalThis.zaiInstance
  }
  
  // In production, use a cached promise
  if (!zaiPromise) {
    zaiPromise = ZAI.create()
  }
  return zaiPromise
}
