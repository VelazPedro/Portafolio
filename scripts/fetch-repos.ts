import { config as loadEnv } from 'dotenv'
import { Octokit } from '@octokit/rest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { portfolioConfig } from '../config/portfolio.config'

loadEnv({ path: path.resolve(process.cwd(), '.env.local') })

const CACHE_DIR = path.resolve(process.cwd(), '.cache/raw')
const MAX_MANIFEST_BYTES = 300_000

const MANIFEST_EXACT_NAMES = new Set([
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'pom.xml',
  'Cargo.toml',
  'go.mod',
  'composer.json',
  'Gemfile',
])

const EXCLUDED_PATH_SEGMENTS = new Set([
  'node_modules',
  'vendor',
  'dist',
  'build',
  '.venv',
  'venv',
  'target',
  'bin',
  'obj',
])

export interface RawManifestFile {
  path: string
  content: string
}

export interface RawRepoMeta {
  name: string
  description: string | null
  url: string
  homepage: string | null
  topics: string[]
  license: string | null
  createdAt: string
  pushedAt: string
  stars: number
  forks: number
  defaultBranch: string
  archived: boolean
  fork: boolean
}

export interface RawRepoData {
  meta: RawRepoMeta
  commitCount: number
  languages: Record<string, number>
  filePaths: string[]
  readme: string | null
  manifests: RawManifestFile[]
  headSha: string
}

function isRequestError(err: unknown): err is { status: number; response?: { headers?: Record<string, string> } } {
  return typeof err === 'object' && err !== null && 'status' in err
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 5): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      return await fn()
    } catch (err) {
      attempt += 1
      const status = isRequestError(err) ? err.status : undefined
      const retryable = status === 403 || status === 429 || status === 502 || status === 503
      if (attempt > maxRetries || !retryable) throw err

      let waitMs = 2 ** attempt * 1000
      if (isRequestError(err)) {
        const retryAfter = err.response?.headers?.['retry-after']
        const rateLimitReset = err.response?.headers?.['x-ratelimit-reset']
        if (retryAfter) {
          waitMs = Number(retryAfter) * 1000
        } else if (rateLimitReset) {
          waitMs = Math.max(0, Number(rateLimitReset) * 1000 - Date.now()) + 1000
        }
      }
      console.warn(`[rate-limit] ${label}: reintento ${attempt}/${maxRetries} en ${Math.round(waitMs / 1000)}s`)
      await sleep(waitMs)
    }
  }
}

function isManifestPath(filePath: string): boolean {
  const segments = filePath.split('/')
  if (segments.some((s) => EXCLUDED_PATH_SEGMENTS.has(s))) return false
  const base = segments[segments.length - 1] ?? ''
  return MANIFEST_EXACT_NAMES.has(base) || base.endsWith('.csproj')
}

async function getHeadSha(octokit: Octokit, owner: string, repo: string, branch: string): Promise<string> {
  const res = await withRetry(
    () => octokit.rest.repos.getBranch({ owner, repo, branch }),
    `getBranch(${repo})`,
  )
  return res.data.commit.sha
}

async function getCommitCount(octokit: Octokit, owner: string, repo: string, branch: string): Promise<number> {
  const res = await withRetry(
    () =>
      octokit.request('GET /repos/{owner}/{repo}/commits', {
        owner,
        repo,
        sha: branch,
        per_page: 1,
      }),
    `commits(${repo})`,
  )
  const link = res.headers.link
  if (!link) return res.data.length
  const match = /&page=(\d+)>; rel="last"/.exec(link)
  return match?.[1] ? Number(match[1]) : res.data.length
}

async function getReadme(octokit: Octokit, owner: string, repo: string): Promise<string | null> {
  try {
    const res = await withRetry(() => octokit.rest.repos.getReadme({ owner, repo }), `readme(${repo})`)
    return Buffer.from(res.data.content, 'base64').toString('utf-8')
  } catch (err) {
    if (isRequestError(err) && err.status === 404) return null
    throw err
  }
}

