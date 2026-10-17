import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';

function makeRepositories(period = 'daily') {
  return Array.from({ length: 20 }, (_, index) => {
    const rank = index + 1;
    const featured = index === 0;
    const deploy = index === 1;
    const owner = featured ? 'acme' : deploy ? 'octo' : `team-${rank}`;
    const name = featured ? 'audio-workbench' : deploy ? 'shipit-pipelines' : `project-${rank}`;
    return {
      id: `${owner}/${name}`,
      rank,
      sourceRank: rank,
      owner,
      name,
      fullName: `${owner}/${name}`,
      description: featured
        ? 'Open-source audio workflow toolkit for speech teams.'
        : deploy
          ? 'Deploy repeatable pipelines for public APIs.'
          : `A real-world developer project number ${rank}.`,
      language: featured ? 'TypeScript' : deploy ? 'Python' : rank % 2 ? 'TypeScript' : 'Rust',
      totalStars: 1_000 + index * 100,
      starsGained: 500 - index * 7,
      starsGainedPeriod: period,
      forks: 200 - index * 4,
      updatedAt: new Date(Date.parse('2026-10-17T12:00:00Z') - index * 86_400_000).toISOString(),
      topics: featured ? ['audio', 'developer-tools'] : deploy ? ['api', 'deployment'] : ['open-source'],
      topicsAvailable: true,
      homepage: featured ? 'https://example.org/audio-workbench' : null,
      repositoryUrl: `https://github.com/${owner}/${name}`,
      totalStarsSource: 'GitHub REST API',
      starsGainedSource: 'GitHub Trending',
      forksSource: 'GitHub REST API',
      languageSource: 'GitHub REST API',
      metadataStatus: 'verified',
      metadataVerifiedAt: '2026-10-17T12:00:00.000Z',
      metadataCacheAgeMs: 0,
    };
  });
}

