import type { GraphFilters } from '@/lib/graphUtils'
import { defaultFilters } from '@/lib/graphUtils'

interface Props {
  filters: GraphFilters
  onChange: (filters: GraphFilters) => void
  options: {
    languages: string[]
    domains: string[]
    years: number[]
    statuses: string[]
  }
}

function selectClass() {
  return 'rounded border border-white/15 bg-surface px-2 py-1 text-xs text-gray-200 focus:border-accent focus:outline-none'
}

export function FilterBar({ filters, onChange, options }: Props) {
  const update = (patch: Partial<GraphFilters>) => onChange({ ...filters, ...patch })

  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
      <input
        type="search"
        placeholder="buscar proyecto…"
        aria-label="Buscar proyecto"
        value={filters.search}
        onChange={(e) => update({ search: e.target.value })}
        className="w-40 rounded border border-white/15 bg-bg px-2 py-1 text-gray-200 placeholder:text-gray-500 focus:border-accent focus:outline-none"
      />

      <select
        aria-label="Filtrar por lenguaje"
        value={filters.language ?? ''}
        onChange={(e) => update({ language: e.target.value || null })}
        className={selectClass()}
      >
        <option value="">lenguaje: todos</option>
        {options.languages.map((lang) => (
          <option key={lang} value={lang}>
            {lang}
          </option>
        ))}
      </select>

      <select
        aria-label="Filtrar por dominio"
        value={filters.domain ?? ''}
        onChange={(e) => update({ domain: e.target.value || null })}
        className={selectClass()}
      >
        <option value="">dominio: todos</option>
        {options.domains.map((domain) => (
          <option key={domain} value={domain}>
            {domain}
          </option>
        ))}
      </select>

      <select
        aria-label="Filtrar por año"
        value={filters.year ?? ''}
        onChange={(e) => update({ year: e.target.value ? Number(e.target.value) : null })}
        className={selectClass()}
      >
        <option value="">año: todos</option>
        {options.years.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>

      <select
        aria-label="Filtrar por estado"
        value={filters.status ?? ''}
        onChange={(e) => update({ status: e.target.value || null })}
        className={selectClass()}
      >
        <option value="">estado: todos</option>
        {options.statuses.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>

      <label className="flex items-center gap-1 text-gray-300">
        <input
          type="checkbox"
          checked={filters.onlyActive}
          onChange={(e) => update({ onlyActive: e.target.checked })}
        />
        solo activos
      </label>

      <button
        type="button"
        onClick={() => onChange(defaultFilters)}
        className="rounded border border-white/15 px-2 py-1 text-gray-300 hover:border-accent hover:text-accent"
      >
        reset
      </button>
    </div>
  )
}
