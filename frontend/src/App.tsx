import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Download,
  ExternalLink,
  Filter,
  Gauge,
  Info,
  LayoutDashboard,
  RefreshCw,
  Search,
  ShieldCheck,
  Wind,
  X,
} from 'lucide-react'

type RecordRow = {
  startTime: string
  settlementDate: string
  settlementPeriod: number | null
  forecastMW: number | null
  actualMW: number | null
  publishTime: string | null
  actualPublishTime: string | null
  errorMW: number | null
  absoluteErrorMW: number | null
}

type Metrics = {
  intervalsExpected: number
  intervalsForecasted: number
  intervalsMatched: number
  coveragePct: number
  maeMW: number | null
  rmseMW: number | null
  mapePct: number | null
  mapeEligibleIntervals: number
  zeroActualIntervals: number
  signedBiasMW: number | null
  actualIntervalsAvailable: number
  actualCoveragePct: number
  forecastOnlyIntervals: number
  actualOnlyIntervals: number
  missingForecastIntervals: number
}

type QualityData = {
  forecastSourceRows: number
  actualWindSourceRows: number
  uniqueActualIntervals: number
  selectedForecastIntervals: number
  duplicateActualRevisionsCollapsed: number
  forecastVintageRowsNotSelected: number
  apiSources: string[]
}

type Payload = {
  month: string
  timezone: string
  cutoff: string
  records: RecordRow[]
  metrics: Metrics
  quality: QualityData
}

type TabName = 'Overview' | 'Forecast explorer' | 'Accuracy analysis' | 'Data quality'
type SortField = 'startTime' | 'forecastMW' | 'actualMW' | 'errorMW' | 'publishTime'
type SortDirection = 'asc' | 'desc'

const API = import.meta.env.VITE_API_URL || ''

const pretty = (v: number | null | undefined, d = 0) =>
  v == null || !Number.isFinite(v)
    ? '—'
    : v.toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d })

const formatUtcTime = (s: string | null) =>
  s
    ? new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
        hour12: false,
      }).format(new Date(s))
    : '—'

const formatUtcDate = (s: string | null) =>
  s
    ? new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        timeZone: 'UTC',
      }).format(new Date(s))
    : '—'

