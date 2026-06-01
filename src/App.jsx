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
const FORECAST_REQUEST_CONCURRENCY = 4
const RouteMap = lazy(() => import('./components/RouteMap.jsx'))
const DEFAULT_EXPANDED_DATES = TRIP_DAYS.map((day) => day.date)
const TOTAL_LOCATIONS = TRIP_LOCATIONS.length
const WEATHER_SPLIT_LABELS = {
  sun: 'sunny',
  cloud: 'cloudy',
  fog: 'foggy',
  rain: 'rainy',
  snow: 'snowy',
  storm: 'stormy',
  mixed: 'mixed',
}
const WEATHER_SPLIT_ORDER = ['sun', 'cloud', 'fog', 'rain', 'snow', 'storm', 'mixed']

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

function formatTemperature(value, unit = 'F') {
  if (unit === 'C') {
    return `${Math.round((value - 32) * 5 / 9)}°C`
  }
  return `${Math.round(value)}°F`
}

function formatWind(value, unit = 'F') {
  if (unit === 'C') {
    return `${Math.round(value * 1.60934)} km/h`
  }
  return `${Math.round(value)} mph`
}

function getUVCategory(uvIndex) {
  if (uvIndex == null) return null
  if (uvIndex < 3) return { label: 'Low', level: 'low' }
  if (uvIndex < 6) return { label: 'Moderate', level: 'moderate' }
  if (uvIndex < 8) return { label: 'High', level: 'high' }
  if (uvIndex < 11) return { label: 'Very High', level: 'very-high' }
  return { label: 'Extreme', level: 'extreme' }
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

function formatWeatherSplit(forecastedDays) {
  if (forecastedDays.length === 0) {
    return 'Loading'
  }

  const counts = forecastedDays.reduce((weatherCounts, day) => {
    const tone = day.forecast.tone
    weatherCounts[tone] = (weatherCounts[tone] ?? 0) + 1
    return weatherCounts
  }, {})

  return WEATHER_SPLIT_ORDER
    .filter((tone) => counts[tone] > 0)
    .map((tone) => `${counts[tone]} ${WEATHER_SPLIT_LABELS[tone] ?? WEATHER_SPLIT_LABELS.mixed}`)
    .join(' · ')
}

function selectDayForecast(day, forecastsByLocation) {
  const forecasts = day.stops
    .map((stop) => getDailyForecast(forecastsByLocation[stop.locationId], day.date))
    .filter(Boolean)

  return (
    forecasts.find((forecast) => forecast.source === 'short-range') ??
    forecasts[0] ??
    null
  )
}

async function mapWithConcurrency(items, limit, callback) {
  const workers = Array.from({ length: Math.min(limit, items.length) }, async (_, workerIndex) => {
    for (let index = workerIndex; index < items.length; index += limit) {
      await callback(items[index], index)
    }
  })

  await Promise.all(workers)
}

function buildRouteDays(forecastsByLocation) {
  return TRIP_DAYS.map((day) => {
    const primaryStop = day.stops[0]
    const forecast = selectDayForecast(day, forecastsByLocation)

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

function UnitToggle({ unit, onChange }) {
  return (
    <div className="view-toggle unit-toggle" role="group" aria-label="Temperature unit">
      <button
        type="button"
        className={`view-button ${unit === 'F' ? 'is-active' : ''}`}
        onClick={() => onChange('F')}
      >
        °F
      </button>
      <button
        type="button"
        className={`view-button ${unit === 'C' ? 'is-active' : ''}`}
        onClick={() => onChange('C')}
      >
        °C
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
            } ${
              day.forecast?.precipitationProbability != null && day.forecast.precipitationProbability >= 50
                ? 'is-rainy'
                : ''
            }`}
            href={`#${day.anchor}`}
            onClick={(event) => {
              event.preventDefault()
              onSelectDay(day.date)
            }}
          >
            {day.forecast ? (
              <WeatherIcon tone={day.forecast.tone} className="jump-icon" />
            ) : null}
            <span>{formatCompactDate(day.date)}</span>
            {day.isExtended ? <strong>*</strong> : null}
          </a>
        ))}
      </div>
    </nav>
  )
}