function makeSnapshot(period = 'daily', overrides = {}) {
  return {
    period,
    source: 'GitHub Trending',
    sourceUrl: `https://github.com/trending?since=${period}`,
    rankingMethod: 'Sorted by period stars gained.',
    fetchedAt: '2026-10-17T12:00:00.000Z',
    servedFromCache: false,
    cacheAgeMs: 0,
    isStale: false,
    sourceCount: 20,
    skippedCount: 0,
    results: makeRepositories(period),
    metadata: { warnings: [], verifiedCount: 20, cachedCount: 0, staleCount: 0, unavailableCount: 0 },
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function installLiveFixture(overridesByPeriod = {}) {
  const fetchMock = vi.fn(async (requestUrl) => {
    const url = new URL(requestUrl, 'http://localhost');
    const period = url.searchParams.get('period') ?? 'daily';
    return jsonResponse(overridesByPeriod[period] ?? makeSnapshot(period));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function renderLoadedApp() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText('Open-source audio workflow toolkit for speech teams.');
  return user;
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  window.localStorage.clear();
  document.documentElement.dataset.theme = 'dark';
  installLiveFixture();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('GitHub Trending Apps Explorer controls', () => {
  it('loads live period data and switches between daily, weekly, and monthly', async () => {
    const user = await renderLoadedApp();
    const fetchMock = globalThis.fetch;

    expect(screen.getAllByRole('article')).toHaveLength(10);
    await user.click(screen.getByRole('button', { name: /Weekly/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('period=weekly'), expect.any(Object)));
    expect(await screen.findByRole('heading', { name: /Trending projects/ })).toBeTruthy();
    expect(window.location.search).toContain('period=weekly');

    await user.click(screen.getByRole('button', { name: /Monthly/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('period=monthly'), expect.any(Object)));
    expect(window.location.search).toContain('period=monthly');
    expect(screen.getByRole('button', { name: /Monthly/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows exactly Top 5, 10, 15, or 20 available results', async () => {
    const user = await renderLoadedApp();
    expect(screen.getAllByRole('article')).toHaveLength(10);

    for (const amount of [5, 10, 15, 20]) {
      await user.click(screen.getByRole('button', { name: String(amount) }));
      await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(amount));
    }
  });

  it('combines repository search, language, topic, and minimum-star filters', async () => {
    const user = await renderLoadedApp();
    const search = screen.getByRole('searchbox', { name: /Search repositories by name, owner, or description/i });
    await user.type(search, 'repeatable');
    await user.selectOptions(screen.getByRole('combobox', { name: /Filter by programming language/i }), 'Python');
    await user.selectOptions(screen.getByRole('combobox', { name: /Filter by GitHub topic/i }), 'api');
    const minimum = screen.getByRole('spinbutton', { name: /Minimum total stars/i });
    await user.type(minimum, '1100');

    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(1);
    expect(cards[0].getAttribute('aria-label')).toBe('Rank 2: octo/shipit-pipelines');
    expect(screen.getByText(/Only 1 project matches these filters/)).toBeTruthy();
    expect(window.location.search).toContain('q=repeatable');
    expect(window.location.search).toContain('language=Python');
    expect(window.location.search).toContain('topic=api');
    expect(window.location.search).toContain('minStars=1100');
  });

  it('supports sorting, clear filters, and a useful empty result state', async () => {
    const user = await renderLoadedApp();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort results' }), 'stars');
    expect(screen.getAllByRole('article')[0].getAttribute('aria-label')).toBe('Rank 20: team-20/project-20');

    const search = screen.getByRole('searchbox', { name: /Search repositories/i });
    await user.type(search, 'there-is-no-matching-project');
    expect(await screen.findByText('No projects match these filters.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Clear \d+ filters?/i }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(10));
  });

  it('refreshes from the server, preserves repository links, and toggles the theme', async () => {
    const user = await renderLoadedApp();
    const fetchMock = globalThis.fetch;
    const repoLink = screen.getAllByRole('link', { name: /audio-workbench/i })[0];
    expect(repoLink.getAttribute('href')).toBe('https://github.com/acme/audio-workbench');
    expect(repoLink.getAttribute('target')).toBe('_blank');
    expect(screen.getByRole('link', { name: /Website/i }).getAttribute('href')).toBe('https://example.org/audio-workbench');

    await user.click(screen.getByRole('button', { name: /Switch to light theme/i }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem('github-trending-theme')).toBe('light');

    await user.click(screen.getByRole('button', { name: /Refresh data/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('force=1'), expect.any(Object)));
  });

  it('supports the Ctrl/Command+K search shortcut and reports stale cached data', async () => {
    const stale = makeSnapshot('daily', { isStale: true, servedFromCache: true, staleReason: 'GitHub could not be reached.' });
    installLiveFixture({ daily: stale });
    await renderLoadedApp();
    const search = screen.getByRole('searchbox', { name: /Search repositories/i });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(document.activeElement).toBe(search);
    expect(screen.getByText('Showing the last successful sync.')).toBeTruthy();
    expect(screen.getByText(/GitHub could not be reached/)).toBeTruthy();
  });

  it('shows a retry action when the source is rate limited, then recovers on retry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        error: {
          code: 'TRENDING_RATE_LIMITED',
          message: 'GitHub Trending is temporarily refusing requests. Please wait and retry.',
          retryAt: '2026-10-17T13:30:00.000Z',
        },
      }, 429))
      .mockResolvedValueOnce(jsonResponse(makeSnapshot('daily')));
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText('We couldn’t refresh GitHub Trending.')).toBeTruthy();
    expect(screen.getByText(/temporarily refusing requests/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Retry request' }));
    expect(await screen.findByText('Open-source audio workflow toolkit for speech teams.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('displays the source warning when repository metadata is rate limited', async () => {
    const limited = makeSnapshot('daily', {
      metadata: {
        warnings: ['GitHub REST API metadata is rate limited. Period growth remains sourced from GitHub Trending.'],
        verifiedCount: 0,
        cachedCount: 0,
        staleCount: 0,
        unavailableCount: 20,
      },
    });
    installLiveFixture({ daily: limited });
    await renderLoadedApp();
    expect(screen.getByText(/GitHub REST API metadata is rate limited/)).toBeTruthy();

    const firstCard = screen.getAllByRole('article')[0];
    expect(within(firstCard).getByText('total stars')).toBeTruthy();
  });
});
