import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTrendingService,
  parseCount,
  parseTrendingPage,
  rankTrendingRepositories,
} from '../server/trendingProvider.js';

function row({ owner, name, growth, stars = '10,000', forks = '500', language = 'JavaScript', description = 'A useful open-source project.' }) {
  return `<article class="Box-row">
    <h2><a href="/${owner}/${name}">${owner} / ${name}</a></h2>
    <p>${description}</p>
    <span itemprop="programmingLanguage">${language}</span>
    <a href="/${owner}/${name}/stargazers">${stars}</a>
    <a href="/${owner}/${name}/forks">${forks}</a>
    <span>${growth}</span>
  </article>`;
}

function repositoryPayload(owner, name, overrides = {}) {
  return {
    full_name: `${owner}/${name}`,
    owner: { login: owner },
    description: 'API-verified project description.',
    language: 'TypeScript',
    stargazers_count: 12_345,
    forks_count: 678,
    updated_at: '2026-10-15T12:00:00Z',
    homepage: 'https://example.dev/project',
    topics: ['developer-tools', 'open-source'],
    ...overrides,
  };
}

const htmlResponse = (html) => new Response(html, {
  status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8' },
});
const jsonResponse = (value, status = 200, headers = {}) => new Response(
  typeof value === 'string' ? value : JSON.stringify(value),
  { status, headers: { 'content-type': 'application/json', ...headers } },
);

 test('parseCount handles GitHub-formatted counts and rejects invalid values', () => {
  assert.equal(parseCount('12,345'), 12_345);
  assert.equal(parseCount('1.2k'), 1_200);
  assert.equal(parseCount('2m'), 2_000_000);
  assert.equal(parseCount('not a number'), null);
  assert.equal(parseCount(-2), null);
});

test('the parser reads only the requested period growth and repository metadata', () => {
  const page = row({ owner: 'acme', name: 'fast-tool', growth: '1,234 stars today' });
  const parsed = parseTrendingPage(page, 'daily');
  assert.equal(parsed.sourceCount, 1);
  assert.equal(parsed.skippedRows, 0);
  assert.deepEqual(parsed.repositories[0], {
    owner: 'acme',
    name: 'fast-tool',
    fullName: 'acme/fast-tool',
    key: 'acme/fast-tool',
    sourceRank: 1,
    description: 'A useful open-source project.',
    language: 'JavaScript',
    starsGained: 1_234,
    totalStarsFromPage: 10_000,
    forksFromPage: 500,
  });

  assert.equal(parseTrendingPage(row({ owner: 'acme', name: 'weekly', growth: '57 stars this week' }), 'weekly').repositories[0].starsGained, 57);
  assert.equal(parseTrendingPage(row({ owner: 'acme', name: 'monthly', growth: '4.5k stars this month' }), 'monthly').repositories[0].starsGained, 4_500);
});

test('the parser rejects rows without the selected period growth instead of substituting lifetime stars', () => {
  const page = row({ owner: 'acme', name: 'no-growth', growth: '99,999 total stars' });
  assert.throws(() => parseTrendingPage(page, 'daily'), { code: 'TRENDING_PARSE_ERROR' });
});

test('ranking is based on period stars gained and uses GitHub order for ties', () => {
  const repositories = [
    { fullName: 'a/one', starsGained: 50, sourceRank: 1 },
    { fullName: 'b/two', starsGained: 50, sourceRank: 2 },
    { fullName: 'c/three', starsGained: 81, sourceRank: 3 },
  ];
  const ranked = rankTrendingRepositories(repositories, 2);
  assert.deepEqual(ranked.map(({ fullName, rank }) => [fullName, rank]), [['c/three', 1], ['a/one', 2]]);
});

test('the service verifies repository metadata, caches results, and force refreshes both providers', async () => {
  const page = [
    row({ owner: 'acme', name: 'first', growth: '100 stars today', stars: '2,000' }),
    row({ owner: 'acme', name: 'second', growth: '55 stars today', stars: '1,000' }),
  ].join('');
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    if (url.startsWith('https://github.com/trending')) return htmlResponse(page);
    const slug = url.split('/repos/')[1];
    const [owner, name] = slug.split('/');
    return jsonResponse(repositoryPayload(owner, name));
  };
  const service = createTrendingService({ fetchFn, now: () => Date.parse('2026-10-17T12:00:00Z'), githubToken: 'server-only-test-token' });

  const first = await service.getTrending('daily');
  assert.equal(first.results.length, 2);
  assert.equal(first.results[0].fullName, 'acme/first');
  assert.equal(first.results[0].rank, 1);
  assert.equal(first.results[0].starsGained, 100);
  assert.equal(first.results[0].totalStars, 12_345);
  assert.equal(first.results[0].totalStarsSource, 'GitHub REST API');
  assert.equal(first.results[0].metadataStatus, 'verified');
  assert.equal(first.results[0].homepage, 'https://example.dev/project');
  assert.deepEqual(first.results[0].topics, ['developer-tools', 'open-source']);
  assert.equal(calls.filter(({ url }) => url.includes('/repos/')).length, 2);
  assert.ok(calls.filter(({ url }) => url.includes('/repos/')).every(({ init }) => init.headers.Authorization === 'Bearer server-only-test-token'));

  const cached = await service.getTrending('daily');
  assert.equal(cached.servedFromCache, true);
  assert.equal(cached.results[0].metadataStatus, 'cached');
  assert.equal(calls.length, 3);

  const refreshed = await service.getTrending('daily', { force: true });
  assert.equal(refreshed.servedFromCache, false);
  assert.equal(calls.length, 6);
});

