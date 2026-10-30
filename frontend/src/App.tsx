import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowUpRight, BarChart3, CalendarDays, Check, ChevronDown, Clock3, Download, ExternalLink, Filter, Gauge, LayoutDashboard, RefreshCw, Search, ShieldCheck, Wind, X } from 'lucide-react'

type RecordRow = { startTime: string; settlementDate: string; settlementPeriod: number | null; forecastMW: number | null; actualMW: number | null; publishTime: string | null; actualPublishTime: string | null; errorMW: number | null; absoluteErrorMW: number | null }
type Metrics = { intervalsExpected: number; intervalsForecasted: number; intervalsMatched: number; coveragePct: number; maeMW: number | null; rmseMW: number | null; mapePct: number | null; mapeEligibleIntervals: number; zeroActualIntervals: number; signedBiasMW: number | null; actualIntervalsAvailable: number; actualCoveragePct: number; forecastOnlyIntervals: number; actualOnlyIntervals: number; missingForecastIntervals: number }
type Payload = { month: string; timezone: string; cutoff: string; records: RecordRow[]; metrics: Metrics; quality: Record<string, unknown> }
const API = import.meta.env.VITE_API_URL || ''
const pretty = (v: number | null | undefined, d = 0) => v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d })
const time = (s: string | null) => s ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }).format(new Date(s)) : '—'
const dateFmt = (s: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(s))