async function getManifestFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  filePaths: string[],
): Promise<RawManifestFile[]> {
  const manifestPaths = filePaths.filter(isManifestPath)
  const manifests: RawManifestFile[] = []

  for (const manifestPath of manifestPaths) {
    try {
      const res = await withRetry(
        () => octokit.rest.repos.getContent({ owner, repo, path: manifestPath }),
        `getContent(${repo}/${manifestPath})`,
      )
      if (Array.isArray(res.data) || res.data.type !== 'file') continue
      if (res.data.size > MAX_MANIFEST_BYTES) {
        console.warn(`[skip] ${repo}/${manifestPath}: manifiesto demasiado grande (${res.data.size} bytes)`)
        continue
      }
      if (!res.data.content) continue
      manifests.push({
        path: manifestPath,
        content: Buffer.from(res.data.content, 'base64').toString('utf-8'),
      })
    } catch (err) {
      console.warn(`[skip] ${repo}/${manifestPath}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return manifests
}

async function readCache(repoName: string): Promise<RawRepoData | null> {
  const cachePath = path.join(CACHE_DIR, `${repoName}.json`)
  if (!existsSync(cachePath)) return null
  try {
    const raw = await readFile(cachePath, 'utf-8')
    return JSON.parse(raw) as RawRepoData
  } catch {
    return null
  }
}

async function writeCache(repoName: string, data: RawRepoData): Promise<void> {
  const cachePath = path.join(CACHE_DIR, `${repoName}.json`)
  await writeFile(cachePath, JSON.stringify(data, null, 2), 'utf-8')
}

interface RepoListItem {
  name: string
  archived: boolean
  fork: boolean
}

async function fetchOneRepo(octokit: Octokit, owner: string, name: string): Promise<void> {
  const full = await withRetry(() => octokit.rest.repos.get({ owner, repo: name }), `get(${name})`)
  const defaultBranch = full.data.default_branch

  let headSha: string
  try {
    headSha = await getHeadSha(octokit, owner, name, defaultBranch)
  } catch (err) {
    if (isRequestError(err) && (err.status === 404 || err.status === 409)) {
      console.log(`[skip] ${name}: repositorio vacío o sin rama por defecto accesible`)
      return
    }
    throw err
  }

  const cached = await readCache(name)
  if (cached && cached.headSha === headSha) {
    console.log(`[cache] ${name}: sin cambios (sha ${headSha.slice(0, 7)})`)
    return
  }

  const commitCount = await getCommitCount(octokit, owner, name, defaultBranch)

  const languagesRes = await withRetry(
    () => octokit.rest.repos.listLanguages({ owner, repo: name }),
    `languages(${name})`,
  )

  const treeRes = await withRetry(
    () => octokit.rest.git.getTree({ owner, repo: name, tree_sha: headSha, recursive: '1' }),
    `tree(${name})`,
  )
  const filePaths = treeRes.data.tree
    .filter((entry) => entry.type === 'blob' && typeof entry.path === 'string')
    .map((entry) => entry.path as string)

  const readme = await getReadme(octokit, owner, name)
  const manifests = await getManifestFiles(octokit, owner, name, filePaths)

  const data: RawRepoData = {
    meta: {
      name: full.data.name,
      description: full.data.description,
      url: full.data.html_url,
      homepage: full.data.homepage,
      topics: full.data.topics ?? [],
      license: full.data.license?.spdx_id ?? null,
      createdAt: full.data.created_at ?? '',
      pushedAt: full.data.pushed_at ?? '',
      stars: full.data.stargazers_count ?? 0,
      forks: full.data.forks_count ?? 0,
      defaultBranch,
      archived: full.data.archived,
      fork: full.data.fork,
    },
    commitCount,
    languages: languagesRes.data,
    filePaths,
    readme,
    manifests,
    headSha,
  }

  await writeCache(name, data)
  console.log(`[ok] ${name}: ${filePaths.length} archivos, ${manifests.length} manifiestos, ${commitCount} commits`)
}

export async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    console.warn(
      '[warn] GITHUB_TOKEN no definido: usando API pública sin autenticar (límite 60 req/hora). ' +
        'Definilo en .env.local para levantar el límite a 5000 req/hora.',
    )
  }

  await mkdir(CACHE_DIR, { recursive: true })
  const octokit = new Octokit(token ? { auth: token } : {})
  const owner = portfolioConfig.githubUsername

  const repos = (await octokit.paginate(octokit.rest.repos.listForUser, {
    username: owner,
    type: 'owner',
    per_page: 100,
  })) as RepoListItem[]

  const toProcess: RepoListItem[] = []
  for (const repo of repos) {
    if (repo.archived) {
      console.log(`[skip] ${repo.name}: archivado`)
      continue
    }
    if (repo.fork && !portfolioConfig.includeForks) {
      console.log(`[skip] ${repo.name}: es fork (includeForks=false)`)
      continue
    }
    if (portfolioConfig.exclude.includes(repo.name)) {
      console.log(`[skip] ${repo.name}: excluido por config/portfolio.config.ts`)
      continue
    }
    toProcess.push(repo)
  }

  console.log(`Procesando ${toProcess.length} repos de ${owner}...`)

  for (const repo of toProcess) {
    try {
      await fetchOneRepo(octokit, owner, repo.name)
    } catch (err) {
      console.error(`[error] ${repo.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
