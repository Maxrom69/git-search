# GitHub Trending Apps Explorer

A responsive project-discovery app for GitHub's daily, weekly, and monthly trending repositories. It ranks verified period-specific star gains, enriches repositories with GitHub REST API metadata, and supports search, filters, sorting, theme switching, and refresh.

## Run locally

**Requirements:** Node.js 22.15+ and npm.

```bash
npm install
npm run dev
```

Open the Vite URL printed in the terminal (normally `http://localhost:5173`). The development command starts the web client and the Express API together; browser requests use the relative `/api` path and Vite proxies them to the server.

Optional configuration:

```bash
cp .env.example .env
# Add GITHUB_TOKEN=... to .env if you want authenticated GitHub REST API limits.
```

A token is **not required**. If configured, it is read only by the server-side provider. Do not add a `VITE_` prefix or place the token in browser code. The public Trending pages do not require a token.

Production build and run:

```bash
npm run build
npm start
```

The production Express process serves the built client and `/api` on `PORT` (default `3001`). To run the test suite:

```bash
npm test
```

## Data and ranking

- The server requests GitHub's public Trending page at `https://github.com/trending?since=daily|weekly|monthly` for the selected period.
- The provider reads each repository's explicit **“stars today,” “stars this week,” or “stars this month”** value. It sorts repositories by that period's star gain in descending order; GitHub's page order breaks ties. Lifetime stars are never used as a substitute for growth.
- The GitHub REST API (`GET /repos/{owner}/{repo}`) supplies and verifies current lifetime stars, forks, update timestamp, topics, homepage, language, and description when available. The Trending page itself is used as a first-party fallback for fields it exposes. Missing values remain unavailable; no data is invented.
- The explorer receives up to 20 valid repositories from the Trending feed. Top 5 / 10 / 15 / 20 controls select the displayed count; active filters may reduce the number, and the app reports the actual count instead of padding results.
- Search, language, topic, minimum-star filters, sort order, period, and result count are applied in the browser and retained in the URL. Language and topic choices are based on metadata in the currently loaded feed.

## Caching, limits, and failure behavior

- Trending snapshots are cached in memory for 5 minutes per period. GitHub repository metadata is cached independently for 15 minutes. Requests in flight are deduplicated. Refresh explicitly bypasses both cache TTLs.
- The public GitHub REST API limit is typically 60 requests/hour per IP; authenticated requests are typically 5,000/hour. A loaded period can require up to 20 repository lookups. An optional server-side `GITHUB_TOKEN` helps if you frequently refresh or explore all periods.
- If the REST API is rate limited, period rankings and stars-gained figures still come from GitHub Trending. Missing or previously verified repository details are clearly identified. If Trending itself fails, the app may show its last successful snapshot with an explicit stale warning and original timestamp; it never labels that snapshot as freshly fetched.
- Cache contents are process-local and reset when the server restarts. No repository list or sample data is hardcoded into the running application.

## Source limitations

GitHub does not provide a public REST endpoint for historical repository star gains over arbitrary daily, weekly, or monthly windows. This application therefore uses GitHub's own public Trending pages for their period-specific growth figures, then enriches those live entries through the official REST API. GitHub Trending is a rendered HTML page rather than a documented JSON API, so its markup can change; the parser validates the expected growth field and returns a visible error rather than silently switching to an inaccurate ranking. The feed may contain fewer than 20 valid entries for a period.
