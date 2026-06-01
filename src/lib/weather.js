const SHORT_RANGE_FIELDS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_probability_max',
  'precipitation_sum',
  'wind_speed_10m_max',
  'uv_index_max',
]

const HOURLY_FIELDS = [
  'temperature_2m',
  'weather_code',
  'precipitation_probability',
  'wind_speed_10m',
]

const EXTENDED_FIELDS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'wind_speed_10m_max',
]

const FETCH_RETRY_DELAYS_MS = [500, 1500, 3000]

const WEATHER_LABELS = {
  0: 'Clear skies',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Heavy freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Heavy freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Rain showers',
  81: 'Heavy rain showers',
  82: 'Violent rain showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Storm with hail',
  99: 'Severe storm with hail',
}

function buildQuery(location, options) {
  const query = new URLSearchParams({
    latitude: location.latitude.toString(),
    longitude: location.longitude.toString(),
    daily: options.daily.join(','),
    timezone: 'auto',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
  })

  if (options.hourly?.length) {
    query.set('hourly', options.hourly.join(','))
  }

  if (options.forecastDays) {
    query.set('forecast_days', options.forecastDays.toString())
  }

  query.set('cell_selection', location.kind === 'sea' ? 'sea' : 'land')

  return query
}

async function fetchJson(url, signal, errorLabel) {
  const response = await fetch(url, { signal })

  if (!response.ok) {
    throw new Error(`${errorLabel} request failed`)
  }

  return response.json()
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(resolve, ms)

    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeoutId)
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

async function fetchJsonWithRetry(url, signal, errorLabel) {
  let lastError = null

  for (let attempt = 0; attempt <= FETCH_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await fetchJson(url, signal, errorLabel)
    } catch (error) {
      if (error.name === 'AbortError') {
        throw error
      }

      lastError = error
      const retryDelay = FETCH_RETRY_DELAYS_MS[attempt]

      if (retryDelay == null) {
        break
      }

      await wait(retryDelay, signal)
    }
  }

  throw lastError ?? new Error(`${errorLabel} request failed`)
}

function notifyPartialForecast(onPartialForecast, partialForecast) {
  if (!onPartialForecast) {
    return
  }

  onPartialForecast(partialForecast)
}

function normalizePrecipitationProbability(probability) {
  if (Number.isFinite(probability)) {
    return Math.round(probability)
  }

  return null
}

function getPayloadForecast(payload, dateString, source) {
  if (!payload?.daily?.time) {
    return null
  }

  const dayIndex = payload.daily.time.indexOf(dateString)
  if (dayIndex === -1) {
    return null
  }

  const precipitationTotal = payload.daily.precipitation_sum?.[dayIndex] ?? 0
  const precipitationProbability = normalizePrecipitationProbability(
    payload.daily.precipitation_probability_max?.[dayIndex],
  )
  const weatherCode = payload.daily.weather_code?.[dayIndex]
  const high = payload.daily.temperature_2m_max?.[dayIndex]
  const low = payload.daily.temperature_2m_min?.[dayIndex]
  const windSpeed = payload.daily.wind_speed_10m_max?.[dayIndex]

  if (
    !Number.isFinite(weatherCode) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(precipitationTotal) ||
    !Number.isFinite(windSpeed)
  ) {
    return null
  }

  return {
    source,
    weatherCode,
    high,
    low,
    precipitationProbability,
    precipitationTotal,
    windSpeed,
    uvIndex: payload.daily.uv_index_max?.[dayIndex] ?? null,
  }
}

export async function fetchLocationForecast(location, signal, onPartialForecast) {
  const shortRangeQuery = buildQuery(location, {
    daily: SHORT_RANGE_FIELDS,
    hourly: HOURLY_FIELDS,
    forecastDays: 16,
  })
  const extendedQuery = buildQuery(location, {
    daily: EXTENDED_FIELDS,
  })

  const [shortRangeResult, extendedRangeResult] = await Promise.allSettled([
    fetchJsonWithRetry(
      `https://api.open-meteo.com/v1/forecast?${shortRangeQuery}`,
      signal,
      `${location.name} short-range forecast`,
    ).then((shortRange) => {
      notifyPartialForecast(onPartialForecast, { shortRange })
      return shortRange
    }),
    fetchJsonWithRetry(
      `https://seasonal-api.open-meteo.com/v1/forecast?${extendedQuery}`,
      signal,
      `${location.name} extended forecast`,
    ).then((extendedRange) => {
      notifyPartialForecast(onPartialForecast, { extendedRange })
      return extendedRange
    }),
  ])

  const shortRange =
    shortRangeResult.status === 'fulfilled' ? shortRangeResult.value : null
  const extendedRange =
    extendedRangeResult.status === 'fulfilled' ? extendedRangeResult.value : null

  if (!shortRange && !extendedRange) {
    throw new Error(`Forecast request failed for ${location.name}`)
  }

  return {
    shortRange,
    extendedRange,
  }
}

export function getWeatherLabel(code) {
  return WEATHER_LABELS[code] ?? 'Mixed conditions'
}

export function getWeatherTone(code) {
  if (code === 0 || code === 1) {
    return 'sun'
  }

  if (code === 2 || code === 3) {
    return 'cloud'
  }

  if (code === 45 || code === 48) {
    return 'fog'
  }

  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    return 'rain'
  }

  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) {
    return 'snow'
  }

  if (code >= 95) {
    return 'storm'
  }

  return 'mixed'
}

export function getShortRangeHorizon(forecastBundle) {
  return forecastBundle?.shortRange?.daily?.time?.at(-1) ?? null
}

export function getExtendedRangeHorizon(forecastBundle) {
  return forecastBundle?.extendedRange?.daily?.time?.at(-1) ?? null
}

export function getDailyForecast(forecastBundle, dateString) {
  const shortRangeForecast = getPayloadForecast(
    forecastBundle?.shortRange,
    dateString,
    'short-range',
  )
  if (shortRangeForecast) {
    return {
      ...shortRangeForecast,
      sourceLabel: '16-day forecast',
      tone: getWeatherTone(shortRangeForecast.weatherCode),
    }
  }

  const extendedForecast = getPayloadForecast(
    forecastBundle?.extendedRange,
    dateString,
    'extended-range',
  )
  if (extendedForecast) {
    return {
      ...extendedForecast,
      sourceLabel: 'Extended range',
      tone: getWeatherTone(extendedForecast.weatherCode),
    }
  }

  return null
}

export function getHourlyHighlights(forecastBundle, dateString) {
  const payload = forecastBundle?.shortRange
  if (!payload?.hourly?.time) {
    return []
  }

  const checkpoints = [
    { hour: '09:00', label: '9 AM' },
    { hour: '12:00', label: '12 PM' },
    { hour: '15:00', label: '3 PM' },
    { hour: '18:00', label: '6 PM' },
  ]

  return checkpoints
    .map((checkpoint) => {
      const timestamp = `${dateString}T${checkpoint.hour}`
      const index = payload.hourly.time.indexOf(timestamp)

      if (index === -1) {
        return null
      }

      return {
        label: checkpoint.label,
        time: timestamp,
        temperature: payload.hourly.temperature_2m[index],
        weatherCode: payload.hourly.weather_code[index],
        tone: getWeatherTone(payload.hourly.weather_code[index]),
      }
    })
    .filter(Boolean)
}
