# VacayWeather

A React + Vite travel weather dashboard for a Mediterranean itinerary with many different stops across consecutive days.

## What it does

- Shows the trip day by day, including multi-stop days.
- Pulls daily forecasts and simple hourly checkpoints from Open-Meteo.
- Refreshes automatically every hour and supports manual refresh.
- Marks later dates as pending until they enter the free forecast window.

## Forecast source

This app uses the free Open-Meteo forecast API. It does not require an API key, but the practical limit for this build is a 16-day forecast horizon. Dates beyond that horizon stay visible in the UI and fill in automatically as the trip gets closer.

## Run locally

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```
