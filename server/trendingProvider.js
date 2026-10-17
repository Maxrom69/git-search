import * as cheerio from 'cheerio';

export const PERIODS = Object.freeze({
  daily: Object.freeze({ pageValue: 'daily', growthLabel: 'today', displayLabel: 'today' }),
  weekly: Object.freeze({ pageValue: 'weekly', growthLabel: 'this week', displayLabel: 'this week' }),
  monthly: Object.freeze({ pageValue: 'monthly', growthLabel: 'this month', displayLabel: 'this month' }),
});

export const MAX_RESULTS = 20;
const GITHUB_WEB = 'https://github.com';
const GITHUB_API = 'https://api.github.com';
const DEFAULT_PAGE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_DETAIL_TTL_MS = 15 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_USER_AGENT = 'GitHub-Trending-Apps-Explorer/1.0';

export class ProviderError extends Error {
  constructor(message, { code = 'PROVIDER_ERROR', status = 502, retryAt = null } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
    this.retryAt = retryAt;
  }
}

export function parseCount(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  }

  if (typeof value !== 'string') return null;
  const normalized = value.replace(/,/g, '').trim().toLowerCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*([km])?$/);
  if (!match) return null;

  const multiplier = match[2] === 'm' ? 1_000_000 : match[2] === 'k' ? 1_000 : 1;
  const parsed = Number(match[1]) * multiplier;
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getRepoSlug(href) {
  if (typeof href !== 'string' || !href.trim()) return null;

  try {
    const url = new URL(href, GITHUB_WEB);
    if (url.origin !== GITHUB_WEB) return null;

    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (segments.length !== 2) return null;
    const [owner, name] = segments;
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name)) return null;
    return { owner, name, fullName: `${owner}/${name}`, key: `${owner}/${name}`.toLowerCase() };
  } catch {
    return null;
  }
}

/**
 * Parse GitHub's public Trending page. Its period-specific "stars today / this week /
 * this month" value is the only growth metric used by this app; missing values are
 * rejected instead of being replaced with lifetime stars or an estimate.
 */
export function parseTrendingPage(html, period) {
  const config = PERIODS[period];
  if (!config) throw new ProviderError('Choose daily, weekly, or monthly trending.', { code: 'INVALID_PERIOD', status: 400 });
  if (typeof html !== 'string' || !html.trim()) {
    throw new ProviderError('GitHub returned an empty Trending page.', { code: 'TRENDING_PARSE_ERROR' });
  }

  const $ = cheerio.load(html);
  let rows = $('article.Box-row');
  // Keep a small compatibility fallback for markup where GitHub retains the Box-row class
  // but changes the semantic wrapper element.
  if (rows.length === 0) rows = $('.Box-row');
  if (rows.length === 0) {
    throw new ProviderError('GitHub Trending changed its page structure; no repository rows were found.', {
      code: 'TRENDING_PARSE_ERROR',
    });
  }

  const repositories = [];
  let skippedRows = 0;
  const growthPattern = new RegExp(
    `(\\d[\\d,.]*(?:\\s*[kKmM])?)\\s+stars?\\s+${escapeRegExp(config.growthLabel)}\\b`,
    'i',
  );

  rows.each((index, element) => {
    const row = $(element);
    const heading = row.find('h2 a[href]').first();
    const identity = getRepoSlug(heading.attr('href'));
    const rowText = row.text().replace(/\s+/g, ' ').trim();
    const growthMatch = rowText.match(growthPattern);
    const starsGained = growthMatch ? parseCount(growthMatch[1]) : null;

    if (!identity || starsGained === null) {
      skippedRows += 1;
      return;
    }

    const starText = row.find('a[href$="/stargazers"]').first().text().replace(/\s+/g, ' ').trim();
    const forkText = row.find('a[href$="/forks"]').first().text().replace(/\s+/g, ' ').trim();
    const language = row.find('[itemprop="programmingLanguage"]').first().text().trim();
    const description = row.find('p').first().text().replace(/\s+/g, ' ').trim();

    repositories.push({
      ...identity,
      sourceRank: index + 1,
      description: description || null,
      language: language || null,
      starsGained,
      totalStarsFromPage: parseCount(starText),
      forksFromPage: parseCount(forkText),
    });
  });

  if (repositories.length === 0) {
    throw new ProviderError(
      `GitHub Trending did not provide verifiable ${config.growthLabel} star-growth values. No rankings were fabricated.`,
      { code: 'TRENDING_PARSE_ERROR' },
    );
  }

  return { repositories, sourceCount: rows.length, skippedRows };
}

