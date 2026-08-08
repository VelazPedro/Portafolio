async function run(step: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n=== ${step} ===`)
  await fn()
}

async function main(): Promise<void> {
  const fetchRepos = await import('./fetch-repos')
  await run('1. fetch-repos', fetchRepos.main)

  const analyzeRepo = await import('./analyze-repo')
  await run('2. analyze-repo', analyzeRepo.main)

  const summarize = await import('./summarize')
  await run('3. summarize', summarize.main)

  const buildGraph = await import('./build-graph')
  await run('4. build-graph', buildGraph.main)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
