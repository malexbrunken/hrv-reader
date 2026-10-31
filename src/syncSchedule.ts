let chain: Promise<void> = Promise.resolve()
let job: (() => Promise<void>) | null = null

/** The app registers one reconcile function. Folder and cloud sync share its queue. */
export function registerReconcile(fn: () => Promise<void>): void {
  job = fn
}

export function scheduleReconcile(): void {
  const run = chain.then(
    () => job?.() ?? Promise.resolve(),
    () => job?.() ?? Promise.resolve(),
  )
  chain = run.then(
    () => undefined,
    () => undefined,
  )
}
