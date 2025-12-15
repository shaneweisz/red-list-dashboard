# Red List Dashboard

A web application for breaking down IUCN Red List Assessment data, linked to GBIF. 

## Features

- Browse species for a given taxon with filtering, sorting, and pagination
- View conservation category distribution and assessment recency
- Explore species occurrence data and distribution maps via GBIF integration

## Getting Started

```bash
cd app
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Environment Variables

Create `app/.env.local` with:

```
RED_LIST_API_KEY=your_iucn_api_key
```

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- Recharts