const formatFullUtcDate = (s: string | null) =>
  s
    ? new Intl.DateTimeFormat('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(s))
    : '—'

const CUTOFF_PRESETS = [
  { id: 'day-ahead', label: 'Day-ahead (24 hours before delivery)' },
  { id: 'month-start', label: 'Month start (2026-01-01 00:00 UTC)', value: '2026-01-01T00:00:00Z' },
  { id: 'pre-month', label: 'Pre-month (2025-12-31 12:00 UTC)', value: '2025-12-31T12:00:00Z' },
  { id: 'mid-month', label: 'Mid-month (2026-01-15 12:00 UTC)', value: '2026-01-15T12:00:00Z' },
  { id: 'custom', label: 'Custom UTC cutoff…' },
]

function App() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cutoffPreset, setCutoffPreset] = useState('day-ahead')
  const [customUtcDate, setCustomUtcDate] = useState('2025-12-31')
  const [customUtcTime, setCustomUtcTime] = useState('12:00')
  const [appliedCustomCutoff, setAppliedCustomCutoff] = useState('2025-12-31T12:00:00Z')
  const [headerDateSelection, setHeaderDateSelection] = useState('all')
  const [selectedDay, setSelectedDay] = useState('2026-01-15')
  const [tab, setTab] = useState<TabName>('Overview')
  const [selectedInterval, setSelectedInterval] = useState<RecordRow | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'matched' | 'gaps' | 'high'>('all')
  const [sortField, setSortField] = useState<SortField>('startTime')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(12)
  const [reloadTrigger, setReloadTrigger] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [hoveredPoint, setHoveredPoint] = useState<{
    period: number
    timeStr: string
    row: RecordRow | null
    x: number
    yF: number | null
    yA: number | null
  } | null>(null)

  // In-memory response cache to avoid repeated requests for unchanged cutoffs
  const cacheRef = useRef<Record<string, Payload>>({})

  // Compute active cutoff query parameter
  const activeCutoffValue = useMemo(() => {
    if (cutoffPreset === 'day-ahead') return 'day-ahead'
    if (cutoffPreset === 'custom') return appliedCustomCutoff
    const preset = CUTOFF_PRESETS.find(p => p.id === cutoffPreset)
    return preset?.value || 'day-ahead'
  }, [cutoffPreset, appliedCustomCutoff])

  // Fetch analysis data
  const fetchData = useCallback(
    async (forceRefresh = false) => {
      const cacheKey = activeCutoffValue
      if (!forceRefresh && cacheRef.current[cacheKey]) {
        setData(cacheRef.current[cacheKey])
        setLoading(false)
        setError('')
        return
      }

      setLoading(true)
      setError('')
      try {
        const url = `${API}/api/analysis?month=2026-01&cutoff=${encodeURIComponent(activeCutoffValue)}${
          forceRefresh ? '&refresh=true' : ''
        }`
        const res = await fetch(url)
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.detail || `Request failed with status ${res.status}`)
        }
        const json: Payload = await res.json()
        cacheRef.current[cacheKey] = json
        setData(json)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to connect to Elexon BMRS API'
        setError(msg)
      } finally {
        setLoading(false)
        setIsRefreshing(false)
      }
    },
    [activeCutoffValue]
  )

  useEffect(() => {
    fetchData(isRefreshing)
  }, [fetchData, reloadTrigger, isRefreshing])

  const handleReload = () => {
    if (loading) return
    setIsRefreshing(true)
    setReloadTrigger(n => n + 1)
  }

  const handleApplyCustomCutoff = (e: React.FormEvent) => {
    e.preventDefault()
    if (!customUtcDate || !customUtcTime) return
    const iso = `${customUtcDate}T${customUtcTime}:00Z`
    setAppliedCustomCutoff(iso)
  }

  // Handle header date range selector change
  const handleHeaderDateChange = (val: string) => {
    setHeaderDateSelection(val)
    if (val !== 'all') {
      setSelectedDay(val)
    }
  }

  const modalRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const triggerElementRef = useRef<HTMLElement | null>(null)

  // Track triggering element when opening modal
  const handleOpenModal = useCallback((row: RecordRow) => {
    triggerElementRef.current = document.activeElement as HTMLElement | null
    setSelectedInterval(row)
  }, [])

  // Focus management when modal opens or closes
  useEffect(() => {
    if (selectedInterval) {
      const timer = setTimeout(() => {
        closeButtonRef.current?.focus()
      }, 40)
      return () => clearTimeout(timer)
    } else if (triggerElementRef.current) {
      triggerElementRef.current.focus()
    }
  }, [selectedInterval])

  // Focus trap and keyboard dismiss for modal dialog
  const handleModalKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      setSelectedInterval(null)
      return
    }
    if (e.key === 'Tab' && modalRef.current) {
      const focusables = modalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex="0"]:not([disabled])'
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
  }

  // Close modal on Escape key
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedInterval) {
        setSelectedInterval(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedInterval])

  const records = useMemo(() => data?.records || [], [data])
  const metric = data?.metrics

  // Filtered and searched records for Forecast Explorer table
  const filtered = useMemo(() => {
    return records.filter(r => {
      // Date filter from header if a specific day is selected
      if (headerDateSelection !== 'all' && r.settlementDate !== headerDateSelection) {
        return false
      }

      // Text search
      if (query) {
        const q = query.trim().toLowerCase()
        const formattedDate = formatUtcDate(r.startTime).toLowerCase()
        const shortDate = formattedDate.replace(' 2026', '')
        const timeStr = formatUtcTime(r.startTime)
        const statusStr = r.actualMW != null && r.forecastMW != null ? 'matched' : 'missing gap unforecasted'

        // Check if query is looking for a specific day in January (e.g. "15 Jan", "Jan 15", "2026-01-15")
        const dateMatch = q.match(/(?:^|\b)(\d{1,2})(?:st|nd|rd|th)?\s*jan|\bjan\s*(\d{1,2})|\b2026-01-(\d{2})\b/)
        if (dateMatch) {
          const dayNum = String(parseInt(dateMatch[1] || dateMatch[2] || dateMatch[3], 10)).padStart(2, '0')
          if (r.settlementDate !== `2026-01-${dayNum}`) return false
        }

        // Check if query specifies a settlement period (e.g., "sp 12", "period 4")
        const spMatch = q.match(/(?:sp|period)\s*(\d{1,2})/)
        if (spMatch) {
          const targetSp = parseInt(spMatch[1], 10)
          if (r.settlementPeriod !== targetSp) return false
        }

        // Check if query specifies a time (e.g., "14:30")
        const timeMatch = q.match(/\b(\d{1,2}:\d{2})\b/)
        if (timeMatch) {
          if (!timeStr.includes(timeMatch[1])) return false
        }

        // If not a structured date/sp/time query, perform word matching
        if (!dateMatch && !spMatch && !timeMatch) {
          const searchWords = q.split(/\s+/).filter(Boolean)
          const corpus = `${r.settlementDate} ${shortDate} ${timeStr} sp${r.settlementPeriod} ${statusStr}`.toLowerCase()
          if (!searchWords.every(word => corpus.includes(word))) return false
        }
      }

      // Filter category
      if (filter === 'matched') {
        return r.actualMW != null && r.forecastMW != null
      }
      if (filter === 'gaps') {
        return r.actualMW == null || r.forecastMW == null
      }
      if (filter === 'high') {
        return r.absoluteErrorMW != null && r.absoluteErrorMW > 2000
      }
      return true
    })
  }, [records, headerDateSelection, query, filter])

  // Sorted records
  const sorted = useMemo(() => {
    const list = [...filtered]
    list.sort((a, b) => {
      let vA = a[sortField]
      let vB = b[sortField]

      if (vA == null && vB == null) return 0
      if (vA == null) return 1
      if (vB == null) return -1

      if (typeof vA === 'string' && typeof vB === 'string') {
        const cmp = vA.localeCompare(vB)
        return sortDirection === 'asc' ? cmp : -cmp
      }
      const numA = Number(vA)
      const numB = Number(vB)
      return sortDirection === 'asc' ? numA - numB : numB - numA
    })
    return list
  }, [filtered, sortField, sortDirection])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const shown = useMemo(() => {
    const start = safePage * pageSize
    return sorted.slice(start, start + pageSize)
  }, [sorted, safePage, pageSize])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  // Delivery day records for trend chart (all 48 settlement periods)
  const dayRows = useMemo(() => {
    return records.filter(r => r.settlementDate === selectedDay)
  }, [records, selectedDay])

  // Daily MAE profile across all 31 days
  const dailyMaeData = useMemo(() => {
    return Array.from({ length: 31 }, (_, i) => {
      const dateStr = `2026-01-${String(i + 1).padStart(2, '0')}`
      const dayMatches = records.filter(r => r.settlementDate === dateStr && r.errorMW != null)
      const count = dayMatches.length
      const mae = count ? dayMatches.reduce((s, r) => s + Math.abs(r.errorMW!), 0) / count : null
      const bias = count ? dayMatches.reduce((s, r) => s + r.errorMW!, 0) / count : null
      return { day: i + 1, dateStr, mae, bias, count }
    })
  }, [records])

  const maxDailyMae = useMemo(() => {
    const vals = dailyMaeData.map(d => d.mae).filter((v): v is number => v != null)
    return vals.length ? Math.max(...vals) : 1
  }, [dailyMaeData])

  // Chart setup for selected delivery day
  // Exactly 48 settlement periods (Period 1 = 00:00 UTC to Period 48 = 23:30 UTC)
  const dayGridPeriods = useMemo(() => {
    return Array.from({ length: 48 }, (_, i) => {
      const period = i + 1
      const hour = Math.floor(i / 2)
      const minute = i % 2 === 0 ? '00' : '30'
      const timeStr = `${String(hour).padStart(2, '0')}:${minute}`
      const row = dayRows.find(r => r.settlementPeriod === period) || null
      return {
        period,
        timeStr,
        row,
        forecastMW: row?.forecastMW ?? null,
        actualMW: row?.actualMW ?? null,
        errorMW: row?.errorMW ?? null,
      }
    })
  }, [dayRows])

  // Chart min/max scaling
  const chartBounds = useMemo(() => {
    const vals: number[] = []
    dayGridPeriods.forEach(p => {
      if (p.forecastMW != null) vals.push(p.forecastMW)
      if (p.actualMW != null) vals.push(p.actualMW)
    })
    if (!vals.length) return { min: 0, max: 20000, range: 20000 }
    const rawMin = Math.min(...vals)
    const rawMax = Math.max(...vals)
    const pad = Math.max(500, (rawMax - rawMin) * 0.1)
    const min = Math.max(0, Math.floor((rawMin - pad) / 500) * 500)
    const max = Math.ceil((rawMax + pad) / 500) * 500
    return { min, max, range: Math.max(1, max - min) }
  }, [dayGridPeriods])

  // Chart coordinates: width 1000, height 180, margins left 50, right 20, top 15, bottom 25
  const chartWidth = 1000
  const chartHeight = 180
  const chartMargin = { left: 45, right: 15, top: 15, bottom: 25 }
  const plotW = chartWidth - chartMargin.left - chartMargin.right
  const plotH = chartHeight - chartMargin.top - chartMargin.bottom

  const getX = (period: number) => chartMargin.left + ((period - 1) / 47) * plotW
  const getY = (val: number | null) =>
    val == null ? null : chartMargin.top + (1 - (val - chartBounds.min) / chartBounds.range) * plotH

  // CSV Export function for filtered records
  const handleDownloadCsv = () => {
    if (!sorted.length) return
    const headers = [
      'settlementDate',
      'settlementPeriod',
      'startTime_utc',
      'forecastMW',
      'actualMW',
      'errorMW',
      'absoluteErrorMW',
      'forecastPublishTime_utc',
      'actualPublishTime_utc',
      'status',
    ]

    const rows = sorted.map(r => [
      r.settlementDate,
      r.settlementPeriod ?? '',
      r.startTime,
      r.forecastMW ?? '',
      r.actualMW ?? '',
      r.errorMW ?? '',
      r.absoluteErrorMW ?? '',
      r.publishTime ?? '',
      r.actualPublishTime ?? '',
      r.actualMW != null && r.forecastMW != null
        ? 'Matched'
        : r.forecastMW == null
        ? 'Missing forecast'
        : 'Missing actual',
    ])

    const csvContent = [headers.join(','), ...rows.map(row => row.map(cell => JSON.stringify(cell ?? '')).join(','))].join(
      '\n'
    )
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const cutoffClean = activeCutoffValue.replace(/[:.]/g, '-').replace('Z', '')
    link.href = url
    link.download = `windiq-january-2026-cutoff-${cutoffClean}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="app-shell">
      {/* Sidebar Navigation */}
      <aside className="sidebar" aria-label="Main Navigation">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <Wind size={19} strokeWidth={2.2} />
          </div>
          <span>WindIQ</span>
        </div>
        <div className="side-caption">JANUARY 2026 PILOT</div>
        <div className="workspace">
          <div className="workspace-dot" aria-hidden="true">
            <Wind size={14} />
          </div>
          <div>
            <b>UK wind generation</b>
            <small>Elexon BMRS archive</small>
          </div>
        </div>

        <div className="side-caption nav-label">VIEWS</div>
        <nav className="nav-group">
          {(
            [
              { name: 'Overview', icon: LayoutDashboard },
              { name: 'Forecast explorer', icon: Search },
              { name: 'Accuracy analysis', icon: BarChart3 },
              { name: 'Data quality', icon: ShieldCheck },
            ] as const
          ).map(({ name, icon: Icon }) => (
            <button
              key={name}
              type="button"
              onClick={() => setTab(name)}
              className={`nav-item ${tab === name ? 'active' : ''}`}
              aria-current={tab === name ? 'page' : undefined}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{name}</span>
            </button>
          ))}
        </nav>

        <div className="side-bottom">
          <div className="connection" role="status">
            <span
              className={`status-dot ${error ? 'status-error' : loading ? 'status-loading' : 'status-ready'}`}
              aria-hidden="true"
            />
            <span>
              {loading
                ? 'Fetching Elexon data…'
                : error
                ? 'Elexon data unavailable'
                : data
                ? 'Elexon archive loaded'
                : 'Awaiting data'}
            </span>
          </div>
          <div className="source-note">
            Historical pilot matching Elexon FUELHH actuals with WINDFOR forecasts.
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main" id="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            WindIQ <span aria-hidden="true">/</span> <b>{tab}</b>
          </div>
          <div className="top-actions">
            <span className="source-badge">
              Elexon BMRS <span aria-hidden="true">·</span>{' '}
              {loading ? 'Refreshing…' : error ? 'Error' : 'January 2026 Archive (UTC)'}
            </span>
          </div>
        </header>

        <div className="content">
          {/* Page Header */}
          <div className="page-head">
            <div>
              <div className="eyebrow">
                <span>UK NATIONAL GRID · WIND POWER · JANUARY 2026</span>
              </div>
              <h1>Wind forecast review</h1>
              <p>Compare day-ahead forecasts against actual generation recorded by Elexon.</p>
            </div>
            <div className="head-actions">
              <label className="select-wrap" htmlFor="global-date-select">
                <CalendarDays size={15} aria-hidden="true" />
                <select
                  id="global-date-select"
                  aria-label="Filter delivery date"
                  value={headerDateSelection}
                  onChange={e => handleHeaderDateChange(e.target.value)}
                >
                  <option value="all">Full month: 01–31 Jan 2026</option>
                  {Array.from({ length: 31 }, (_, i) => {
                    const d = `2026-01-${String(i + 1).padStart(2, '0')}`
                    return (
                      <option key={d} value={d}>
                        {i + 1} January 2026
                      </option>
                    )
                  })}
                </select>
                <ChevronDown size={14} aria-hidden="true" />
              </label>

              <button
                type="button"
                className="button-outline"
                onClick={handleDownloadCsv}
                disabled={loading || !sorted.length}
                aria-label={`Download CSV export of ${sorted.length} intervals`}
              >
                <Download size={15} aria-hidden="true" /> Download CSV
              </button>

              <button
                type="button"
                className="button-refresh"
                onClick={handleReload}
                disabled={loading}
                aria-label="Reload data from Elexon BMRS API"
                aria-busy={loading}
              >
                <RefreshCw size={15} className={loading ? 'spin' : ''} aria-hidden="true" />
                {loading ? 'Reloading…' : 'Reload data'}
              </button>
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="error-banner" role="alert">
              <AlertTriangle size={18} aria-hidden="true" />
              <div>
                <b>Unable to load Elexon BMRS data</b>
                <span>{error}</span>
              </div>
              <button type="button" onClick={handleReload} aria-label="Retry fetching data">
                Retry
              </button>
            </div>
          )}

          {/* Loading Indicator */}
          {loading && (
            <div className="loading" role="status" aria-live="polite">
              <div className="loader" aria-hidden="true" />
              Fetching January 2026 records from Elexon BMRS Insights…
            </div>
          )}

          {/* Decision Cutoff Strip */}
          <section className="decision-strip" aria-label="Forecast Cutoff Selection">
            <div className="decision-icon" aria-hidden="true">
              <Clock3 size={17} />
            </div>
            <div className="decision-copy">
              <b>Forecast cutoff (UTC)</b>
              <span>For each interval, selects the latest forecast published by or before this time.</span>
            </div>

            <label className="cutoff-select" htmlFor="cutoff-preset-select">
              <select
                id="cutoff-preset-select"
                aria-label="Choose forecast cutoff preset"
                value={cutoffPreset}
                onChange={e => setCutoffPreset(e.target.value)}
              >
                {CUTOFF_PRESETS.map(opt => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </label>

            {cutoffPreset === 'custom' && (
              <form className="custom-cutoff-form" onSubmit={handleApplyCustomCutoff}>
                <div className="custom-cutoff-inputs">
                  <label htmlFor="custom-utc-date">
                    <span className="sr-only">Cutoff Date (UTC)</span>
                    <input
                      id="custom-utc-date"
                      type="date"
                      aria-label="Cutoff date in UTC"
                      value={customUtcDate}
                      min="2025-12-28"
                      max="2026-02-01"
                      onChange={e => setCustomUtcDate(e.target.value)}
                    />
                  </label>
                  <label htmlFor="custom-utc-time">
                    <span className="sr-only">Cutoff Time (UTC)</span>
                    <input
                      id="custom-utc-time"
                      type="time"
                      aria-label="Cutoff time in UTC"
                      value={customUtcTime}
                      onChange={e => setCustomUtcTime(e.target.value)}
                    />
                  </label>
                  <span className="utc-tag">UTC</span>
                </div>
                <button type="submit" className="button-apply" aria-label="Apply custom UTC cutoff">
                  Apply
                </button>
              </form>
            )}

            <span className="timezone-note">All timestamps in UTC</span>
          </section>

          {/* VIEW: OVERVIEW */}
          {tab === 'Overview' && (
            <>
              <div className="section-title">
                <div>
                  <h2>Forecast accuracy</h2>
                  <p>Calculated strictly on intervals with both a valid forecast and actual record</p>
                </div>
                <span className="period-label">01–31 Jan 2026 · Elexon BMRS</span>
              </div>

              {/* Metric Cards Grid */}
              <section className="metric-grid" aria-label="Key Accuracy Metrics">
                <MetricCard
                  title="Mean absolute error"
                  value={pretty(metric?.maeMW, 0)}
                  unit="MW"
                  note="Average absolute miss across all matched intervals"
                />
                <MetricCard
                  title="Root mean squared error"
                  value={pretty(metric?.rmseMW, 0)}
                  unit="MW"
                  note="Penalizes larger forecast errors more heavily"
                />
                <MetricCard
                  title="Mean absolute percentage error"
                  value={pretty(metric?.mapePct, 1)}
                  unit="%"
                  note={`${pretty(metric?.mapeEligibleIntervals)} matched intervals; zero actuals omitted`}
                />
                <MetricCard
                  title="Signed bias"
                  value={pretty(metric?.signedBiasMW, 0)}
                  unit="MW"
                  note={
                    metric?.signedBiasMW == null
                      ? 'No matched intervals'
                      : metric.signedBiasMW > 0
                      ? 'Forecast systematically higher than actual (+)'
                      : 'Forecast systematically lower than actual (−)'
                  }
                />
              </section>

              {/* Data Coverage Row */}
              <section className="coverage-row" aria-label="Data Coverage Summary">
                <div className="coverage-label">
                  <span className="coverage-icon" aria-hidden="true">
                    <Gauge size={17} />
                  </span>
                  <div>
                    <b>Data coverage</b>
                    <small>January settlement intervals with both forecast & actual generation</small>
                  </div>
                </div>
                <div className="coverage-stats">
                  <div>
                    <b>
                      {pretty(metric?.intervalsMatched)}
                      <span> / {pretty(metric?.intervalsExpected)}</span>
                    </b>
                    <small>Matched settlement intervals</small>
                  </div>
                  <div
                    className="coverage-bar"
                    role="progressbar"
                    aria-valuenow={metric?.coveragePct || 0}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Coverage percentage"
                  >
                    <div style={{ width: `${Math.min(100, metric?.coveragePct || 0)}%` }} />
                  </div>
                  <div className="coverage-percent">
                    {pretty(metric?.coveragePct, 1)}
                    <small>%</small>
                  </div>
                </div>
              </section>

              {/* Interactive Trend Chart and Heatmap */}
              <div className="dashboard-grid">
                {/* Trend Chart */}
                <section className="panel trend-panel" aria-label="Delivery Day Generation Curve">
                  <div className="panel-head">
                    <div>
                      <h3>Forecast and actual</h3>
                      <p>
                        {formatFullUtcDate(`${selectedDay}T00:00:00Z`)} · 48 half-hour settlement periods (UTC)
                      </p>
                    </div>
                    <label className="day-select" htmlFor="trend-day-select">
                      <span>Delivery day:</span>
                      <select
                        id="trend-day-select"
                        aria-label="Select delivery day for generation curve"
                        value={selectedDay}
                        onChange={e => setSelectedDay(e.target.value)}
                      >
                        {Array.from({ length: 31 }, (_, i) => {
                          const value = `2026-01-${String(i + 1).padStart(2, '0')}`
                          return (
                            <option key={value} value={value}>
                              {i + 1} January
                            </option>
                          )
                        })}
                      </select>
                      <ChevronDown size={14} aria-hidden="true" />
                    </label>
                  </div>

                  <div className="chart-legend" aria-hidden="true">
                    <span>
                      <i className="legend-dot forecast-dot" />
                      Forecast points (hourly)
                    </span>
                    <span>
                      <i className="legend-line actual-line" />
                      Actual line (half-hourly)
                    </span>
                    <span className="unit-label">MW</span>
                  </div>

                  {/* SVG Line Chart */}
                  <div className="trend-chart">
                    <div className="y-labels" aria-hidden="true">
                      <span>{pretty(chartBounds.max)}</span>
                      <span>{pretty((chartBounds.max + chartBounds.min) / 2)}</span>
                      <span>{pretty(chartBounds.min)}</span>
                    </div>

                    <svg
                      viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                      preserveAspectRatio="none"
                      className="line-chart"
                      role="img"
                      aria-label={`Generation curve for ${selectedDay}. Actual generation is reported half-hourly; WINDFOR forecasts are hourly.`}
                      onMouseLeave={() => setHoveredPoint(null)}
                    >
                      {/* Gridlines */}
                      <line
                        x1={chartMargin.left}
                        x2={chartWidth - chartMargin.right}
                        y1={chartMargin.top}
                        y2={chartMargin.top}
                        className="gridline"
                      />
                      <line
                        x1={chartMargin.left}
                        x2={chartWidth - chartMargin.right}
                        y1={chartMargin.top + plotH / 2}
                        y2={chartMargin.top + plotH / 2}
                        className="gridline"
                      />
                      <line
                        x1={chartMargin.left}
                        x2={chartWidth - chartMargin.right}
                        y1={chartMargin.top + plotH}
                        y2={chartMargin.top + plotH}
                        className="gridline"
                      />

                      {/* Actual generation line (connecting consecutive periods with actual data) */}
                      {dayGridPeriods.some(p => p.actualMW != null) && (
                        <path
                          d={dayGridPeriods.reduce((acc, p, idx) => {
                            if (p.actualMW == null) return acc
                            const x = getX(p.period)
                            const y = getY(p.actualMW)!
                            const prev = idx > 0 ? dayGridPeriods[idx - 1] : null
                            if (!acc || !prev || prev.actualMW == null) {
                              return `${acc} M ${x.toFixed(1)} ${y.toFixed(1)}`
                            }
                            return `${acc} L ${x.toFixed(1)} ${y.toFixed(1)}`
                          }, '')}
                          fill="none"
                          stroke="#17856b"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      )}

                      {/* Discrete hourly forecast points with visible half-hourly gaps (no connecting line between hourly points) */}
                      {dayGridPeriods.map(p => {
                        const x = getX(p.period)
                        const yA = getY(p.actualMW)
                        const yF = getY(p.forecastMW)
                        const isHovered = hoveredPoint?.period === p.period
                        const pointLabel = `Settlement period ${p.period}, ${p.timeStr} UTC: Actual ${pretty(
                          p.actualMW
                        )} MW, Forecast ${p.forecastMW != null ? `${pretty(p.forecastMW)} MW` : 'No forecast published'}`

                        return (
                          <g
                            key={p.period}
                            className="chart-point-group"
                            tabIndex={0}
                            role="button"
                            aria-label={pointLabel}
                            style={{ cursor: 'pointer' }}
                            onMouseEnter={() =>
                              setHoveredPoint({
                                period: p.period,
                                timeStr: p.timeStr,
                                row: p.row,
                                x,
                                yF,
                                yA,
                              })
                            }
                            onFocus={() =>
                              setHoveredPoint({
                                period: p.period,
                                timeStr: p.timeStr,
                                row: p.row,
                                x,
                                yF,
                                yA,
                              })
                            }
                            onBlur={() => setHoveredPoint(null)}
                            onKeyDown={e => {
                              if ((e.key === 'Enter' || e.key === ' ') && p.row) {
                                e.preventDefault()
                                handleOpenModal(p.row)
                              }
                            }}
                            onClick={() => p.row && handleOpenModal(p.row)}
                          >
                            {/* Hit-test area for hover, focus, and click */}
                            <rect
                              x={x - plotW / 96}
                              y={chartMargin.top}
                              width={plotW / 48}
                              height={plotH}
                              fill="transparent"
                              style={{ pointerEvents: 'all', cursor: 'pointer' }}
                              onClick={() => p.row && handleOpenModal(p.row)}
                            />

                            {/* Actual Dot (all 48 settlement periods) */}
                            {yA != null && (
                              <circle
                                cx={x}
                                cy={yA}
                                r={isHovered ? 4.5 : 2.5}
                                fill="#17856b"
                                stroke="#fff"
                                strokeWidth="1"
                                className="chart-dot-actual"
                              />
                            )}

                            {/* Forecast Marker: only where forecast exists (hourly); unmatched half-hour intervals are visibly missing */}
                            {yF != null && (
                              <circle
                                cx={x}
                                cy={yF}
                                r={isHovered ? 5.5 : 3.5}
                                fill="#5275b8"
                                stroke="#fff"
                                strokeWidth="1.5"
                                className="chart-dot-forecast"
                              />
                            )}
                          </g>
                        )
                      })}

                      {/* Hover guideline */}
                      {hoveredPoint && (
                        <line
                          x1={hoveredPoint.x}
                          x2={hoveredPoint.x}
                          y1={chartMargin.top}
                          y2={chartMargin.top + plotH}
                          stroke="#8fa0a8"
                          strokeWidth="1"
                          strokeDasharray="2 2"
                          pointerEvents="none"
                        />
                      )}
                    </svg>

                    {/* Chart Hover Tooltip */}
                    {hoveredPoint && (
                      <div
                        className="chart-tooltip"
                        style={{
                          left: `${Math.min(chartWidth - 190, Math.max(50, hoveredPoint.x)) / 10}%`,
                          top: '15px',
                        }}
                      >
                        <div className="chart-tooltip-header">
                          <b>
                            Period {hoveredPoint.period} · {hoveredPoint.timeStr} UTC
                          </b>
                          {hoveredPoint.row && (
                            <button
                              type="button"
                              className="tooltip-inspect-link"
                              onClick={() => hoveredPoint.row && handleOpenModal(hoveredPoint.row)}
                            >
                              Inspect interval →
                            </button>
                          )}
                        </div>
                        <div className="chart-tooltip-row">
                          <span>Forecast:</span>
                          <b>{pretty(hoveredPoint.row?.forecastMW)} MW</b>
                          {hoveredPoint.row?.forecastMW == null && (
                            <small className="tooltip-gap-tag">No forecast published</small>
                          )}
                        </div>
                        <div className="chart-tooltip-row">
                          <span>Actual:</span>
                          <b>{pretty(hoveredPoint.row?.actualMW)} MW</b>
                        </div>
                        {hoveredPoint.row?.errorMW != null && (
                          <div className="chart-tooltip-row error-row">
                            <span>Error:</span>
                            <b className={hoveredPoint.row.errorMW > 0 ? 'negative' : 'positive'}>
                              {hoveredPoint.row.errorMW > 0 ? '+' : ''}
                              {pretty(hoveredPoint.row.errorMW)} MW
                            </b>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="x-labels" aria-hidden="true">
                      <span>00:00 UTC</span>
                      <span>06:00</span>
                      <span>12:00</span>
                      <span>18:00</span>
                      <span>23:30 UTC</span>
                    </div>
                  </div>

                  <div className="chart-foot">
                    <span>
                      Click any point or interval to view full vintage details · Points positioned at exact delivery time
                    </span>
                    <button
                      type="button"
                      onClick={() => dayRows[0] && handleOpenModal(dayRows[0])}
                      disabled={!dayRows.length}
                      aria-label="Inspect first settlement interval for selected day"
                    >
                      Inspect SP 01 <ExternalLink size={13} aria-hidden="true" />
                    </button>
                  </div>
                </section>

                {/* Heatmap Panel */}
                <section className="panel heat-panel" aria-label="Error Heatmap by Delivery Interval">
                  <div className="panel-head">
                    <div>
                      <h3>Error by delivery interval</h3>
                      <p>Absolute forecast error (|forecast − actual|) across January 2026</p>
                    </div>
                  </div>

                  {/* Heatmap Legend */}
                  <div className="heat-legend" aria-hidden="true">
                    <span className="legend-missing-badge">
                      <i className="cell-sample sample-missing" /> Missing / Unmatched
                    </span>
                    <span>Lower error</span>
                    <i className="cell-sample level-1" />
                    <i className="cell-sample level-2" />
                    <i className="cell-sample level-3" />
                    <i className="cell-sample level-4" />
                    <i className="cell-sample level-5" />
                    <span>Higher error</span>
                  </div>

                  <div className="heatmap" role="region" aria-label="January 2026 interval error grid">
                    <div className="heat-y" aria-hidden="true">
                      <span>00:00</span>
                      <span>06:00</span>
                      <span>12:00</span>
                      <span>18:00</span>
                      <span>23:30</span>
                    </div>

                    <div className="heat-columns">
                      {records.length > 0 &&
                        Array.from({ length: 31 }, (_, d) => {
                          const dateKey = `2026-01-${String(d + 1).padStart(2, '0')}`
                          const rows = records
                            .filter(r => r.settlementDate === dateKey)
                            .sort((a, b) => (a.settlementPeriod || 0) - (b.settlementPeriod || 0))
                          const isSelectedDay = selectedDay === dateKey
                          return (
                            <div className={`heat-col ${isSelectedDay ? 'selected-day-col' : ''}`} key={d}>
                              {Array.from({ length: 48 }, (_, p) => {
                                const r = rows[p]
                                const isMatched = r?.actualMW != null && r?.forecastMW != null
                                const err = r?.absoluteErrorMW
                                const level = !isMatched
                                  ? 'missing'
                                  : err == null
                                  ? 0
                                  : Math.min(5, Math.ceil(err / 1000))

                                const label = isMatched
                                  ? `${d + 1} Jan SP ${p + 1} (${formatUtcTime(r?.startTime)} UTC) · Forecast: ${pretty(
                                      r?.forecastMW
                                    )} MW, Actual: ${pretty(r?.actualMW)} MW, Error: ${
                                      r?.errorMW != null && r.errorMW > 0 ? '+' : ''
                                    }${pretty(r?.errorMW)} MW`
                                  : `${d + 1} Jan SP ${p + 1} (${formatUtcTime(
                                      r?.startTime
                                    )} UTC) · Actual: ${pretty(r?.actualMW)} MW, No forecast available`

                                return (
                                  <button
                                    key={p}
                                    type="button"
                                    aria-label={label}
                                    title={label}
                                    className={`heat-cell level-${level}`}
                                    onClick={() => r && handleOpenModal(r)}
                                  />
                                )
                              })}
                            </div>
                          )
                        })}
                    </div>
                  </div>

                  <div className="heat-x" aria-hidden="true">
                    <span>01 Jan</span>
                    <span>08 Jan</span>
                    <span>15 Jan</span>
                    <span>22 Jan</span>
                    <span>31 Jan</span>
                  </div>

                  <div className="heat-foot">
                    <span>
                      <span className="status-dot status-ready" aria-hidden="true" />
                      Click any cell to inspect interval vintage details
                    </span>
                    <button
                      type="button"
                      onClick={() => setTab('Accuracy analysis')}
                      aria-label="Navigate to Accuracy analysis view"
                    >
                      View monthly analysis <ArrowUpRight size={13} aria-hidden="true" />
                    </button>
                  </div>
                </section>
              </div>

              {/* Explorer Table Preview on Overview */}
              <div className="overview-explorer-cta">
                <div>
                  <h3>Ready to inspect individual settlement records?</h3>
                  <p>
                    Search, filter by coverage gaps or high errors, sort columns, and export data in Forecast explorer.
                  </p>
                </div>
                <button
                  type="button"
                  className="button-outline"
                  onClick={() => setTab('Forecast explorer')}
                  aria-label="Open Forecast explorer view"
                >
                  Open Forecast explorer <ArrowUpRight size={14} aria-hidden="true" />
                </button>
              </div>
            </>
          )}

          {/* VIEW: FORECAST EXPLORER */}
          {tab === 'Forecast explorer' && (
            <section className="panel table-panel" aria-label="Forecast Explorer Table">
              <div className="panel-head table-head">
                <div>
                  <h3>Forecast explorer</h3>
                  <p>
                    Interval-level Elexon forecasts, actuals, errors, and publication timestamps (all times in UTC)
                  </p>
                </div>

                <div className="table-actions">
                  <div className="search-box">
                    <Search size={14} aria-hidden="true" />
                    <input
                      type="text"
                      placeholder="Search intervals (e.g. 15 Jan, SP 12)…"
                      aria-label="Search intervals by date, settlement period, or time"
                      value={query}
                      onChange={e => {
                        setQuery(e.target.value)
                        setPage(0)
                      }}
                    />
                    {query && (
                      <button
                        type="button"
                        className="clear-search-btn"
                        onClick={() => {
                          setQuery('')
                          setPage(0)
                        }}
                        aria-label="Clear search input"
                      >
                        <X size={12} aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  <label className="filter-box" htmlFor="interval-status-filter">
                    <Filter size={14} aria-hidden="true" />
                    <select
                      id="interval-status-filter"
                      aria-label="Filter interval status"
                      value={filter}
                      onChange={e => {
                        setFilter(e.target.value as 'all' | 'matched' | 'gaps' | 'high')
                        setPage(0)
                      }}
                    >
                      <option value="all">All intervals ({records.length})</option>
                      <option value="matched">Matched intervals only ({metric?.intervalsMatched ?? 0})</option>
                      <option value="gaps">Coverage gaps / Missing ({metric?.missingForecastIntervals ?? 0})</option>
                      <option value="high">Large errors (|error| &gt; 2,000 MW)</option>
                    </select>
                    <ChevronDown size={12} aria-hidden="true" />
                  </label>

                  <label className="filter-box" htmlFor="page-size-select">
                    <span>Rows:</span>
                    <select
                      id="page-size-select"
                      aria-label="Select rows per page"
                      value={pageSize}
                      onChange={e => {
                        setPageSize(Number(e.target.value))
                        setPage(0)
                      }}
                    >
                      <option value="12">12 / page</option>
                      <option value="24">24 / page</option>
                      <option value="48">48 / page (1 full day)</option>
                    </select>
                    <ChevronDown size={12} aria-hidden="true" />
                  </label>
                </div>
              </div>

              {/* Table Data */}
              <div className="table-wrap">
                <table aria-label="Settlement intervals forecast and actual generation">
                  <thead>
                    <tr>
                      <th
                        className="sortable"
                        onClick={() => handleSort('startTime')}
                        aria-sort={
                          sortField === 'startTime' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'
                        }
                      >
                        <button type="button" className="th-button">
                          DELIVERY INTERVAL
                          {sortField === 'startTime' ? (
                            sortDirection === 'asc' ? (
                              <ArrowUp size={12} />
                            ) : (
                              <ArrowDown size={12} />
                            )
                          ) : (
                            <ArrowUpDown size={11} />
                          )}
                        </button>
                      </th>
                      <th
                        className="sortable numeric"
                        onClick={() => handleSort('forecastMW')}
                        aria-sort={
                          sortField === 'forecastMW' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'
                        }
                      >
                        <button type="button" className="th-button numeric">
                          FORECAST <small>MW</small>
                          {sortField === 'forecastMW' ? (
                            sortDirection === 'asc' ? (
                              <ArrowUp size={12} />
                            ) : (
                              <ArrowDown size={12} />
                            )
                          ) : (
                            <ArrowUpDown size={11} />
                          )}
                        </button>
                      </th>
                      <th
                        className="sortable numeric"
                        onClick={() => handleSort('actualMW')}
                        aria-sort={
                          sortField === 'actualMW' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'
                        }
                      >
                        <button type="button" className="th-button numeric">
                          ACTUAL <small>MW</small>
                          {sortField === 'actualMW' ? (
                            sortDirection === 'asc' ? (
                              <ArrowUp size={12} />
                            ) : (
                              <ArrowDown size={12} />
                            )
                          ) : (
                            <ArrowUpDown size={11} />
                          )}
                        </button>
                      </th>
                      <th
                        className="sortable numeric"
                        onClick={() => handleSort('errorMW')}
                        aria-sort={
                          sortField === 'errorMW' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'
                        }
                      >
                        <button type="button" className="th-button numeric">
                          ERROR <small>MW</small>
                          {sortField === 'errorMW' ? (
                            sortDirection === 'asc' ? (
                              <ArrowUp size={12} />
                            ) : (
                              <ArrowDown size={12} />
                            )
                          ) : (
                            <ArrowUpDown size={11} />
                          )}
                        </button>
                      </th>
                      <th
                        className="sortable"
                        onClick={() => handleSort('publishTime')}
                        aria-sort={
                          sortField === 'publishTime' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'
                        }
                      >
                        <button type="button" className="th-button">
                          FORECAST PUBLISHED (UTC)
                          {sortField === 'publishTime' ? (
                            sortDirection === 'asc' ? (
                              <ArrowUp size={12} />
                            ) : (
                              <ArrowDown size={12} />
                            )
                          ) : (
                            <ArrowUpDown size={11} />
                          )}
                        </button>
                      </th>
                      <th>STATUS</th>
                      <th>ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r, i) => (
                      <tr
                        key={r.startTime}
                        onClick={() => handleOpenModal(r)}
                        tabIndex={0}
                        role="button"
                        aria-label={`Inspect delivery interval ${r.settlementDate} Period ${r.settlementPeriod}`}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            handleOpenModal(r)
                          }
                        }}
                      >
                        <td>
                          <b>{formatUtcDate(r.startTime)}</b>
                          <span className="sub-cell">
                            SP {String(r.settlementPeriod || i + 1).padStart(2, '0')} · {formatUtcTime(r.startTime)} UTC
                          </span>
                        </td>
                        <td className="numeric">{pretty(r.forecastMW)}</td>
                        <td className="numeric">{pretty(r.actualMW)}</td>
                        <td
                          className={`numeric ${
                            r.errorMW != null && r.errorMW > 0
                              ? 'negative'
                              : r.errorMW != null && r.errorMW < 0
                              ? 'positive'
                              : ''
                          }`}
                        >
                          {r.errorMW == null ? '—' : `${r.errorMW > 0 ? '+' : ''}${pretty(r.errorMW)}`}
                        </td>
                        <td>
                          {formatUtcTime(r.publishTime)}{' '}
                          <span className="sub-cell">
                            {r.publishTime ? formatUtcDate(r.publishTime) : 'No forecast published'}
                          </span>
                        </td>
                        <td>
                          {r.actualMW != null && r.forecastMW != null ? (
                            <span className="table-status matched">
                              <Check size={11} aria-hidden="true" /> Matched
                            </span>
                          ) : (
                            <span className="table-status missing">
                              {r.forecastMW == null ? 'Missing forecast' : 'Missing actual'}
                            </span>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="row-inspect-btn"
                            onClick={e => {
                              e.stopPropagation()
                              handleOpenModal(r)
                            }}
                            aria-label={`Inspect details for ${r.settlementDate} SP ${r.settlementPeriod}`}
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!shown.length && !loading && (
                      <tr>
                        <td colSpan={7} className="empty-state">
                          No settlement intervals match your current search and filter criteria.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Table Footer with Accessible Pagination */}
              <div className="table-footer">
                <span>
                  Showing{' '}
                  <b>
                    {filtered.length ? safePage * pageSize + 1 : 0}–{Math.min((safePage + 1) * pageSize, filtered.length)}
                  </b>{' '}
                  of <b>{filtered.length.toLocaleString()}</b> intervals (Page {safePage + 1} of {totalPages})
                </span>

                <div className="pager">
                  <button
                    type="button"
                    disabled={safePage === 0}
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    aria-label="Previous page"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={(safePage + 1) * pageSize >= filtered.length}
                    onClick={() => setPage(p => p + 1)}
                    aria-label="Next page"
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* VIEW: ACCURACY ANALYSIS */}
          {tab === 'Accuracy analysis' && (
            <div className="analysis-page-wrapper">
              <section className="panel analysis-view" aria-label="Monthly Accuracy Profile">
                <div className="panel-head">
                  <div>
                    <h3>Monthly error profile</h3>
                    <p>Mean absolute forecast error (MAE) by delivery day · 01–31 January 2026</p>
                  </div>
                  <span className="analysis-total">{pretty(metric?.intervalsMatched)} matched intervals</span>
                </div>

                {/* 31 Interactive Daily Bars */}
                <div className="daily-bars" role="group" aria-label="Daily MAE chart across January 2026">
                  {dailyMaeData.map(d => {
                    const heightPct = d.mae != null ? Math.max(4, Math.min(100, (d.mae / maxDailyMae) * 100)) : 0
                    const titleStr = `${d.day} Jan 2026: MAE ${pretty(d.mae)} MW, Signed bias ${
                      d.bias != null && d.bias > 0 ? '+' : ''
                    }${pretty(d.bias)} MW (${d.count} matched intervals). Click to inspect generation curve.`

                    return (
                      <div className="daily-bar-wrap" key={d.day}>
                        <button
                          type="button"
                          className={`daily-bar-button ${selectedDay === d.dateStr ? 'selected-bar' : ''}`}
                          style={{ height: `${heightPct}%` }}
                          title={titleStr}
                          aria-label={titleStr}
                          onClick={() => {
                            setSelectedDay(d.dateStr)
                            setHeaderDateSelection(d.dateStr)
                            setTab('Overview')
                          }}
                        >
                          <span className="sr-only">{titleStr}</span>
                        </button>
                        <span aria-hidden="true">{d.day % 5 === 1 || d.day === 31 ? d.day : ''}</span>
                      </div>
                    )
                  })}
                </div>

                <div className="analysis-summary">
                  <span>
                    <i className="legend-line actual-line" aria-hidden="true" />
                    Click any day bar to inspect its hourly curve below
                  </span>
                  <b>Monthly MAE: {pretty(metric?.maeMW)} MW</b>
                  <span>RMSE: {pretty(metric?.rmseMW)} MW</span>
                  <span>Signed Bias: {pretty(metric?.signedBiasMW)} MW</span>
                  <span>MAPE: {pretty(metric?.mapePct, 1)}%</span>
                </div>
              </section>

              {/* Day-by-Day Performance Table */}
              <section className="panel table-panel" aria-label="Daily Performance Breakdown">
                <div className="panel-head">
                  <div>
                    <h3>Daily accuracy breakdown</h3>
                    <p>Summary metrics for each delivery day in January 2026</p>
                  </div>
                </div>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>DELIVERY DATE</th>
                        <th className="numeric">MATCHED INTERVALS</th>
                        <th className="numeric">DAILY MAE (MW)</th>
                        <th className="numeric">DAILY SIGNED BIAS (MW)</th>
                        <th>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyMaeData.map(d => (
                        <tr
                          key={d.day}
                          className={selectedDay === d.dateStr ? 'highlight-row' : ''}
                          tabIndex={0}
                          role="button"
                          aria-label={`View generation curve for ${d.day} January 2026`}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setSelectedDay(d.dateStr)
                              setHeaderDateSelection(d.dateStr)
                              setTab('Overview')
                            }
                          }}
                          onClick={() => {
                            setSelectedDay(d.dateStr)
                            setHeaderDateSelection(d.dateStr)
                            setTab('Overview')
                          }}
                        >
                          <td>
                            <b>{d.day} January 2026</b>
                            <span className="sub-cell">{d.dateStr}</span>
                          </td>
                          <td className="numeric">{d.count} / 48</td>
                          <td className="numeric">
                            <b>{pretty(d.mae)} MW</b>
                          </td>
                          <td
                            className={`numeric ${
                              d.bias != null && d.bias > 0
                                ? 'negative'
                                : d.bias != null && d.bias < 0
                                ? 'positive'
                                : ''
                            }`}
                          >
                            {d.bias == null ? '—' : `${d.bias > 0 ? '+' : ''}${pretty(d.bias)} MW`}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="button-outline button-small"
                              onClick={e => {
                                e.stopPropagation()
                                setSelectedDay(d.dateStr)
                                setHeaderDateSelection(d.dateStr)
                                setTab('Overview')
                              }}
                              aria-label={`View generation curve for ${d.day} January 2026`}
                            >
                              View day curve →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {/* VIEW: DATA QUALITY */}
          {tab === 'Data quality' && (
            <section className="panel quality-view" aria-label="Data Quality and Provenance">
              <div className="panel-head">
                <div>
                  <h3>Data quality & provenance</h3>
                  <p>Detailed verification of Elexon FUELHH actuals and WINDFOR forecast datasets</p>
                </div>
                <span className="quality-ok">
                  <span
                    className={`status-dot ${!data || error ? 'status-error' : 'status-ready'}`}
                    aria-hidden="true"
                  />
                  {!data || error ? 'Elexon unavailable' : 'Elexon verified archive'}
                </span>
              </div>

              {/* Quality Metrics Grid */}
              <div className="quality-grid">
                {[
                  ['Forecast source rows fetched', data?.quality.forecastSourceRows],
                  ['Wind actual source rows fetched', data?.quality.actualWindSourceRows],
                  ['Selected forecast intervals', data?.quality.selectedForecastIntervals],
                  ['Unique actual settlement intervals', data?.quality.uniqueActualIntervals],
                  ['Actual-only intervals (coverage gaps)', metric?.actualOnlyIntervals],
                  ['Settlement intervals missing forecast', metric?.missingForecastIntervals],
                  ['Duplicate actual revisions collapsed', data?.quality.duplicateActualRevisionsCollapsed],
                  ['Zero actual intervals excluded from MAPE', metric?.zeroActualIntervals],
                ].map(([label, value]) => (
                  <div className="quality-item" key={String(label)}>
                    <span>{String(label)}</span>
                    <b>{pretty(typeof value === 'number' ? value : null)}</b>
                  </div>
                ))}
              </div>

              {/* Transparent Limitation Explanations */}
              <div className="quality-limitation-box">
                <div className="limitation-head">
                  <Info size={16} aria-hidden="true" />
                  <h4>50% January Coverage Explained</h4>
                </div>
                <p>
                  Elexon’s FUELHH dataset provides half-hourly actual wind generation (48 settlement periods daily,
                  totaling 1,488 intervals in January 2026). In contrast, Elexon’s historical WINDFOR dataset published
                  hourly forecasts matching odd settlement periods (744 total intervals).
                </p>
                <p>
                  WindIQ strictly links forecasts and actuals on exact UTC settlement timestamps. To maintain complete
                  scientific and statistical integrity, unforecasted half-hourly intervals are left unpopulated and are
                  never interpolated or synthetically fabricated.
                </p>
              </div>

              <div className="quality-note">
                <ShieldCheck size={15} aria-hidden="true" />
                <span>
                  Records are sourced directly from Elexon BMRS Insights API datasets: <code>FUELHH</code> (fuelType=WIND)
                  and <code>WINDFOR</code>. Where revisions occur, WindIQ selects the latest publication revision prior to
                  the decision cutoff.
                </span>
              </div>

              <div className="quality-links">
                <a
                  href="https://developer.data.elexon.co.uk/"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open Elexon API developer documentation in a new tab"
                >
                  Elexon BMRS API Documentation <ExternalLink size={12} aria-hidden="true" />
                </a>
                <span>Datasets: FUELHH · WINDFOR · Timezone: UTC</span>
              </div>
            </section>
          )}

          {/* Footer */}
          <footer className="footer">
            <span>
              Source:{' '}
              <a
                href="https://bmrs.elexon.co.uk/"
                target="_blank"
                rel="noreferrer"
                aria-label="Open Elexon BMRS Portal in a new tab"
              >
                Elexon BMRS Insights <ExternalLink size={11} aria-hidden="true" />
              </a>{' '}
              · FUELHH &amp; WINDFOR Datasets
            </span>
            <span>All timestamps and delivery intervals displayed in UTC</span>
          </footer>
        </div>
      </main>

      {/* Interval Details Accessible Modal */}
      {selectedInterval && (
        <div
          className="modal-backdrop"
          onClick={() => setSelectedInterval(null)}
          role="presentation"
          onKeyDown={handleModalKeyDown}
        >
          <div
            ref={modalRef}
            className="detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-interval-heading"
            onClick={e => e.stopPropagation()}
            tabIndex={-1}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">SETTLEMENT INTERVAL DETAIL</span>
                <h2 id="modal-interval-heading">{formatFullUtcDate(selectedInterval.startTime)}</h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setSelectedInterval(null)}
                aria-label="Close interval details dialog"
                className="modal-close-btn"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="detail-time">
              <Clock3 size={15} aria-hidden="true" />
              <b>{formatUtcTime(selectedInterval.startTime)} UTC</b>
              <span aria-hidden="true">·</span>
              <span>Settlement Period {selectedInterval.settlementPeriod ?? '—'}</span>
              <span aria-hidden="true">·</span>
              <span
                className={`table-status ${
                  selectedInterval.actualMW != null && selectedInterval.forecastMW != null ? 'matched' : 'missing'
                }`}
              >
                {selectedInterval.actualMW != null && selectedInterval.forecastMW != null
                  ? 'Matched'
                  : 'Coverage Gap'}
              </span>
            </div>

            <div className="detail-values">
              <div>
                <small>DAY-AHEAD FORECAST</small>
                <b>
                  {pretty(selectedInterval.forecastMW)} <i>MW</i>
                </b>
                {selectedInterval.forecastMW == null && <span className="cell-note">No forecast published</span>}
              </div>
              <div>
                <small>ACTUAL GENERATION</small>
                <b>
                  {pretty(selectedInterval.actualMW)} <i>MW</i>
                </b>
              </div>
              <div>
                <small>FORECAST ERROR</small>
                <b
                  className={
                    selectedInterval.errorMW != null && selectedInterval.errorMW > 0
                      ? 'negative'
                      : selectedInterval.errorMW != null && selectedInterval.errorMW < 0
                      ? 'positive'
                      : ''
                  }
                >
                  {selectedInterval.errorMW == null
                    ? '—'
                    : `${selectedInterval.errorMW > 0 ? '+' : ''}${pretty(selectedInterval.errorMW)}`}{' '}
                  <i>MW</i>
                </b>
                {selectedInterval.errorMW != null && (
                  <span className="cell-note">
                    {selectedInterval.errorMW > 0
                      ? 'Forecast ran high (+)'
                      : selectedInterval.errorMW < 0
                      ? 'Forecast ran low (−)'
                      : 'Exact match'}
                  </span>
                )}
              </div>
            </div>

            <div className="detail-meta">
              <div>
                <span>WINDFOR forecast vintage published</span>
                <b>
                  {selectedInterval.publishTime
                    ? `${formatUtcDate(selectedInterval.publishTime)} · ${formatUtcTime(
                        selectedInterval.publishTime
                      )} UTC`
                    : 'No forecast vintage available before cutoff'}
                </b>
              </div>
              <div>
                <span>FUELHH actual record published</span>
                <b>
                  {selectedInterval.actualPublishTime
                    ? `${formatUtcDate(selectedInterval.actualPublishTime)} · ${formatUtcTime(
                        selectedInterval.actualPublishTime
                      )} UTC`
                    : 'Published at settlement'}
                </b>
              </div>
              <div>
                <span>Data provenance</span>
                <b>Elexon BMRS Insights API (Verified)</b>
              </div>
            </div>

            <div className="modal-note">
              <ShieldCheck size={15} aria-hidden="true" />
              <span>
                Vintage selected using latest forecast published on or before the configured decision cutoff.
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MetricCard({
  title,
  value,
  unit,
  note,
}: {
  title: string
  value: string
  unit: string
  note: string
}) {
  return (
    <div className="metric-card">
      <div className="metric-top">
        <span>{title}</span>
      </div>
      <div className="metric-value">
        {value}
        <small>{unit}</small>
      </div>
      <div className="metric-note">{note}</div>
    </div>
  )
}

export default App
