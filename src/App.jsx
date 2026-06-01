import { Suspense, lazy, startTransition, useEffect, useRef, useState } from 'react'
import './App.css'
import {
  FORECAST_PROVIDER,
  TRIP_DAYS,
  TRIP_LOCATIONS,
  TRIP_NAME,
} from './data/itinerary.js'
import { ActivityIcon, WeatherIcon } from './lib/icons.jsx'
import {
  fetchLocationForecast,
  getDailyForecast,
  getExtendedRangeHorizon,
  getHourlyHighlights,
  getShortRangeHorizon,
  getWeatherLabel,
} from './lib/weather.js'

const AUTO_REFRESH_MS = 60 * 60 * 1000
const RouteMap = lazy(() => import('./components/RouteMap.jsx'))
const DEFAULT_EXPANDED_DATES = TRIP_DAYS.map((day) => day.date)

function parseIsoDate(dateString) {
  const [year, month, day] = dateString.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatDayLabel(dateString) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
  }).format(parseIsoDate(dateString))
}

function formatDateOnly(dateString) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
  }).format(parseIsoDate(dateString))
}

function formatCompactDate(dateString) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(parseIsoDate(dateString))
}

function formatDateTime(timestamp) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp)
}

function shiftIsoDate(dateString, amount) {
  const shiftedDate = parseIsoDate(dateString)
  shiftedDate.setDate(shiftedDate.getDate() + amount)

  const year = shiftedDate.getFullYear()
  const month = String(shiftedDate.getMonth() + 1).padStart(2, '0')
  const day = String(shiftedDate.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function formatTemperature(value) {
  return `${Math.round(value)}F`
}

function formatWind(value) {
  return `${Math.round(value)} mph`
}

function formatRain(value) {
  return `${value.toFixed(1)} mm`
}

function formatRainChance(value) {
  return value == null ? 'Not modeled' : `${value}%`
}

function getDayAnchor(dateString) {
  return `day-${dateString}`
}

function getInitialViewMode() {
  if (typeof window === 'undefined') {
    return 'condensed'
  }

  const params = new URLSearchParams(window.location.search)
  return params.get('view') === 'expanded' ? 'expanded' : 'condensed'
}

function getInitialActiveDay() {
  if (typeof window === 'undefined') {
    return TRIP_DAYS[0].date
  }

  const hash = window.location.hash.replace('#', '')
  const hashDate = hash.startsWith('day-') ? hash.slice(4) : ''

  return TRIP_DAYS.some((day) => day.date === hashDate)
    ? hashDate
    : TRIP_DAYS[0].date
}

function getInitialExpandedDates(initialViewMode) {
  if (typeof window === 'undefined') {
    return initialViewMode === 'expanded'
      ? DEFAULT_EXPANDED_DATES
      : []
  }

  const params = new URLSearchParams(window.location.search)
  const openDates = (params.get('open') ?? '')
    .split(',')
    .filter((date) => TRIP_DAYS.some((day) => day.date === date))

  if (openDates.length > 0) {
    return openDates
  }

  return initialViewMode === 'expanded'
    ? DEFAULT_EXPANDED_DATES
    : []
}

function uniqueDates(dates) {
  return Array.from(new Set(dates))
}

function buildRouteDays(forecastsByLocation) {
  return TRIP_DAYS.map((day) => {
    const primaryStop = day.stops[0]
    const forecast = getDailyForecast(
      forecastsByLocation[primaryStop.locationId],
      day.date,
    )

    return {
      ...day,
      anchor: getDayAnchor(day.date),
      primaryStop,
      forecast,
      isExtended: forecast?.source === 'extended-range',
    }
  })
}

function SummaryPill({ label, value }) {
  return (
    <article className="summary-pill">
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  )
}

function ViewToggle({ viewMode, onChange }) {
  return (
    <div className="view-toggle" role="tablist" aria-label="Forecast layout">
      <button
        type="button"
        className={`view-button ${viewMode === 'expanded' ? 'is-active' : ''}`}
        onClick={() => onChange('expanded')}
      >
        Expanded
      </button>
      <button
        type="button"
        className={`view-button ${viewMode === 'condensed' ? 'is-active' : ''}`}
        onClick={() => onChange('condensed')}
      >
        Condensed
      </button>
    </div>
  )
}

function JumpRail({ routeDays, activeDay, onSelectDay }) {
  return (
    <nav className="jump-rail-wrap" aria-label="Jump to day">
      <div className="jump-rail">
        {routeDays.map((day) => (
          <a
            key={day.date}
            className={`jump-link ${day.isExtended ? 'is-extended' : ''} ${
              activeDay === day.date ? 'is-active' : ''
            }`}
            href={`#${day.anchor}`}
            onClick={(event) => {
              event.preventDefault()
              onSelectDay(day.date)
            }}
          >
            <span>{formatCompactDate(day.date)}</span>
            {day.isExtended ? <strong>*</strong> : null}
          </a>
        ))}
      </div>
    </nav>
  )
}

function RouteOverview({ routeDays, activeDay, onSelectDay }) {
  const activeRouteDay =
    routeDays.find((day) => day.date === activeDay) ?? routeDays[0]

  return (
    <section className="overview-grid">
      <article className="overview-card route-card">
        <div className="overview-head">
          <div>
            <p className="eyebrow">Route timeline</p>
            <h2>Trip flow</h2>
          </div>
          <p className="overview-note">Tap any stop to jump to that day.</p>
        </div>

        <div className="route-strip" role="list">
          {routeDays.map((day, index) => (
            <a
              key={day.date}
              href={`#${day.anchor}`}
              className={`route-stop ${day.isExtended ? 'is-extended' : ''} ${
                activeDay === day.date ? 'is-active' : ''
              }`}
              role="listitem"
              onClick={(event) => {
                event.preventDefault()
                onSelectDay(day.date)
              }}
            >
              <span className="route-step">{index + 1}</span>
              <div className="route-stop-body">
                <p className="route-date">
                  {formatCompactDate(day.date)}
                  {day.isExtended ? '*' : ''}
                </p>
                <strong>{day.primaryStop.name}</strong>
                <span className="route-meta">
                  <ActivityIcon
                    activity={day.primaryStop.activity}
                    className="route-icon"
                  />
                  {day.stops.length > 1
                    ? `${day.stops.length} stops`
                    : day.primaryStop.activityLabel}
                </span>
                {day.forecast ? (
                  <span className="route-weather">
                    <WeatherIcon
                      tone={day.forecast.tone}
                      className="route-weather-icon"
                    />
                    {formatTemperature(day.forecast.high)}
                  </span>
                ) : (
                  <span className="route-weather pending">Pending</span>
                )}
              </div>
            </a>
          ))}
        </div>

        {activeRouteDay ? (
          <div className="route-spotlight">
            <div className="route-spotlight-main">
              <p className="eyebrow">Selected day</p>
              <div className="route-spotlight-heading">
                <h3>
                  {formatDayLabel(activeRouteDay.date)}
                  {activeRouteDay.isExtended ? <span className="day-asterisk">*</span> : null}
                </h3>
                <p>{activeRouteDay.stops.map((stop) => stop.name).join(' · ')}</p>
              </div>
            </div>

            <div className="route-spotlight-metrics">
              <div className="route-spotlight-stat">
                <span>Plan</span>
                <strong>
                  {activeRouteDay.stops.length > 1
                    ? `${activeRouteDay.stops.length} stops`
                    : activeRouteDay.primaryStop.activityLabel}
                </strong>
              </div>

              <div className="route-spotlight-stat">
                <span>Forecast</span>
                <strong>
                  {activeRouteDay.forecast
                    ? `${getWeatherLabel(activeRouteDay.forecast.weatherCode)} · ${formatTemperature(activeRouteDay.forecast.high)} / ${formatTemperature(activeRouteDay.forecast.low)}`
                    : 'Pending'}
                </strong>
              </div>

              <div className="route-spotlight-stat">
                <span>Source</span>
                <strong>
                  {activeRouteDay.forecast
                    ? activeRouteDay.forecast.sourceLabel
                    : 'Awaiting feed'}
                </strong>
              </div>
            </div>

            <div className="route-spotlight-stops">
              {activeRouteDay.stops.map((stop) => (
                <div key={stop.id} className="route-spotlight-stop">
                  <span className="route-spotlight-stop-icon">
                    <ActivityIcon activity={stop.activity} className="route-icon" />
                  </span>
                  <div>
                    <strong>{stop.name}</strong>
                    <p>{stop.note}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </article>

      <article className="overview-card map-card">
        <div className="overview-head">
          <div>
            <p className="eyebrow">Mini map</p>
            <h2>Live route map</h2>
          </div>
          <p className="overview-note">Interactive map with real tiles and route markers.</p>
        </div>

        <Suspense fallback={<div className="route-map-fallback">Loading interactive map...</div>}>
          <RouteMap
            routeDays={routeDays}
            activeDay={activeDay}
            onSelectDay={onSelectDay}
          />
        </Suspense>

        <div className="map-legend">
          <span>
            <span className="legend-dot live"></span>
            In live window
          </span>
          <span>
            <span className="legend-dot extended"></span>
            Long-range only
          </span>
        </div>
      </article>
    </section>
  )
}

function DayGlance({ day }) {
  return (
    <div className="day-glance">
      <div className="day-glance-main">
        <div className={`day-glance-weather ${day.forecast?.tone ?? 'pending'}`}>
          {day.forecast ? (
            <WeatherIcon tone={day.forecast.tone} className="day-glance-weather-icon" />
          ) : (
            <span className="day-glance-pending-mark">?</span>
          )}
        </div>
        <div className="day-glance-copy">
          <p className="day-glance-condition">
            {day.forecast
              ? getWeatherLabel(day.forecast.weatherCode)
              : 'Forecast pending'}
          </p>
          <p className="day-glance-stops">
            {day.stops.map((stop) => stop.name).join(' · ')}
          </p>
        </div>
      </div>

      <div className="day-glance-side">
        <div className="day-glance-activities">
          {day.stops.map((stop) => (
            <span key={stop.id} className="day-glance-chip" title={stop.activityLabel}>
              <ActivityIcon activity={stop.activity} className="day-glance-activity-icon" />
              <span>{stop.name}</span>
            </span>
          ))}
        </div>

        <div className="day-glance-actions">
          <p className="day-glance-temp">
            {day.forecast
              ? `${formatTemperature(day.forecast.high)} / ${formatTemperature(day.forecast.low)}`
              : 'Waiting for feed'}
          </p>
        </div>
      </div>
    </div>
  )
}

function StopCard({ stop, forecast, shortRangeThrough, extendedRangeThrough }) {
  const dailyForecast = getDailyForecast(forecast, stop.date)
  const hourlyHighlights =
    dailyForecast?.source === 'short-range'
      ? getHourlyHighlights(forecast, stop.date)
      : []
  const forecastWindowDays =
    forecast?.shortRange?.daily?.time?.length ?? FORECAST_PROVIDER.shortRangeDays
  const forecastUnlockDate = formatDateOnly(
    shiftIsoDate(stop.date, -(forecastWindowDays - 1)),
  )

  return (
    <article
      className={`stop-card ${
        dailyForecast
          ? dailyForecast.source === 'extended-range'
            ? 'is-extended'
            : 'is-live'
          : 'is-pending'
      }`}
    >
      <div className="stop-header">
        <div className="stop-heading">
          <div className="stop-title-row">
            <span className="activity-chip">
              <ActivityIcon activity={stop.activity} className="activity-icon" />
              {stop.activityLabel}
            </span>
            <span className={`stop-chip ${stop.kind}`}>
              {stop.kind === 'sea' ? 'At sea' : 'On land'}
            </span>
          </div>
          <h3>{stop.name}</h3>
          <p className="stop-subtitle">
            {stop.region}, {stop.country}
          </p>
        </div>
        <div className="stop-side">
          <p className="stop-note">{stop.note}</p>
          {dailyForecast ? (
            <span
              className={`forecast-chip ${
                dailyForecast.source === 'extended-range' ? 'extended' : 'short'
              }`}
            >
              {dailyForecast.sourceLabel}
            </span>
          ) : null}
        </div>
      </div>

      {dailyForecast ? (
        <>
          <div className="forecast-summary">
            <div className="forecast-summary-left">
              <div className={`weather-medallion ${dailyForecast.tone}`}>
                <WeatherIcon tone={dailyForecast.tone} className="weather-icon" />
              </div>
              <div>
                <p className="eyebrow">
                  {dailyForecast.source === 'extended-range'
                    ? 'Extended outlook'
                    : 'Daily outlook'}
                </p>
                <p className="summary-text">
                  {getWeatherLabel(dailyForecast.weatherCode)}
                </p>
              </div>
            </div>

            <div className="summary-temps">
              <p className="summary-temp">{formatTemperature(dailyForecast.high)}</p>
              <p className="summary-low">{formatTemperature(dailyForecast.low)}</p>
            </div>
          </div>

          <div className="metric-grid">
            <article className="metric-card">
              <p>Rain chance</p>
              <strong>{formatRainChance(dailyForecast.precipitationProbability)}</strong>
            </article>
            <article className="metric-card">
              <p>Rain total</p>
              <strong>{formatRain(dailyForecast.precipitationTotal)}</strong>
            </article>
            <article className="metric-card">
              <p>Top wind</p>
              <strong>{formatWind(dailyForecast.windSpeed)}</strong>
            </article>
          </div>

          {hourlyHighlights.length > 0 ? (
            <div className="hourly-panel">
              <div className="section-heading">
                <p className="eyebrow">Local checkpoints</p>
                <p className="section-note">Hourly detail is available from the live forecast feed.</p>
              </div>
              <div className="hourly-strip">
                {hourlyHighlights.map((hour) => (
                  <div key={hour.time} className="hour-chip">
                    <div className="hour-chip-main">
                      <div className={`mini-weather ${hour.tone}`}>
                        <WeatherIcon tone={hour.tone} className="mini-weather-icon" />
                      </div>
                      <div className="hour-chip-copy">
                        <p>{hour.label}</p>
                        <span>{getWeatherLabel(hour.weatherCode)}</span>
                      </div>
                    </div>
                    <strong>{formatTemperature(hour.temperature)}</strong>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="range-note">
              <p className="eyebrow">Hourly detail</p>
              <p className="pending-copy">
                Hourly checkpoints will appear automatically once this date enters the
                16-day forecast window.
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="pending-panel">
          <p className="eyebrow">Forecast pending</p>
          <p className="pending-copy">
            The 16-day forecast currently reaches through {shortRangeThrough}. The
            extended range currently reaches through {extendedRangeThrough}. If this
            stop still has no forecast, it should appear around {forecastUnlockDate}.
          </p>
        </div>
      )}
    </article>
  )
}

function App() {
  const initialViewMode = getInitialViewMode()
  const initialActiveDay = getInitialActiveDay()
  const [forecastsByLocation, setForecastsByLocation] = useState({})
  const [fetchState, setFetchState] = useState('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [warningMessage, setWarningMessage] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [viewMode, setViewMode] = useState(initialViewMode)
  const [activeDay, setActiveDay] = useState(initialActiveDay)
  const [expandedDates, setExpandedDates] = useState(() =>
    getInitialExpandedDates(initialViewMode),
  )
  const hasLoadedOnceRef = useRef(false)

  useEffect(() => {
    let ignore = false
    const controller = new AbortController()

    const loadForecasts = async () => {
      setFetchState(hasLoadedOnceRef.current ? 'refreshing' : 'loading')
      setErrorMessage('')

      const settled = await Promise.allSettled(
        TRIP_LOCATIONS.map(async (location) => {
          const forecast = await fetchLocationForecast(location, controller.signal)
          return [location.locationId, forecast]
        }),
      )

      if (ignore) {
        return
      }

      const successfulForecasts = settled.filter(
        (result) => result.status === 'fulfilled',
      )

      if (successfulForecasts.length === 0) {
        const firstFailure = settled.find((result) => result.status === 'rejected')
        if (firstFailure?.reason?.name === 'AbortError') {
          return
        }

        setFetchState('error')
        setErrorMessage(
          'Unable to load the forecast feed right now. Try refreshing again in a moment.',
        )
        return
      }

      const nextForecasts = Object.fromEntries(
        successfulForecasts.map((result) => result.value),
      )
      const failureCount = settled.length - successfulForecasts.length

      startTransition(() => {
        setForecastsByLocation(nextForecasts)
        setFetchState('ready')
        setWarningMessage(
          failureCount > 0
            ? `${failureCount} location forecast${failureCount === 1 ? '' : 's'} failed to refresh.`
            : '',
        )
        setLastUpdated(new Date())
      })
      hasLoadedOnceRef.current = true
    }

    loadForecasts().catch((error) => {
      if (ignore || error.name === 'AbortError') {
        return
      }

      setFetchState('error')
      setErrorMessage(
        'Unable to load the forecast feed right now. Try refreshing again in a moment.',
      )
    })

    const intervalId = window.setInterval(loadForecasts, AUTO_REFRESH_MS)

    return () => {
      ignore = true
      controller.abort()
      window.clearInterval(intervalId)
    }
  }, [refreshNonce])

  const shortRangeThrough =
    Object.values(forecastsByLocation)
      .map((forecast) => getShortRangeHorizon(forecast))
      .filter(Boolean)
      .sort()
      .at(0) ?? null

  const extendedRangeThrough =
    Object.values(forecastsByLocation)
      .map((forecast) => getExtendedRangeHorizon(forecast))
      .filter(Boolean)
      .sort()
      .at(0) ?? null

  const routeDays = buildRouteDays(forecastsByLocation)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)

        if (visibleEntries[0]?.target?.dataset?.date) {
          setActiveDay(visibleEntries[0].target.dataset.date)
        }
      },
      {
        rootMargin: '-22% 0px -60% 0px',
        threshold: [0.15, 0.45, 0.7],
      },
    )

    routeDays.forEach((day) => {
      const section = document.getElementById(day.anchor)
      if (section) {
        observer.observe(section)
      }
    })

    return () => {
      observer.disconnect()
    }
  }, [routeDays, viewMode, expandedDates])

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '')
      const hashDate = hash.startsWith('day-') ? hash.slice(4) : ''

      if (routeDays.some((day) => day.date === hashDate)) {
        setActiveDay(hashDate)
      }
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => {
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [routeDays])

  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('view', viewMode)

    if (viewMode === 'condensed' && expandedDates.length > 0) {
      url.searchParams.set('open', uniqueDates(expandedDates).join(','))
    } else {
      url.searchParams.delete('open')
    }

    url.hash = activeDay ? `#${getDayAnchor(activeDay)}` : ''
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }, [viewMode, expandedDates, activeDay])

  function scrollToDay(date) {
    const section = document.getElementById(getDayAnchor(date))
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  function handleSelectDay(date) {
    setActiveDay(date)
    scrollToDay(date)
  }

  function handleToggleDay(date) {
    setExpandedDates((previous) => {
      if (previous.includes(date)) {
        return previous.filter((item) => item !== date)
      }

      if (viewMode === 'condensed') {
        return [date]
      }

      return [...previous, date]
    })
  }

  function handleViewChange(nextViewMode) {
    setViewMode(nextViewMode)

    if (nextViewMode === 'expanded') {
      setExpandedDates(routeDays.map((day) => day.date))
      return
    }

    setExpandedDates([])
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-orbit hero-orbit-a"></div>
        <div className="hero-orbit hero-orbit-b"></div>

        <div className="hero-topline">
          <div className="hero-copy">
            <p className="eyebrow hero-eyebrow">Trip weather dashboard</p>
            <h1>{TRIP_NAME}</h1>
          </div>

          <div className="hero-actions">
            <ViewToggle viewMode={viewMode} onChange={handleViewChange} />
            <button
              type="button"
              className="refresh-button"
              onClick={() => setRefreshNonce((value) => value + 1)}
              disabled={fetchState === 'loading' || fetchState === 'refreshing'}
            >
              Refresh now
            </button>
          </div>
        </div>

        <div className="hero-summary">
          <SummaryPill
            label="Trip span"
            value={`${formatDateOnly(TRIP_DAYS[0].date)} to ${formatDateOnly(TRIP_DAYS.at(-1).date)}`}
          />
          <SummaryPill
            label="Live through"
            value={shortRangeThrough ? formatDateOnly(shortRangeThrough) : 'Loading'}
          />
          <SummaryPill
            label="Long-range days"
            value={`${extendedDayCount} marked *`}
          />
        </div>

        <div className="status-bar">
          <div>
            <p className="status-copy">
              {fetchState === 'loading' && 'Loading forecasts...'}
              {fetchState === 'refreshing' && 'Refreshing the latest forecast window...'}
              {fetchState === 'ready' &&
                (lastUpdated
                  ? `Updated ${formatDateTime(lastUpdated)}`
                  : 'Forecasts are ready.')}
              {fetchState === 'error' && 'Weather data is temporarily unavailable.'}
            </p>
            <p className="status-note">
              `*` marks dates that are still outside the live {FORECAST_PROVIDER.shortRangeDays}
              -day window.
            </p>
          </div>
        </div>

        {errorMessage ? <p className="message error">{errorMessage}</p> : null}
        {warningMessage ? <p className="message warning">{warningMessage}</p> : null}
      </section>

      <JumpRail routeDays={routeDays} activeDay={activeDay} onSelectDay={handleSelectDay} />
      <RouteOverview
        routeDays={routeDays}
        activeDay={activeDay}
        onSelectDay={handleSelectDay}
      />

      <section className={`timeline ${viewMode === 'condensed' ? 'is-condensed' : ''}`}>
        {routeDays.map((day) => {
          const isExpanded =
            viewMode === 'expanded' || expandedDates.includes(day.date)

          return (
            <section
              key={day.date}
              id={day.anchor}
              data-date={day.date}
              className={`day-block ${day.isExtended ? 'is-extended-day' : ''} ${
                !isExpanded ? 'is-collapsed' : ''
              }`}
            >
              <div className="day-header">
                <div>
                  <p className="eyebrow">
                  {day.stops.length === 1 ? 'Single stop' : 'Multi-stop day'}
                </p>
                  <h2>
                    {formatDayLabel(day.date)}
                  {day.isExtended ? <span className="day-asterisk">*</span> : null}
                  </h2>
                </div>
                <div className="day-header-side">
                  <p className="day-count">
                    {day.stops.length} location{day.stops.length === 1 ? '' : 's'}
                  </p>
                  {viewMode === 'condensed' ? (
                    <button
                      type="button"
                      className="day-toggle"
                      onClick={() => handleToggleDay(day.date)}
                    >
                      {isExpanded ? 'Hide details' : 'Show details'}
                    </button>
                  ) : null}
                </div>
            </div>

              {viewMode === 'condensed' ? <DayGlance day={day} /> : null}

              {isExpanded ? (
                <div className="stop-grid">
                  {day.stops.map((stop) => (
                    <StopCard
                      key={stop.id}
                      stop={stop}
                      forecast={forecastsByLocation[stop.locationId]}
                      shortRangeThrough={
                        shortRangeThrough
                          ? formatDateOnly(shortRangeThrough)
                          : 'the current live forecast horizon'
                      }
                      extendedRangeThrough={
                        extendedRangeThrough
                          ? formatDateOnly(extendedRangeThrough)
                          : 'the current extended forecast horizon'
                      }
                    />
                  ))}
                </div>
              ) : null}
            </section>
          )
        })}
      </section>
    </main>
  )
}

export default App
