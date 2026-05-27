import {
  Bike,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSun,
  Footprints,
  Mountain,
  Plane,
  Sailboat,
  ShipWheel,
  Snowflake,
  SunMedium,
} from 'lucide-react'

const DEFAULT_ICON_PROPS = {
  'aria-hidden': true,
  strokeWidth: 2,
}

export function ActivityIcon({ activity, className = '' }) {
  switch (activity) {
    case 'plane':
      return <Plane className={className} {...DEFAULT_ICON_PROPS} />
    case 'walk':
      return <Footprints className={className} {...DEFAULT_ICON_PROPS} />
    case 'hike':
      return <Mountain className={className} {...DEFAULT_ICON_PROPS} />
    case 'bike':
      return <Bike className={className} {...DEFAULT_ICON_PROPS} />
    case 'boat':
      return <Sailboat className={className} {...DEFAULT_ICON_PROPS} />
    case 'ship':
      return <ShipWheel className={className} {...DEFAULT_ICON_PROPS} />
    default:
      return <Footprints className={className} {...DEFAULT_ICON_PROPS} />
  }
}

export function WeatherIcon({ tone, className = '' }) {
  switch (tone) {
    case 'sun':
      return <SunMedium className={className} {...DEFAULT_ICON_PROPS} />
    case 'cloud':
      return <CloudSun className={className} {...DEFAULT_ICON_PROPS} />
    case 'fog':
      return <CloudFog className={className} {...DEFAULT_ICON_PROPS} />
    case 'rain':
      return <CloudRain className={className} {...DEFAULT_ICON_PROPS} />
    case 'snow':
      return <Snowflake className={className} {...DEFAULT_ICON_PROPS} />
    case 'storm':
      return <CloudLightning className={className} {...DEFAULT_ICON_PROPS} />
    default:
      return <Cloud className={className} {...DEFAULT_ICON_PROPS} />
  }
}
