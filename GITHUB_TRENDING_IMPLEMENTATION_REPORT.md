# GitHub Trending Apps Explorer — Implementation Report

**Implementation date:** 2026-10-17 (UTC)  
**Repository baseline:** The checkout contained only a two-line `README.md`; there was no existing framework, route, component, data provider, or state-management code to preserve. The app was built as a small React/Vite client with a server-side Express data layer.

## Features implemented

- Responsive developer-focused dashboard titled **GitHub Trending Apps Explorer**, with dark/light themes, keyboard-accessible controls, status/loading/error/empty states, live-source timestamp, and source/limitations footer.
- Daily, weekly, and monthly period controls; Top 5, 10, 15, and 20 controls. The selected count is applied after active filters; when fewer valid matches exist, the actual count is shown rather than padded.
- Search by repository name, owner, and description; dynamic language/topic filters; minimum lifetime-stars filter; and sorting by period rank, total stars, last update, or forks.
- Filter/period/count/sort state is reflected in the URL. Search supports Ctrl/Command+K. Refresh forces a new source request.
- Ranked repository cards include owner, description, language, lifetime stars, period stars gained, forks, last update, topics, GitHub repository link, and the repository-declared homepage when present. Missing metadata is shown as unavailable/not specified, not invented. The homepage is sourced from the repository's GitHub metadata and is not independently audited by this app.
- Repository metadata status and timestamps distinguish fresh API results, cached API results, earlier metadata, and unavailable/rate-limited details. A stale Trending snapshot is explicitly labeled with the time of its last successful fetch.

## Data providers and ranking methodology

1. **Period ranking and star growth:** Server-side requests to GitHub's public `https://github.com/trending?since=daily|weekly|monthly` pages. The provider extracts the explicit `stars today`, `stars this week`, or `stars this month` figure for each row. It sorts by that period-specific figure in descending order; GitHub's original row order breaks ties. Lifetime stars are never used as a growth substitute, and rows without a valid period-growth value are rejected.
2. **Repository verification/enrichment:** Official GitHub REST API `GET /repos/{owner}/{repo}` supplies current star and fork totals, update timestamps, topics, homepage, language, and descriptions when available. Fields exposed by the Trending page are retained as first-party fallbacks if an API lookup fails. A REST 404/410 removes the repository from the current result set.
3. **Credentials:** No token is required. Optional `GITHUB_TOKEN` is read only by the Express server to raise the REST API rate limit; it is not exposed to browser code.
4. **Caching:** Process-local Trending response cache: 5 minutes per period. Repository metadata cache: 15 minutes. Concurrent requests are deduplicated. Manual refresh bypasses both TTLs. Cache timestamps are preserved and stale data is never described as newly fetched.

### Accuracy and provider limitations

GitHub does not expose historical daily/weekly/monthly star gains through its standard public repository-search endpoint. GitHub Trending is therefore the source of truth for the period-specific gains. The page is rendered HTML, not a documented JSON API, so markup can change; parsing failures are reported rather than silently falling back to lifetime-star ranking. The explorer displays at most the first 20 verified entries from the Trending feed. Search, language, and topic filters operate on that loaded feed, not on every repository on GitHub; available language/topic options are derived from the current feed. GitHub's standard REST API rate limits apply (typically 60 unauthenticated requests/hour per IP, higher when authenticated).

## Files created or modified

- `README.md` — setup, data-provider, cache, rate-limit, and limitation documentation.
- `GITHUB_TRENDING_IMPLEMENTATION_REPORT.md` — this report.
- `.gitignore`, `.env.example`, `package.json`, `package-lock.json` — project setup, optional server-only token configuration, dependency lock, and scripts.
- `index.html`, `vite.config.js`, `vitest.config.js` — web entry point, same-origin API proxy/preview configuration, and UI test configuration.
- `server/index.js` — Express API routes, error responses, production static hosting.
- `server/trendingProvider.js` — GitHub Trending parser, period-specific ranking, REST metadata provider, validation, cache, rate-limit handling, and stale fallback.
- `src/main.jsx`, `src/App.jsx`, `src/styles.css` — React interface, all interactive controls/states, and responsive visual system.
- `src/lib/filterResults.js` — reusable filtering, sorting, filter-option derivation, and result-count logic.
- `tests/trendingProvider.test.js`, `tests/filterResults.test.js`, `src/App.test.jsx` — provider, ranking, filtering, result-count, and UI interaction tests.

## Testing and live validation

- `npm test` — **24 tests passed** (16 Node provider/filter tests and 8 jsdom UI interaction tests). Coverage includes all three periods, all four result counts, combined filters, sort order, unavailable metadata, REST and Trending rate limits, deleted repositories, stale-cache fallback, request deduplication, empty states, retry, refresh, direct links, URL state, theme switching, and keyboard search.
- `npm run build` — production Vite build completed successfully.
- Live smoke test on 2026-10-17 UTC — fetched real GitHub Trending pages and REST metadata for daily, weekly, and monthly windows. The observed feed contained 13 daily rows, 10 weekly rows, and 21 monthly rows; the app returned 13, 10, and 20 respectively (the monthly UI intentionally caps at Top 20). Period-growth figures were present and ranked from GitHub Trending; repository metadata was returned by GitHub's REST API or its explicit short-lived cache.
- Live API proxy smoke test — `/api/trending?period=daily` returned current JSON through Vite's same-origin proxy.
- **Viewport-test note:** Responsive breakpoints are implemented for desktop, tablet, and mobile widths, and controls are interaction-tested in jsdom. A real-browser screenshot/viewport automation run was not available in this environment.

## Run instructions

**Requirements:** Node.js 22.15+ and npm.

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal (normally `http://localhost:5173`). For an optional authenticated REST API limit, copy `.env.example` to `.env` and set `GITHUB_TOKEN` there. Keep that value server-side; do not use a `VITE_` variable.

Production and validation commands:

```bash
npm run build
npm start
npm test
```

`npm start` serves the production client and API on `PORT` (default `3001`). In development, Vite proxies relative `/api` requests to the Express server.