function RouteOverview({ routeDays, activeDay, onSelectDay, formatTemp }) {
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
                    {formatTemp(day.forecast.high)}
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
                    ? `${getWeatherLabel(activeRouteDay.forecast.weatherCode)} · ${formatTemp(activeRouteDay.forecast.high)} / ${formatTemp(activeRouteDay.forecast.low)}`
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

function DayGlance({ day, formatTemp }) {
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
              ? `${formatTemp(day.forecast.high)} / ${formatTemp(day.forecast.low)}`
              : 'Waiting for feed'}
          </p>
        </div>
      </div>
    </div>
  )
}

function StopCard({ stop, forecast, shortRangeThrough, extendedRangeThrough, formatTemp, tempUnit }) {
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
              <p className="summary-temp">{formatTemp(dailyForecast.high)}</p>
              <p className="summary-low">{formatTemp(dailyForecast.low)}</p>
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
              <strong>{formatWind(dailyForecast.windSpeed, tempUnit)}</strong>
            </article>
            {dailyForecast.uvIndex != null ? (() => {
              const uv = getUVCategory(dailyForecast.uvIndex)
              return (
                <article className={`metric-card uv-card uv-${uv.level}`}>
                  <p>UV index</p>
                  <strong>{Math.round(dailyForecast.uvIndex)} · {uv.label}</strong>
                </article>
              )
            })() : null}
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
                    <strong>{formatTemp(hour.temperature)}</strong>
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
  const [loadProgress, setLoadProgress] = useState({
    completed: 0,
    failed: 0,
    succeeded: 0,
  })
  const [lastUpdated, setLastUpdated] = useState(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [viewMode, setViewMode] = useState(initialViewMode)
  const [activeDay, setActiveDay] = useState(initialActiveDay)
  const [expandedDates, setExpandedDates] = useState(() =>
    getInitialExpandedDates(initialViewMode),
  )
  const [tempUnit, setTempUnit] = useState(
    () => localStorage.getItem('vacayweather-unit') || 'F',
  )
  const hasLoadedOnceRef = useRef(false)

  const formatTemp = (value) => formatTemperature(value, tempUnit)

  useEffect(() => {
    let ignore = false
    const controller = new AbortController()

    function mergeLocationForecast(locationId, partialForecast) {
      const nextForecast = Object.fromEntries(
        Object.entries(partialForecast).filter(([, value]) => value != null),
      )

      if (Object.keys(nextForecast).length === 0) {
        return
      }

      startTransition(() => {
        setForecastsByLocation((current) => ({
          ...current,
          [locationId]: {
            ...current[locationId],
            ...nextForecast,
          },
        }))
      })
    }

    const loadForecasts = async () => {
      setFetchState(hasLoadedOnceRef.current ? 'refreshing' : 'loading')
      setErrorMessage('')
      setLoadProgress({ completed: 0, failed: 0, succeeded: 0 })

      let completedCount = 0
      let failedCount = 0
      let successfulCount = 0
      let latestSuccessAt = null

      await mapWithConcurrency(
        TRIP_LOCATIONS,
        FORECAST_REQUEST_CONCURRENCY,
        async (location) => {
          try {
            const forecast = await fetchLocationForecast(
              location,
              controller.signal,
              (partialForecast) => {
                if (ignore) {
                  return
                }

                latestSuccessAt = new Date()
                hasLoadedOnceRef.current = true
                mergeLocationForecast(location.locationId, partialForecast)
              },
            )

            if (ignore) {
              return
            }

            successfulCount += 1
            latestSuccessAt = new Date()
            hasLoadedOnceRef.current = true

            mergeLocationForecast(location.locationId, forecast)
          } catch (error) {
            if (!ignore && error.name !== 'AbortError') {
              failedCount += 1
            }
          } finally {
            if (!ignore) {
              completedCount += 1

              startTransition(() => {
                setLoadProgress({
                  completed: completedCount,
                  failed: failedCount,
                  succeeded: successfulCount,
                })
              })
            }
          }
        },
      )

      if (ignore) {
        return
      }

      if (successfulCount === 0 && !hasLoadedOnceRef.current) {
        setFetchState('error')
        setErrorMessage(
          'Unable to load the forecast feed right now. Try refreshing again in a moment.',
        )
        return
      }

      startTransition(() => {
        setFetchState('ready')
        if (latestSuccessAt) {
          setLastUpdated(latestSuccessAt)
        }
      })
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
  const hasForecastData = Object.keys(forecastsByLocation).length > 0
  const isInitialLoading = fetchState === 'loading' && !hasForecastData
  const locationsStillLoading = TOTAL_LOCATIONS - loadProgress.completed

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

  function handleUnitChange(unit) {
    setTempUnit(unit)
    localStorage.setItem('vacayweather-unit', unit)
  }

  const forecastedDays = routeDays.filter((d) => d.forecast)
  const tripWeatherSummary = formatWeatherSplit(forecastedDays)
  const statusMessage =
    fetchState === 'loading'
      ? loadProgress.succeeded > 0
        ? `Loading forecasts... ${loadProgress.succeeded} of ${TOTAL_LOCATIONS} locations ready.`
        : 'Loading forecasts...'
      : fetchState === 'refreshing'
        ? locationsStillLoading > 0
          ? `Refreshing forecasts... showing current data while ${locationsStillLoading} location${locationsStillLoading === 1 ? '' : 's'} still load.`
          : 'Refreshing forecasts...'
        : fetchState === 'ready'
          ? lastUpdated
            ? `Updated ${formatDateTime(lastUpdated)}${
                loadProgress.failed > 0
                  ? ` · ${loadProgress.failed} location${loadProgress.failed === 1 ? '' : 's'} kept prior data.`
                  : ''
              }`
            : 'Forecasts are ready.'
          : 'Weather data is temporarily unavailable.'

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
            <UnitToggle unit={tempUnit} onChange={handleUnitChange} />
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
            label="Weather split"
            value={tripWeatherSummary}
          />
        </div>

        <div className="status-bar">
          <div>
            <p className="status-copy">{statusMessage}</p>
            <p className="status-note">
              `*` marks dates that are still outside the live {FORECAST_PROVIDER.shortRangeDays}
              -day window.
            </p>
          </div>
        </div>

        {errorMessage ? <p className="message error">{errorMessage}</p> : null}
      </section>

      {isInitialLoading ? (
        <section className="loading-panel" aria-live="polite">
          <p className="eyebrow">Forecast loading</p>
          <h2>Pulling live weather for each stop...</h2>
          <p>The route and daily cards will appear once the first forecast batch is ready.</p>
        </section>
      ) : null}

      {hasForecastData ? (
        <>
          <JumpRail routeDays={routeDays} activeDay={activeDay} onSelectDay={handleSelectDay} />
          <RouteOverview
            routeDays={routeDays}
            activeDay={activeDay}
            onSelectDay={handleSelectDay}
            formatTemp={formatTemp}
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
                      <div className="day-header-meta">
                        <p className="day-count">
                          {day.stops.length} location{day.stops.length === 1 ? '' : 's'}
                        </p>
                        {day.forecast?.precipitationProbability != null &&
                        day.forecast.precipitationProbability >= 50 ? (
                          <span className="rain-badge">
                            {day.forecast.precipitationProbability}% rain
                          </span>
                        ) : null}
                      </div>
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

                  {viewMode === 'condensed' ? (
                    <DayGlance day={day} formatTemp={formatTemp} />
                  ) : null}

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
                          formatTemp={formatTemp}
                          tempUnit={tempUnit}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>
              )
            })}
          </section>
        </>
      ) : null}
    </main>
  )
}

export default App