function App() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cutoff, setCutoff] = useState('day-ahead')
  const [customCutoff, setCustomCutoff] = useState('2025-12-31T12:00')
  const [selectedDay, setSelectedDay] = useState('2026-01-15')
  const [tab, setTab] = useState('Overview')
  const [selected, setSelected] = useState<RecordRow | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    const value = cutoff === 'custom' ? `${customCutoff}:00Z` : cutoff
    fetch(`${API}/api/analysis?month=2026-01&cutoff=${encodeURIComponent(value)}`)
      .then(async r => { if (!r.ok) throw new Error((await r.json()).detail || `Request failed (${r.status})`); return r.json() })
      .then(x => { if (active) setData(x) }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [cutoff, customCutoff, retry])

  const records = data?.records || []
  const metric = data?.metrics
  const filtered = useMemo(() => records.filter(r => {
    const matchesSearch = !query || `${r.settlementDate} ${r.settlementPeriod} ${r.startTime}`.toLowerCase().includes(query.toLowerCase())
    const matchesFilter = filter === 'all' || (filter === 'matched' ? r.actualMW != null : filter === 'gaps' ? r.actualMW == null || r.forecastMW == null : (r.errorMW ?? 0) > 2000)
    return matchesSearch && matchesFilter
  }), [records, query, filter])
  const shown = filtered.slice(page * 12, (page + 1) * 12)
  const dayRows = records.filter(r => r.settlementDate === selectedDay)
  const daily = Array.from({ length: 31 }, (_, i) => records.filter(r => r.settlementDate === `2026-01-${String(i + 1).padStart(2, '0')}` && r.errorMW != null))
  const dailyMae = daily.map(rows => rows.length ? rows.reduce((s, r) => s + Math.abs(r.errorMW!), 0) / rows.length : 0)
  const curveData = dayRows.filter(r => r.forecastMW != null && r.actualMW != null).sort((a, b) => (a.settlementPeriod || 0) - (b.settlementPeriod || 0))
  const low = (curveData.length ? Math.min(...curveData.flatMap(r => [r.forecastMW, r.actualMW].filter((n): n is number => n != null))) : 0)
  const high = (curveData.length ? Math.max(...curveData.flatMap(r => [r.forecastMW, r.actualMW].filter((n): n is number => n != null))) : 1)
  const chartPath = (field: 'forecastMW' | 'actualMW') => curveData.map(r => `${24 + (((r.settlementPeriod || 1) - 1) / 47) * 1076},${172 - (((r[field] || 0) - low) / (high - low || 1)) * 138}`).join(' ')

  const download = () => {
    const headers = ['startTime','settlementDate','settlementPeriod','forecastMW','actualMW','publishTime','errorMW']
    const body = records.map(r => headers.map(k => JSON.stringify((r as unknown as Record<string, unknown>)[k] ?? '')).join(','))
    const blob = new Blob([[headers.join(','), ...body].join('\n')], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'windiq-january-2026.csv'; a.click(); URL.revokeObjectURL(url)
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Wind size={19} strokeWidth={2.2}/></div><span>WindIQ</span></div>
      <div className="side-caption">JANUARY 2026</div>
      <div className="workspace"><div className="workspace-dot"><Wind size={14}/></div><div><b>UK wind generation</b><small>Elexon BMRS data</small></div></div>
      <div className="side-caption nav-label">VIEWS</div>
      {['Overview', 'Forecast explorer', 'Accuracy analysis', 'Data quality'].map((item, i) => { const Icon = [LayoutDashboard, Search, BarChart3, ShieldCheck][i]; return <button key={item} onClick={() => setTab(item)} className={`nav-item ${tab === item ? 'active' : ''}`}><Icon size={16}/><span>{item}</span></button> })}
      <div className="side-bottom"><div className="connection"><span className={`live-dot ${error ? 'offline-dot' : ''}`}/><span>{loading ? 'Loading Elexon data' : error ? 'Elexon data unavailable' : data ? 'Elexon data loaded' : 'Waiting for data'}</span></div><div className="source-note">Forecasts and actuals come from separate Elexon datasets.</div></div>
    </aside>

    <main className="main">
      <header className="topbar"><div className="breadcrumb">WindIQ <span>/</span> <b>{tab}</b></div><div className="top-actions"><span className="source-badge">Elexon BMRS <span>·</span> {loading ? 'Loading' : error ? 'Unavailable' : data ? 'Historical data' : 'Waiting'}</span></div></header>
      <div className="content">
        <div className="page-head"><div><div className="eyebrow"><span>UK NATIONAL · WIND · JANUARY 2026</span></div><h1>Wind forecast review</h1><p>Compare the forecast available before the decision with the wind generation that followed.</p></div><div className="head-actions"><label className="select-wrap"><CalendarDays size={15}/><select aria-label="Date range" value="2026-01"><option value="2026-01">January 2026</option></select><ChevronDown size={14}/></label><button className="button-outline" onClick={download}><Download size={15}/> Download CSV</button><button className="button-refresh" onClick={() => setRetry(n => n + 1)}><RefreshCw size={15} className={loading ? 'spin' : ''}/> Reload data</button></div></div>

        {error && <div className="error-banner"><AlertTriangle size={18}/><div><b>Unable to load Elexon data</b><span>{error}</span></div><button onClick={() => setRetry(n => n + 1)}>Retry</button></div>}
        {loading && <div className="loading"><div className="loader"/>Fetching January records from Elexon BMRS Insights…</div>}

        <section className="decision-strip"><div className="decision-icon"><Clock3 size={17}/></div><div className="decision-copy"><b>Forecast cutoff</b><span>For each interval, use the latest forecast published by this time.</span></div><label className="cutoff-select"><select value={cutoff} onChange={e => setCutoff(e.target.value)}><option value="day-ahead">24 hours before delivery</option><option value="custom">Choose a cutoff</option></select><ChevronDown size={14}/></label>{cutoff === 'custom' && <input className="cutoff-input" type="datetime-local" aria-label="Cutoff in UTC" value={customCutoff} onChange={e => setCustomCutoff(e.target.value)}/>}<span className="timezone-note">Times in UTC</span></section>

        <div className="section-title"><div><h2>Forecast accuracy</h2><p>Calculated on intervals with both a forecast and an actual</p></div><span className="period-label">01–31 Jan 2026</span></div>
        <section className="metric-grid">
          <MetricCard title="Mean absolute error" value={pretty(metric?.maeMW, 0)} unit="MW" note="Average size of the miss"/>
          <MetricCard title="Root mean squared error" value={pretty(metric?.rmseMW, 0)} unit="MW" note="Gives larger misses more weight"/>
          <MetricCard title="Mean absolute percentage error" value={pretty(metric?.mapePct, 1)} unit="%" note={`${pretty(metric?.mapeEligibleIntervals)} intervals; zero actuals omitted`}/>
          <MetricCard title="Signed bias" value={pretty(metric?.signedBiasMW, 0)} unit="MW" note={metric?.signedBiasMW == null ? 'No matched intervals' : metric.signedBiasMW > 0 ? 'Forecasts were higher than actuals' : 'Forecasts were lower than actuals'}/>
        </section>

        <section className="coverage-row"><div className="coverage-label"><span className="coverage-icon"><Gauge size={17}/></span><div><b>Data coverage</b><small>January settlement intervals with forecast and actual</small></div></div><div className="coverage-stats"><div><b>{pretty(metric?.intervalsMatched)}<span> / {pretty(metric?.intervalsExpected)}</span></b><small>Matched intervals</small></div><div className="coverage-bar"><div style={{width:`${Math.min(100, metric?.coveragePct || 0)}%`}}/></div><div className="coverage-percent">{pretty(metric?.coveragePct, 1)}<small>%</small></div></div></section>

        {tab === 'Data quality' && <section className="panel quality-view"><div className="panel-head"><div><h3>Data quality</h3><p>How much source data was available and how intervals were matched.</p></div><span className="quality-ok"><span className={`live-dot ${!data || error ? 'offline-dot' : ''}`}/>{!data || error ? 'Source unavailable' : 'Source loaded'}</span></div><div className="quality-grid">{[['Forecast source rows',data?.quality.forecastSourceRows],['Wind actual source rows',data?.quality.actualWindSourceRows],['Selected forecast intervals',data?.quality.selectedForecastIntervals],['Unique actual intervals',data?.quality.uniqueActualIntervals],['Actual-only intervals',metric?.actualOnlyIntervals],['Intervals with no forecast',metric?.missingForecastIntervals],['Duplicate actual revisions collapsed',data?.quality.duplicateActualRevisionsCollapsed],['Zero actuals excluded from MAPE',metric?.zeroActualIntervals]].map(([label,value])=><div className="quality-item" key={String(label)}><span>{String(label)}</span><b>{pretty(typeof value==='number'?value:null)}</b></div>)}</div><div className="quality-note"><ShieldCheck size={15}/><span>Records come from Elexon BMRS Insights. WindIQ matches UTC <code>startTime</code> values and keeps the latest actual revision by <code>publishTime</code>.</span></div><div className="quality-links"><a href="https://developer.data.elexon.co.uk/" target="_blank" rel="noreferrer">Elexon API documentation <ExternalLink size={12}/></a><span>FUELHH · WINDFOR</span></div></section>}
        {tab === 'Accuracy analysis' && <section className="panel analysis-view"><div className="panel-head"><div><h3>Monthly error profile</h3><p>Mean absolute forecast error by delivery day · matched intervals only</p></div><span className="analysis-total">{pretty(metric?.intervalsMatched)} matched</span></div><div className="daily-bars">{dailyMae.map((v,i)=><div className="daily-bar-wrap" key={i} title={`${i+1} Jan · ${pretty(v)} MW`}><div className="daily-bar" style={{height:`${Math.max(2,Math.min(100,(v/(Math.max(...dailyMae)||1))*100))}%`}}/><span>{(i+1)%5===1||i===30?i+1:''}</span></div>)}</div><div className="analysis-summary"><span><i className="legend-line actual-line"/> Daily MAE (MW)</span><b>Monthly MAE {pretty(metric?.maeMW)} MW</b><span>Bias {pretty(metric?.signedBiasMW)} MW</span><span>MAPE {pretty(metric?.mapePct,1)}%</span></div></section>}

        <div className="dashboard-grid">
          <section className="panel trend-panel"><div className="panel-head"><div><h3>Forecast and actual</h3><p>{dateFmt(`${selectedDay}T00:00:00Z`)} · matched hourly intervals</p></div><label className="day-select"><span>Delivery day</span><select value={selectedDay} onChange={e=>setSelectedDay(e.target.value)}>{Array.from({length:31},(_,i)=>{const value=`2026-01-${String(i+1).padStart(2,'0')}`;return <option key={value} value={value}>{i+1} January</option>})}</select></label></div><div className="chart-legend"><span><i className="legend-line forecast-line"/>Forecast</span><span><i className="legend-line actual-line"/>Actual</span><span className="unit-label">MW</span></div><div className="trend-chart"><div className="y-labels"><span>{pretty(high)}</span><span>{pretty((high + low) / 2)}</span><span>{pretty(low)}</span></div><svg viewBox="0 0 1110 200" preserveAspectRatio="none" className="line-chart"><line x1="20" x2="1100" y1="24" y2="24" className="gridline"/><line x1="20" x2="1100" y1="96" y2="96" className="gridline"/><line x1="20" x2="1100" y1="170" y2="170" className="gridline"/>{curveData.length > 1 && <><polyline points={chartPath('forecastMW')} fill="none" stroke="#5275b8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/><polyline points={chartPath('actualMW')} fill="none" stroke="#17856b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></>}</svg>{curveData.length<2 && <div className="chart-empty">No matched hourly intervals for this day.</div>}<div className="x-labels"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div></div><div className="chart-foot"><span>MW · one point per matched hour</span><button onClick={() => setSelected(curveData[0] || null)} disabled={!curveData.length}>Inspect first interval <ExternalLink size={13}/></button></div></section>

          <section className="panel heat-panel"><div className="panel-head"><div><h3>Error by delivery interval</h3><p>Absolute error · MW</p></div><button className="more-button">•••</button></div><div className="heat-legend"><span>Lower</span><i/><i/><i/><i/><i/><span>Higher</span></div><div className="heatmap"><div className="heat-y">{['00','06','12','18','23'].map(x=><span key={x}>{x}</span>)}</div><div className="heat-columns">{records.length > 0 && Array.from({length:31},(_,d)=>{const rows=records.filter(r=>r.settlementDate===`2026-01-${String(d+1).padStart(2,'0')}`).sort((a,b)=>(a.settlementPeriod||0)-(b.settlementPeriod||0));return <div className="heat-col" key={d}>{Array.from({length:48},(_,p)=>{const r=rows[p]; const error=r?.absoluteErrorMW; const level=error==null?0:Math.min(5,Math.ceil(error/Math.max(1,(metric?.maeMW||1)*2)));return <button key={p} aria-label={`${d+1} Jan, interval ${p+1}, error ${pretty(error)} MW`} className={`heat-cell level-${level}`} onClick={()=>r&&setSelected(r)}/>})}</div>})}</div></div><div className="heat-x"><span>01</span><span>08</span><span>15</span><span>22</span><span>31 Jan</span></div><div className="heat-foot"><span><i className="live-dot"/>Click any cell to inspect the interval</span><button onClick={()=>setTab('Accuracy analysis')}>View analysis <ArrowUpRight size={13}/></button></div></section>
        </div>

        <section className="panel table-panel"><div className="panel-head table-head"><div><h3>Forecast explorer</h3><p>Interval-level forecasts, actuals and forecast vintage</p></div><div className="table-actions"><div className="search-box"><Search size={14}/><input placeholder="Search intervals…" value={query} onChange={e=>{setQuery(e.target.value);setPage(0)}}/></div><label className="filter-box"><Filter size={14}/><select value={filter} onChange={e=>{setFilter(e.target.value);setPage(0)}}><option value="all">All intervals</option><option value="matched">Matched</option><option value="gaps">Coverage gaps</option><option value="high">Large errors</option></select><ChevronDown size={12}/></label></div></div><div className="table-wrap"><table><thead><tr><th>DELIVERY INTERVAL <ChevronDown size={11}/></th><th>FORECAST <small>MW</small></th><th>ACTUAL <small>MW</small></th><th>ERROR <small>MW</small></th><th>FORECAST PUBLISHED <ChevronDown size={11}/></th><th>STATUS</th><th/></tr></thead><tbody>{shown.map((r,i)=><tr key={r.startTime} onClick={()=>setSelected(r)}><td><b>{dateFmt(r.startTime)}</b><span className="sub-cell">SP {String(r.settlementPeriod || i+1).padStart(2,'0')} · {time(r.startTime)} UTC</span></td><td className="numeric">{pretty(r.forecastMW)}</td><td className="numeric">{pretty(r.actualMW)}</td><td className={`numeric ${r.errorMW != null && r.errorMW > 0 ? 'negative' : 'positive'}`}>{r.errorMW == null ? '—' : `${r.errorMW > 0 ? '+' : ''}${pretty(r.errorMW)}`}</td><td>{time(r.publishTime)} <span className="sub-cell">{r.publishTime ? dateFmt(r.publishTime) : '—'}</span></td><td>{r.actualMW != null && r.forecastMW != null ? <span className="table-status matched"><Check size={11}/> Matched</span> : <span className="table-status missing">Missing data</span>}</td><td><ChevronDown size={14} className="row-chevron"/></td></tr>)}{!shown.length&&!loading&&<tr><td colSpan={7} className="empty-state">No intervals match this view.</td></tr>}</tbody></table></div><div className="table-footer"><span>Showing <b>{filtered.length ? page*12+1 : 0}–{Math.min((page+1)*12,filtered.length)}</b> of <b>{filtered.length.toLocaleString()}</b> intervals</span><div className="pager"><button disabled={page===0} onClick={()=>setPage(p=>p-1)}>Previous</button><button disabled={(page+1)*12>=filtered.length} onClick={()=>setPage(p=>p+1)}>Next</button></div></div></section>

        <footer className="footer"><span>Source: <a href="https://bmrs.elexon.co.uk/" target="_blank" rel="noreferrer">Elexon BMRS Insights <ExternalLink size={11}/></a> · FUELHH & WINDFOR</span><span>Times shown in UTC</span></footer>
      </div>
    </main>

    {selected && <div className="modal-backdrop" onClick={()=>setSelected(null)}><div className="detail-modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">DELIVERY INTERVAL</span><h2>{new Intl.DateTimeFormat('en-GB',{dateStyle:'full',timeZone:'UTC'}).format(new Date(selected.startTime))}</h2></div><button onClick={()=>setSelected(null)}><X size={18}/></button></div><div className="detail-time"><Clock3 size={15}/>{time(selected.startTime)} UTC <span>·</span> Settlement period {selected.settlementPeriod || '—'}</div><div className="detail-values"><div><small>FORECAST</small><b>{pretty(selected.forecastMW)} <i>MW</i></b></div><div><small>ACTUAL</small><b>{pretty(selected.actualMW)} <i>MW</i></b></div><div><small>ERROR</small><b className={selected.errorMW!=null&&selected.errorMW>0?'negative':''}>{selected.errorMW==null?'—':`${selected.errorMW>0?'+':''}${pretty(selected.errorMW)}`} <i>MW</i></b></div></div><div className="detail-meta"><div><span>Forecast vintage published</span><b>{selected.publishTime ? `${dateFmt(selected.publishTime)} · ${time(selected.publishTime)} UTC` : 'No forecast'}</b></div><div><span>Actual record published</span><b>{selected.actualPublishTime ? `${dateFmt(selected.actualPublishTime)} · ${time(selected.actualPublishTime)} UTC` : 'No actual record'}</b></div><div><span>Data source</span><b>Elexon BMRS Insights</b></div></div><div className="modal-note"><ShieldCheck size={15}/> Vintage selected at or before the configured decision cutoff.</div></div></div>}
  </div>
}

function MetricCard({ title, value, unit, note }: { title:string; value:string; unit:string; note:string }) {
  return <div className="metric-card"><div className="metric-top"><span>{title}</span></div><div className="metric-value">{value}<small>{unit}</small></div><div className="metric-note">{note}</div></div>
}

export default App
