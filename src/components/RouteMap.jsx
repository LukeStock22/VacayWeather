import { useEffect } from 'react'
import {
  CircleMarker,
  MapContainer,
  Popup,
  Polyline,
  TileLayer,
  useMap,
} from 'react-leaflet'

function FitRouteBounds({ positions }) {
  const map = useMap()

  useEffect(() => {
    if (positions.length === 0) {
      return
    }

    map.fitBounds(positions, {
      padding: [28, 28],
      maxZoom: 6,
    })
  }, [map, positions])

  return null
}

function formatPopupDate(dateString) {
  const [year, month, day] = dateString.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(year, month - 1, day))
}

export default function RouteMap({ routeDays, activeDay, onSelectDay }) {
  const positions = routeDays.map((day) => [
    day.primaryStop.latitude,
    day.primaryStop.longitude,
  ])

  if (positions.length === 0) {
    return <div className="route-map-fallback">Route map unavailable.</div>
  }

  return (
    <div className="route-map-shell">
      <MapContainer
        center={positions[0]}
        zoom={5}
        scrollWheelZoom={false}
        className="route-map-live"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <FitRouteBounds positions={positions} />

        <Polyline
          positions={positions}
          pathOptions={{
            color: '#0f7aa3',
            weight: 4,
            opacity: 0.8,
          }}
        />

        {routeDays.map((day, index) => (
          <CircleMarker
            key={day.date}
            center={[day.primaryStop.latitude, day.primaryStop.longitude]}
            radius={activeDay === day.date ? 11 : day.stops.length > 1 ? 9 : 7}
            pathOptions={{
              color: day.isExtended ? '#c98517' : '#0f5b7e',
              weight: activeDay === day.date ? 4 : 3,
              fillColor: day.isExtended ? '#ffddad' : '#ffffff',
              fillOpacity: 1,
            }}
            eventHandlers={{
              click: () => onSelectDay(day.date),
            }}
          >
            <Popup>
              <div className="map-popup">
                <p>
                  {index + 1}. {formatPopupDate(day.date)}
                  {day.isExtended ? '*' : ''}
                </p>
                <strong>{day.primaryStop.name}</strong>
                <span>
                  {day.stops.length > 1
                    ? `${day.stops.length} stops that day`
                    : day.primaryStop.activityLabel}
                </span>
                <a
                  href={`#${day.anchor}`}
                  onClick={(event) => {
                    event.preventDefault()
                    onSelectDay(day.date)
                  }}
                >
                  Jump to day
                </a>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  )
}