test('homepage fields reject unsafe schemes and embedded credentials', async () => {
  const page = [
    row({ owner: 'acme', name: 'unsafe-protocol', growth: '8 stars today' }),
    row({ owner: 'acme', name: 'credential-url', growth: '4 stars today' }),
  ].join('');
  const service = createTrendingService({
    fetchFn: async (url) => {
      if (url.startsWith('https://github.com/trending')) return htmlResponse(page);
      if (url.endsWith('/acme/unsafe-protocol')) {
        return jsonResponse(repositoryPayload('acme', 'unsafe-protocol', { homepage: 'javascript:alert(1)' }));
      }
      return jsonResponse(repositoryPayload('acme', 'credential-url', { homepage: 'https://user:secret@example.org/' }));
    },
  });

  const result = await service.getTrending('daily');
  assert.deepEqual(result.results.map(({ homepage }) => homepage), [null, null]);
});

test('REST API rate limits do not replace period growth with total stars', async () => {
  const page = [
    row({ owner: 'acme', name: 'one', growth: '42 stars today', stars: '420' }),
    row({ owner: 'acme', name: 'two', growth: '21 stars today', stars: '210' }),
  ].join('');
  let apiCalls = 0;
  const service = createTrendingService({
    fetchFn: async (url) => {
      if (url.startsWith('https://github.com/trending')) return htmlResponse(page);
      apiCalls += 1;
      return jsonResponse('API rate limit exceeded', 403, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
      });
    },
  });

  const result = await service.getTrending('daily');
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].starsGained, 42);
  assert.equal(result.results[0].totalStars, 420);
  assert.equal(result.results[0].totalStarsSource, 'GitHub Trending');
  assert.equal(result.results[0].updatedAt, null);
  assert.equal(result.results[0].topicsAvailable, false);
  assert.equal(result.metadata.warnings.length, 1);
  assert.match(result.metadata.warnings[0], /rate limited/i);
  assert.ok(apiCalls <= 5, 'the service stops starting new API lookups after a rate-limit response');
});

test('deleted repositories are omitted and the remaining ranks stay contiguous', async () => {
  const page = [
    row({ owner: 'acme', name: 'deleted', growth: '100 stars today' }),
    row({ owner: 'acme', name: 'available', growth: '50 stars today' }),
  ].join('');
  const service = createTrendingService({
    fetchFn: async (url) => {
      if (url.startsWith('https://github.com/trending')) return htmlResponse(page);
      if (url.endsWith('/acme/deleted')) return jsonResponse({}, 404);
      return jsonResponse(repositoryPayload('acme', 'available'));
    },
  });

  const result = await service.getTrending('daily');
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].fullName, 'acme/available');
  assert.equal(result.results[0].rank, 1);
  assert.equal(result.skippedCount, 1);
});

test('GitHub Trending HTTP rate limits return a retryable provider error', async () => {
  const service = createTrendingService({
    fetchFn: async () => new Response('Try again later', { status: 429, headers: { 'retry-after': '30' } }),
  });
  await assert.rejects(service.getTrending('weekly'), (error) => {
    assert.equal(error.code, 'TRENDING_RATE_LIMITED');
    assert.equal(error.status, 429);
    assert.ok(error.retryAt > Date.now());
    return true;
  });
});

test('concurrent requests for one period share the same upstream work', async () => {
  const page = row({ owner: 'acme', name: 'deduplicated', growth: '3 stars today' });
  let pageCalls = 0;
  let apiCalls = 0;
  const service = createTrendingService({
    fetchFn: async (url) => {
      if (url.startsWith('https://github.com/trending')) {
        pageCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return htmlResponse(page);
      }
      apiCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return jsonResponse(repositoryPayload('acme', 'deduplicated'));
    },
  });

  const [first, second] = await Promise.all([
    service.getTrending('daily'),
    service.getTrending('daily'),
  ]);
  assert.equal(pageCalls, 1);
  assert.equal(apiCalls, 1);
  assert.equal(first.results[0].fullName, second.results[0].fullName);
});

test('a failed refresh serves the last successful snapshot with an explicit stale flag', async () => {
  const page = row({ owner: 'acme', name: 'cached-tool', growth: '9 stars today' });
  let failPage = false;
  const service = createTrendingService({
    fetchFn: async (url) => {
      if (url.startsWith('https://github.com/trending')) {
        if (failPage) throw new TypeError('network unavailable');
        return htmlResponse(page);
      }
      return jsonResponse(repositoryPayload('acme', 'cached-tool'));
    },
  });

  const live = await service.getTrending('daily');
  failPage = true;
  const stale = await service.getTrending('daily', { force: true });
  assert.equal(live.isStale, false);
  assert.equal(stale.isStale, true);
  assert.equal(stale.servedFromCache, true);
  assert.equal(stale.results[0].fullName, 'acme/cached-tool');
  assert.equal(stale.results[0].metadataStatus, 'stale');
  assert.match(stale.staleReason, /connect to GitHub/i);
});