/** Rank only by period-specific stars gained; preserve GitHub's order as a tie-breaker. */
export function rankTrendingRepositories(repositories, limit = MAX_RESULTS) {
  return repositories
    .filter((repository) => Number.isInteger(repository.starsGained) && repository.starsGained >= 0)
    .slice()
    .sort((left, right) => right.starsGained - left.starsGained || left.sourceRank - right.sourceRank)
    .slice(0, limit)
    .map((repository, index) => ({ ...repository, rank: index + 1 }));
}

function safeHomepage(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function validIsoDate(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function normalizeRepoDetails(payload, expectedKey, verifiedAt) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const fullName = typeof payload.full_name === 'string' ? payload.full_name : '';
  if (!fullName || fullName.toLowerCase() !== expectedKey) return null;

  const owner = typeof payload.owner?.login === 'string' ? payload.owner.login : fullName.split('/')[0];
  const topics = Array.isArray(payload.topics)
    ? [...new Set(payload.topics.filter((topic) => typeof topic === 'string' && topic.trim()).map((topic) => topic.trim()))]
    : [];

  return {
    fullName,
    owner,
    description: typeof payload.description === 'string' ? payload.description.trim() || null : null,
    language: typeof payload.language === 'string' ? payload.language.trim() || null : null,
    totalStars: Number.isInteger(payload.stargazers_count) && payload.stargazers_count >= 0 ? payload.stargazers_count : null,
    forks: Number.isInteger(payload.forks_count) && payload.forks_count >= 0 ? payload.forks_count : null,
    updatedAt: validIsoDate(payload.updated_at),
    homepage: safeHomepage(payload.homepage),
    topics,
    verifiedAt,
  };
}

function formatRetryAt(response, now) {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return now + retryAfter * 1000;

  const reset = Number(response.headers.get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) return reset * 1000;
  return now + 60_000;
}

function isRateLimitResponse(response, bodyText = '') {
  return response.status === 429 || (
    response.status === 403 && (
      response.headers.get('x-ratelimit-remaining') === '0' ||
      /rate limit|secondary rate limit|abuse detection/i.test(bodyText)
    )
  );
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const output = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      output[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return output;
}

function metadataWarning(statuses, rateLimitResetAt) {
  const warnings = [];
  if (statuses.includes('rate_limited')) {
    const when = rateLimitResetAt ? ` The limit is expected to reset at ${new Date(rateLimitResetAt).toISOString()}.` : '';
    warnings.push(`GitHub REST API metadata is rate limited. Trending ranks and period star gains remain sourced from GitHub Trending; some repository details may be unavailable.${when}`);
  }
  if (statuses.includes('unavailable')) {
    warnings.push('Some GitHub REST API lookups failed. Missing fields are shown as unavailable rather than estimated.');
  }
  if (statuses.includes('stale')) {
    warnings.push('Some repository metadata could not be refreshed and is marked with its earlier verification time.');
  }
  return warnings;
}

/**
 * Server-side data provider. Trending HTML is cached per period; repository details are
 * independently cached and deduplicated. A GitHub token, if present, is read only here.
 */
export function createTrendingService(options = {}) {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const githubToken = options.githubToken ?? process.env.GITHUB_TOKEN ?? '';
  const pageTtlMs = options.pageTtlMs ?? DEFAULT_PAGE_TTL_MS;
  const detailTtlMs = options.detailTtlMs ?? DEFAULT_DETAIL_TTL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResults = options.maxResults ?? MAX_RESULTS;
  const concurrency = options.concurrency ?? 5;
  const pageCache = new Map();
  const detailCache = new Map();
  const pageInFlight = new Map();
  const detailInFlight = new Map();
  let rateLimitUntil = null;

  const cacheAge = (timestamp) => Math.max(0, now() - timestamp);

  function cachedSnapshot(stored, { stale = false, reason = null } = {}) {
    const age = cacheAge(stored.fetchedAtMs);
    const results = stored.response.results.map((repository) => {
      const metadataStatus = stale
        ? repository.metadataVerifiedAt ? 'stale' : repository.metadataStatus
        : ['verified', 'cached'].includes(repository.metadataStatus) ? 'cached' : repository.metadataStatus;
      return {
        ...repository,
        metadataStatus,
        metadataCacheAgeMs: repository.metadataCacheAgeMs === null || repository.metadataCacheAgeMs === undefined
          ? null
          : repository.metadataCacheAgeMs + age,
      };
    });
    const metadata = {
      ...stored.response.metadata,
      verifiedCount: results.filter((repository) => repository.metadataStatus === 'verified').length,
      cachedCount: results.filter((repository) => repository.metadataStatus === 'cached').length,
      staleCount: results.filter((repository) => repository.metadataStatus === 'stale').length,
      unavailableCount: results.filter((repository) => ['unavailable', 'rate_limited'].includes(repository.metadataStatus)).length,
    };
    return {
      ...stored.response,
      results,
      metadata,
      servedFromCache: true,
      isStale: stale,
      cacheAgeMs: age,
      ...(reason ? { staleReason: reason } : {}),
    };
  }

  async function fetchTrendingHtml(period) {
    const url = `${GITHUB_WEB}/trending?since=${PERIODS[period].pageValue}`;
    let response;
    try {
      response = await fetchFn(url, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': DEFAULT_USER_AGENT,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new ProviderError(
        timedOut ? 'GitHub Trending did not respond before the request timed out.' : 'Could not connect to GitHub Trending. Check the network and retry.',
        { code: timedOut ? 'TRENDING_TIMEOUT' : 'TRENDING_NETWORK_ERROR', status: 503 },
      );
    }

    if (!response.ok) {
      const rateLimited = response.status === 429 || response.status === 403;
      throw new ProviderError(
        rateLimited
          ? 'GitHub Trending is temporarily refusing requests. Please wait and retry.'
          : `GitHub Trending returned HTTP ${response.status}. Please retry shortly.`,
        {
          code: rateLimited ? 'TRENDING_RATE_LIMITED' : 'TRENDING_HTTP_ERROR',
          status: rateLimited ? 429 : 502,
          retryAt: formatRetryAt(response, now()),
        },
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType && !contentType.includes('text/html')) {
      throw new ProviderError('GitHub Trending returned an unexpected response format.', { code: 'TRENDING_INVALID_RESPONSE' });
    }

    const html = await response.text();
    if (html.length > 12_000_000) {
      throw new ProviderError('GitHub Trending returned an unexpectedly large page.', { code: 'TRENDING_INVALID_RESPONSE' });
    }
    return { html, url };
  }

  async function fetchRepoDetails(candidate, force) {
    const cached = detailCache.get(candidate.key);
    const cachedAge = cached ? cacheAge(cached.fetchedAtMs) : null;
    if (cached && !force && cachedAge < detailTtlMs) {
      return { data: cached.data, status: 'cached', fetchedAt: cached.data.verifiedAt, cacheAgeMs: cachedAge };
    }

    if (detailInFlight.has(candidate.key)) return detailInFlight.get(candidate.key);

    if (rateLimitUntil && rateLimitUntil <= now()) rateLimitUntil = null;
    if (rateLimitUntil && rateLimitUntil > now()) {
      return {
        data: cached?.data ?? null,
        status: 'rate_limited',
        fetchedAt: cached?.data.verifiedAt ?? null,
        cacheAgeMs: cached ? cachedAge : null,
        retryAt: rateLimitUntil,
      };
    }

    const request = (async () => {
      try {
        const headers = {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': DEFAULT_USER_AGENT,
        };
        if (githubToken) headers.Authorization = `Bearer ${githubToken}`;

        const response = await fetchFn(`${GITHUB_API}/repos/${candidate.owner}/${candidate.name}`, {
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (response.status === 404 || response.status === 410) {
          detailCache.delete(candidate.key);
          return { data: null, status: 'not_found', fetchedAt: null, cacheAgeMs: null };
        }

        if (!response.ok) {
          const bodyText = await response.text().catch(() => '');
          if (isRateLimitResponse(response, bodyText)) {
            rateLimitUntil = formatRetryAt(response, now());
            return {
              data: cached?.data ?? null,
              status: 'rate_limited',
              fetchedAt: cached?.data.verifiedAt ?? null,
              cacheAgeMs: cached ? cachedAge : null,
              retryAt: rateLimitUntil,
            };
          }
          return {
            data: cached?.data ?? null,
            status: cached ? 'stale' : 'unavailable',
            fetchedAt: cached?.data.verifiedAt ?? null,
            cacheAgeMs: cached ? cachedAge : null,
          };
        }

        const payload = await response.json();
        const verifiedAt = new Date(now()).toISOString();
        const data = normalizeRepoDetails(payload, candidate.key, verifiedAt);
        if (!data) {
          return {
            data: cached?.data ?? null,
            status: cached ? 'stale' : 'unavailable',
            fetchedAt: cached?.data.verifiedAt ?? null,
            cacheAgeMs: cached ? cachedAge : null,
          };
        }

        const stored = { data, fetchedAtMs: now() };
        detailCache.set(candidate.key, stored);
        return { data, status: 'verified', fetchedAt: verifiedAt, cacheAgeMs: 0 };
      } catch (error) {
        const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        return {
          data: cached?.data ?? null,
          status: cached ? 'stale' : 'unavailable',
          fetchedAt: cached?.data.verifiedAt ?? null,
          cacheAgeMs: cached ? cachedAge : null,
          failureCode: timedOut ? 'API_TIMEOUT' : 'API_NETWORK_ERROR',
        };
      }
    })();

    detailInFlight.set(candidate.key, request);
    try {
      return await request;
    } finally {
      detailInFlight.delete(candidate.key);
    }
  }

  function mergeRepository(candidate, detailResult, rank, period) {
    const details = detailResult.data;
    const totalStars = details?.totalStars ?? candidate.totalStarsFromPage;
    const forks = details?.forks ?? candidate.forksFromPage;
    const language = details?.language ?? candidate.language;
    const description = details?.description ?? candidate.description;
    const updatedAt = details?.updatedAt ?? null;
    const homepage = details?.homepage ?? null;
    const metadataVerifiedAt = details?.verifiedAt ?? null;

    return {
      id: candidate.key,
      rank,
      sourceRank: candidate.sourceRank,
      owner: details?.owner ?? candidate.owner,
      name: candidate.name,
      fullName: details?.fullName ?? candidate.fullName,
      description,
      language,
      totalStars,
      starsGained: candidate.starsGained,
      starsGainedPeriod: period,
      forks,
      updatedAt,
      topics: details?.topics ?? [],
      topicsAvailable: Boolean(details),
      homepage,
      repositoryUrl: `${GITHUB_WEB}/${encodeURIComponent(candidate.owner)}/${encodeURIComponent(candidate.name)}`,
      totalStarsSource: details?.totalStars !== null && details?.totalStars !== undefined
        ? 'GitHub REST API'
        : candidate.totalStarsFromPage !== null ? 'GitHub Trending' : null,
      starsGainedSource: 'GitHub Trending',
      forksSource: details?.forks !== null && details?.forks !== undefined
        ? 'GitHub REST API'
        : candidate.forksFromPage !== null ? 'GitHub Trending' : null,
      languageSource: details?.language ? 'GitHub REST API' : candidate.language ? 'GitHub Trending' : null,
      metadataStatus: detailResult.status,
      metadataVerifiedAt,
      metadataCacheAgeMs: detailResult.cacheAgeMs,
    };
  }

  async function loadPeriod(period, force) {
    const oldCache = pageCache.get(period);
    const age = oldCache ? cacheAge(oldCache.fetchedAtMs) : null;
    if (oldCache && !force && age < pageTtlMs) {
      return cachedSnapshot(oldCache);
    }

    if (pageInFlight.has(period)) {
      return pageInFlight.get(period);
    }

    const request = (async () => {
      try {
        const { html, url } = await fetchTrendingHtml(period);
        const pageFetchedAt = new Date(now()).toISOString();
        const parsed = parseTrendingPage(html, period);
        const candidates = rankTrendingRepositories(parsed.repositories, maxResults);
        const metadata = await mapWithConcurrency(candidates, concurrency, (candidate) => fetchRepoDetails(candidate, force));
        const allEntries = candidates.map((candidate, index) => ({ candidate, metadata: metadata[index] }));
        const deletedCount = allEntries.filter((entry) => entry.metadata.status === 'not_found').length;
        const usable = allEntries.filter((entry) => entry.metadata.status !== 'not_found');
        const statuses = usable.map((entry) => entry.metadata.status);
        const retryAt = usable.reduce((latest, entry) => Math.max(latest ?? 0, entry.metadata.retryAt ?? 0), 0) || null;
        const repositories = usable.map(({ candidate, metadata: detail }, index) =>
          mergeRepository(candidate, detail, index + 1, period),
        );
        const response = {
          period,
          source: 'GitHub Trending',
          sourceUrl: url,
          rankingMethod: 'Sorted by stars gained during the selected period; original GitHub Trending order breaks ties.',
          fetchedAt: pageFetchedAt,
          servedFromCache: false,
          cacheAgeMs: 0,
          isStale: false,
          sourceCount: parsed.sourceCount,
          skippedCount: parsed.skippedRows + deletedCount,
          results: repositories,
          metadata: {
            provider: 'GitHub REST API',
            verifiedCount: statuses.filter((status) => status === 'verified').length,
            cachedCount: statuses.filter((status) => status === 'cached').length,
            staleCount: statuses.filter((status) => status === 'stale').length,
            unavailableCount: statuses.filter((status) => status === 'unavailable' || status === 'rate_limited').length,
            rateLimitResetAt: retryAt ? new Date(retryAt).toISOString() : null,
            warnings: metadataWarning(statuses, retryAt),
          },
        };

        const stored = { response, fetchedAtMs: Date.parse(pageFetchedAt) };
        pageCache.set(period, stored);
        return response;
      } catch (error) {
        if (oldCache) {
          return cachedSnapshot(oldCache, {
            stale: true,
            reason: error instanceof Error ? error.message : 'The source could not be refreshed.',
          });
        }
        throw error;
      }
    })();

    pageInFlight.set(period, request);
    try {
      return await request;
    } finally {
      pageInFlight.delete(period);
    }
  }

  return {
    async getTrending(period, { force = false } = {}) {
      if (!PERIODS[period]) {
        throw new ProviderError('Choose daily, weekly, or monthly trending.', { code: 'INVALID_PERIOD', status: 400 });
      }
      return loadPeriod(period, force);
    },
  };
}
