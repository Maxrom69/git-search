import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownWideNarrow,
  ArrowUpRight,
  Check,
  Clock3,
  Code2,
  ExternalLink,
  Filter,
  GitFork,
  Github,
  LoaderCircle,
  Moon,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  Tag,
  TrendingUp,
  X,
} from 'lucide-react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { deriveFilterOptions, filterAndSortRepositories, limitResults, RESULT_LIMITS } from './lib/filterResults.js';

const PERIODS = [
  { id: 'daily', label: 'Daily', description: 'Today', growth: 'today' },
  { id: 'weekly', label: 'Weekly', description: 'This week', growth: 'this week' },
  { id: 'monthly', label: 'Monthly', description: 'This month', growth: 'this month' },
];
const CLIENT_CACHE_TTL_MS = 60_000;

function readInitialSettings() {
  const params = new URLSearchParams(window.location.search);
  const requestedPeriod = params.get('period');
  const requestedLimit = Number(params.get('limit'));
  const requestedSort = params.get('sort');
  return {
    period: PERIODS.some(({ id }) => id === requestedPeriod) ? requestedPeriod : 'daily',
    limit: RESULT_LIMITS.includes(requestedLimit) ? requestedLimit : 10,
    search: params.get('q') ?? '',
    language: params.get('language') ?? '',
    topic: params.get('topic') ?? '',
    minStars: params.get('minStars') ?? '',
    sortBy: ['rank', 'stars', 'updated', 'forks'].includes(requestedSort) ? requestedSort : 'rank',
  };
}

async function requestTrending(period, force = false, signal) {
  const params = new URLSearchParams({ period });
  if (force) params.set('force', '1');
  const response = await fetch(`/api/trending?${params.toString()}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? `The data request failed (${response.status}).`);
    error.code = payload?.error?.code ?? 'REQUEST_FAILED';
    error.retryAt = payload?.error?.retryAt ?? null;
    error.status = response.status;
    throw error;
  }
  if (!payload || !Array.isArray(payload.results)) {
    throw new Error('The data source returned an invalid response. Please retry.');
  }
  return payload;
}

function formatCount(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat('en-CA').format(value) : 'Unavailable';
}

function formatDateTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Unavailable';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatTimeAgo(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Unavailable';
  const seconds = Math.round((Date.parse(value) - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  const units = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  const [unit, size] = units.find(([, unitSize]) => absolute >= unitSize) ?? ['second', 1];
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.round(seconds / size), unit);
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return 'recently';
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function periodName(period) {
  return PERIODS.find((option) => option.id === period)?.label ?? 'Daily';
}

function metadataDescription(repository) {
  if (repository.metadataStatus === 'verified') return `Repository metadata verified by GitHub REST API at ${formatDateTime(repository.metadataVerifiedAt)}.`;
  if (repository.metadataStatus === 'cached') return `Repository metadata was previously verified by GitHub REST API at ${formatDateTime(repository.metadataVerifiedAt)}.`;
  if (repository.metadataStatus === 'stale' || repository.metadataStatus === 'rate_limited') {
    return repository.metadataVerifiedAt
      ? `Showing GitHub API metadata last verified at ${formatDateTime(repository.metadataVerifiedAt)}.`
      : 'GitHub API metadata could not be verified for this repository.';
  }
  return 'Repository details come from the live GitHub Trending page; additional GitHub API metadata is unavailable.';
}

function MetadataBadge({ repository }) {
  const verified = ['verified', 'cached'].includes(repository.metadataStatus);
  const stale = ['stale', 'rate_limited'].includes(repository.metadataStatus);
  const label = verified
    ? repository.metadataStatus === 'cached' ? 'API verified · cached' : 'API verified'
    : stale
      ? repository.metadataVerifiedAt ? 'API details · earlier sync' : 'API rate limited'
      : 'Trending source only';

  return (
    <span
      className={`metadata-badge${verified ? ' is-verified' : ''}${stale ? ' is-stale' : ''}`}
      title={metadataDescription(repository)}
    >
      {verified ? <ShieldCheck size={13} aria-hidden="true" /> : <Activity size={13} aria-hidden="true" />}
      {label}
    </span>
  );
}

function Metric({ icon: Icon, label, value, title }) {
  return (
    <div className="metric-item" title={title ?? undefined}>
      <span className="metric-icon"><Icon size={14} aria-hidden="true" /></span>
      <div className="metric-copy">
        <span className="metric-value">{value}</span>
        <span className="metric-label">{label}</span>
      </div>
    </div>
  );
}

function ProjectCard({ repository, period }) {
  const growthPeriod = PERIODS.find((option) => option.id === period)?.growth ?? 'today';
  const topicList = (repository.topics ?? []).slice(0, 3);
  const extraTopics = Math.max(0, (repository.topics ?? []).length - topicList.length);
  const totalStarsTitle = repository.totalStarsSource
    ? `${formatCount(repository.totalStars)} stars · ${repository.totalStarsSource}`
    : 'Total star count unavailable';
  const forksTitle = repository.forksSource
    ? `${formatCount(repository.forks)} forks · ${repository.forksSource}`
    : 'Fork count unavailable';

  return (
    <article className="project-card" aria-label={`Rank ${repository.rank}: ${repository.fullName}`}>
      <div className="card-accent" aria-hidden="true" />
      <div className="project-card-main">
        <div className="repo-card-topline">
          <div className="repo-identity">
            <span className="rank-number" aria-label={`Trending rank ${repository.rank}`}>
              {String(repository.rank).padStart(2, '0')}
            </span>
            <div className="repo-heading">
              <a className="repo-name" href={repository.repositoryUrl} target="_blank" rel="noreferrer">
                {repository.name}<ArrowUpRight size={15} aria-hidden="true" />
              </a>
              <span className="repo-owner">by <strong>{repository.owner}</strong></span>
            </div>
          </div>
          <div className="growth-pill" title={`${formatCount(repository.starsGained)} stars gained ${growthPeriod}, from GitHub Trending`}>
            <TrendingUp size={15} aria-hidden="true" />
            <span className="growth-number">+{formatCount(repository.starsGained)}</span>
            <span className="growth-period">{growthPeriod}</span>
          </div>
        </div>

        <p className="repo-description">
          {repository.description || <span className="muted-italic">No description provided by the repository.</span>}
        </p>

        <div className="repo-labels">
          <span className={`language-chip${repository.language ? '' : ' is-muted'}`}>
            <Code2 size={13} aria-hidden="true" />
            {repository.language || 'Language not specified'}
          </span>
          {topicList.map((topic) => (
            <span className="topic-chip" key={topic}><Tag size={11} aria-hidden="true" />{topic}</span>
          ))}
          {extraTopics > 0 && <span className="topic-more">+{extraTopics}</span>}
          {!topicList.length && (
            <span className="topics-unavailable">
              {repository.topicsAvailable ? 'No GitHub topics' : 'Topics unavailable'}
            </span>
          )}
        </div>

        <div className="repo-metrics">
          <Metric icon={Star} label="total stars" value={formatCount(repository.totalStars)} title={totalStarsTitle} />
          <Metric icon={GitFork} label="forks" value={formatCount(repository.forks)} title={forksTitle} />
          <Metric
            icon={Clock3}
            label="last updated"
            value={repository.updatedAt ? formatTimeAgo(repository.updatedAt) : 'Unavailable'}
            title={repository.updatedAt ? `GitHub reports ${formatDateTime(repository.updatedAt)}` : 'Update date unavailable from the GitHub API'}
          />
        </div>
      </div>

      <div className="project-card-footer">
        <MetadataBadge repository={repository} />
        <div className="repo-actions">
          {repository.homepage && (
            <a
              className="text-action"
              href={repository.homepage}
              target="_blank"
              rel="noreferrer"
              title="Project homepage declared in GitHub repository metadata"
            >
              Website <ExternalLink size={13} aria-hidden="true" />
            </a>
          )}
          <a className="repo-action" href={repository.repositoryUrl} target="_blank" rel="noreferrer">
            <Github size={14} aria-hidden="true" />
            Repository
            <ArrowUpRight size={13} aria-hidden="true" />
          </a>
        </div>
      </div>
    </article>
  );
}

function LoadingState() {
  return (
    <div className="loading-grid" role="status" aria-live="polite" aria-label="Loading GitHub trending projects">
      {[0, 1, 2, 3].map((key) => (
        <div className="skeleton-card" key={key}>
          <div className="skeleton shimmer skeleton-heading" />
          <div className="skeleton shimmer skeleton-copy" />
          <div className="skeleton shimmer skeleton-copy short" />
          <div className="skeleton-row"><span className="skeleton shimmer" /><span className="skeleton shimmer" /></div>
        </div>
      ))}
      <span className="sr-only">Fetching live data from GitHub Trending…</span>
    </div>
  );
}

function ErrorState({ error, onRetry, retrying }) {
  return (
    <section className="empty-state error-state" role="alert">
      <div className="empty-icon"><Activity size={22} aria-hidden="true" /></div>
      <p className="eyebrow">SOURCE UNAVAILABLE</p>
      <h3>We couldn’t refresh GitHub Trending.</h3>
      <p>{error?.message ?? 'The GitHub data source did not respond. Your filters are still here—try again in a moment.'}</p>
      {error?.retryAt && <p className="retry-note">Retry information: {formatDateTime(error.retryAt)}</p>}
      <button className="button-primary retry-button" type="button" onClick={onRetry} disabled={retrying}>
        {retrying ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={15} />}
        Retry request
      </button>
    </section>
  );
}

function App() {
  const initial = useMemo(readInitialSettings, []);
  const [period, setPeriod] = useState(initial.period);
  const [limit, setLimit] = useState(initial.limit);
  const [search, setSearch] = useState(initial.search);
  const [language, setLanguage] = useState(initial.language);
  const [topic, setTopic] = useState(initial.topic);
  const [minStars, setMinStars] = useState(initial.minStars);
  const [sortBy, setSortBy] = useState(initial.sortBy);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('github-trending-theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const [responses, setResponses] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const responseCache = useRef(new Map());
  const manualRequest = useRef(null);
  const searchInputRef = useRef(null);

  const activeData = responses[period] ?? null;
  const currentError = loadError?.period === period ? loadError : null;
  const repositories = activeData?.results ?? [];
  const filterOptions = useMemo(() => deriveFilterOptions(repositories), [repositories]);
  const matchingRepositories = useMemo(
    () => filterAndSortRepositories(repositories, { search, language, topic, minStars, sortBy }),
    [repositories, search, language, topic, minStars, sortBy],
  );
  const visibleRepositories = limitResults(matchingRepositories, limit);
  const selectedPeriod = PERIODS.find((option) => option.id === period) ?? PERIODS[0];
  const activeFilterCount = [search.trim(), language, topic, minStars !== '' && Number(minStars) > 0].filter(Boolean).length;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('github-trending-theme', theme);
    } catch {
      // The app still works when local storage is disabled.
    }
  }, [theme]);

  useEffect(() => {
    const handleShortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (period !== 'daily') params.set('period', period);
    if (limit !== 10) params.set('limit', String(limit));
    if (search.trim()) params.set('q', search.trim());
    if (language) params.set('language', language);
    if (topic) params.set('topic', topic);
    if (minStars !== '') params.set('minStars', minStars);
    if (sortBy !== 'rank') params.set('sort', sortBy);
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', nextUrl);
  }, [period, limit, search, language, topic, minStars, sortBy]);

  useEffect(() => {
    const cached = responseCache.current.get(period);
    if (cached && Date.now() - cached.receivedAt < CLIENT_CACHE_TTL_MS) {
      setIsLoading(false);
      setIsRefreshing(false);
      setLoadError(null);
      return undefined;
    }

    const controller = new AbortController();
    let active = true;
    setIsLoading(!cached);
    setIsRefreshing(Boolean(cached));
    setLoadError(null);

    requestTrending(period, false, controller.signal)
      .then((data) => {
        if (!active) return;
        const receivedAt = Date.now();
        responseCache.current.set(period, { data, receivedAt });
        setResponses((previous) => ({ ...previous, [period]: data }));
        setLoadError(null);
      })
      .catch((error) => {
        if (!active || error.name === 'AbortError') return;
        setLoadError({ period, message: error.message, code: error.code, retryAt: error.retryAt });
      })
      .finally(() => {
        if (!active) return;
        setIsLoading(false);
        setIsRefreshing(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [period]);

  async function refreshData() {
    if (isRefreshing) return;
    const targetPeriod = period;
    const controller = new AbortController();
    manualRequest.current = controller;
    setIsRefreshing(true);
    if (!responses[targetPeriod]) setIsLoading(true);
    setLoadError(null);

    try {
      const data = await requestTrending(targetPeriod, true, controller.signal);
      const receivedAt = Date.now();
      responseCache.current.set(targetPeriod, { data, receivedAt });
      setResponses((previous) => ({ ...previous, [targetPeriod]: data }));
      setLoadError(null);
    } catch (error) {
      if (error.name !== 'AbortError') {
        setLoadError({ period: targetPeriod, message: error.message, code: error.code, retryAt: error.retryAt });
      }
    } finally {
      if (manualRequest.current === controller) {
        manualRequest.current = null;
        setIsRefreshing(false);
        setIsLoading(false);
      }
    }
  }

  function clearFilters() {
    setSearch('');
    setLanguage('');
    setTopic('');
    setMinStars('');
    setSortBy('rank');
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#results">Skip to trending projects</a>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="/" aria-label="GitHub Trending Apps Explorer home">
            <span className="brand-mark"><Github size={21} aria-hidden="true" /></span>
            <span className="brand-copy">
              <span className="brand-name">GitHub Trending Apps Explorer</span>
              <span className="brand-kicker">OPEN-SOURCE RADAR</span>
            </span>
          </a>
          <div className="topbar-actions">
            <a className="source-status" href="https://github.com/trending" target="_blank" rel="noreferrer">
              <span className="live-dot" aria-hidden="true" />
              <span>Live GitHub source</span>
              <ArrowUpRight size={13} aria-hidden="true" />
            </a>
            <button
              className="icon-button theme-button"
              type="button"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              onClick={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </header>

      <main className="main-content">
        <section className="hero-panel" aria-labelledby="hero-title">
          <div className="hero-glow hero-glow-one" aria-hidden="true" />
          <div className="hero-glow hero-glow-two" aria-hidden="true" />
          <div className="hero-content">
            <div className="eyebrow hero-eyebrow"><Sparkles size={13} aria-hidden="true" /> THE OPEN-SOURCE PULSE</div>
            <h1 id="hero-title">Find your next<br /><span>favorite build.</span></h1>
            <p>Real projects gaining momentum on GitHub. Follow the stars, explore the source, and find something worth building on.</p>
            <div className="hero-note"><ShieldCheck size={14} aria-hidden="true" /> Period growth from GitHub Trending · no lifetime-star guessing</div>
          </div>
          <div className="hero-graphic" aria-hidden="true">
            <div className="orbit orbit-outer" />
            <div className="orbit orbit-inner" />
            <div className="hero-graphic-core"><Github size={34} /></div>
            <span className="orbit-node node-one"><Star size={13} /></span>
            <span className="orbit-node node-two"><Code2 size={13} /></span>
            <span className="orbit-node node-three"><TrendingUp size={13} /></span>
            <span className="hero-graphic-label">TREND SIGNAL</span>
          </div>
        </section>

        <section className="control-panel" aria-label="Trending project controls">
          <div className="control-row primary-controls">
            <div className="control-group period-control">
              <span className="control-label">TRENDING WINDOW</span>
              <div className="segmented period-segmented" role="group" aria-label="Trending period">
                {PERIODS.map((option) => (
                  <button
                    className={`segment-button${period === option.id ? ' is-active' : ''}`}
                    key={option.id}
                    type="button"
                    aria-pressed={period === option.id}
                    onClick={() => setPeriod(option.id)}
                  >
                    <span>{option.label}</span><small>{option.description}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="control-group limit-control">
              <span className="control-label">SHOW RESULTS</span>
              <div className="segmented limit-segmented" role="group" aria-label="Number of trending results">
                {RESULT_LIMITS.map((amount) => (
                  <button
                    className={`limit-button${limit === amount ? ' is-active' : ''}`}
                    key={amount}
                    type="button"
                    aria-pressed={limit === amount}
                    onClick={() => setLimit(amount)}
                  >
                    {amount}
                  </button>
                ))}
              </div>
              <span className="limit-caption">Top projects</span>
            </div>
          </div>

          <div className="search-row">
            <label className="search-box">
              <Search size={19} aria-hidden="true" />
              <span className="sr-only">Search repositories by name, owner, or description</span>
              <input
                ref={searchInputRef}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search repositories, owners, or ideas..."
                autoComplete="off"
              />
              {search && (
                <button className="clear-search" type="button" aria-label="Clear search" onClick={() => setSearch('')}>
                  <X size={15} aria-hidden="true" />
                </button>
              )}
              <kbd>Ctrl / ⌘ K</kbd>
            </label>
            <button className={`refresh-button${isRefreshing ? ' is-refreshing' : ''}`} type="button" onClick={refreshData} disabled={isRefreshing}>
              <RefreshCw size={16} className={isRefreshing ? 'spin' : ''} aria-hidden="true" />
              <span>{isRefreshing ? 'Refreshing' : 'Refresh data'}</span>
            </button>
          </div>

          <div className="filter-row">
            <div className="filter-intro"><Filter size={15} aria-hidden="true" /><span>FILTERS</span></div>
            <label className="select-field">
              <span className="sr-only">Filter by programming language</span>
              <Code2 size={15} aria-hidden="true" />
              <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                <option value="">All languages</option>
                {language && !filterOptions.languages.some((value) => value.toLowerCase() === language.toLowerCase()) && (
                  <option value={language}>{language} · not in this feed</option>
                )}
                {filterOptions.languages.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="select-field topic-select">
              <span className="sr-only">Filter by GitHub topic</span>
              <Tag size={15} aria-hidden="true" />
              <select value={topic} onChange={(event) => setTopic(event.target.value)}>
                <option value="">All topics</option>
                {topic && !filterOptions.topics.some((value) => value.toLowerCase() === topic.toLowerCase()) && (
                  <option value={topic}>{topic} · not in this feed</option>
                )}
                {filterOptions.topics.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="min-stars-field">
              <Star size={15} aria-hidden="true" />
              <span className="sr-only">Minimum total stars</span>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={minStars}
                onChange={(event) => setMinStars(event.target.value)}
                placeholder="Min stars"
              />
            </label>
            <label className="select-field sort-select">
              <ArrowDownWideNarrow size={15} aria-hidden="true" />
              <span className="sr-only">Sort results</span>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                <option value="rank">Trending rank</option>
                <option value="stars">Total stars</option>
                <option value="updated">Recently updated</option>
                <option value="forks">Most forks</option>
              </select>
            </label>
            {activeFilterCount > 0 && (
              <button className="clear-filters" type="button" onClick={clearFilters}>
                <X size={13} aria-hidden="true" /> Clear {activeFilterCount} {activeFilterCount === 1 ? 'filter' : 'filters'}
              </button>
            )}
          </div>
        </section>

        <section className="overview-row" aria-label="Trending results summary">
          <div className="overview-stat">
            <span className="overview-icon"><Activity size={16} aria-hidden="true" /></span>
            <div><span className="overview-label">MATCHING PROJECTS</span><strong>{activeData ? Math.min(matchingRepositories.length, limit) : '—'}<small> / {activeData ? matchingRepositories.length : '—'}</small></strong></div>
          </div>
          <div className="overview-stat">
            <span className="overview-icon purple"><TrendingUp size={16} aria-hidden="true" /></span>
            <div><span className="overview-label">RANKED BY</span><strong className="overview-text">Stars gained <small>{selectedPeriod.growth}</small></strong></div>
          </div>
          <div className="overview-stat sync-stat">
            <span className={`overview-icon${activeData?.isStale ? ' amber' : ' green'}`}>
              {isRefreshing ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : activeData?.isStale ? <Activity size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
            </span>
            <div>
              <span className="overview-label">LAST SOURCE SYNC</span>
              <strong className="overview-text" title={activeData?.fetchedAt ? formatDateTime(activeData.fetchedAt) : undefined}>
                {activeData?.fetchedAt ? formatTimeAgo(activeData.fetchedAt) : isLoading ? 'Fetching live data' : 'Not synced'}
              </strong>
              <small>{activeData?.isStale ? 'Cached · refresh failed' : activeData?.servedFromCache ? `Cached · ${formatDuration(activeData.cacheAgeMs)}` : activeData ? 'GitHub Trending' : 'Live source'}</small>
            </div>
          </div>
        </section>

        <section className="results-section" id="results" aria-labelledby="results-heading">
          <div className="results-heading-row">
            <div>
              <div className="section-kicker"><span className="section-kicker-line" /> {periodName(period).toUpperCase()} DISCOVERY</div>
              <h2 id="results-heading">Trending projects<span className="heading-period"> / {selectedPeriod.description.toLowerCase()}</span></h2>
            </div>
            <div className="results-heading-meta">
              <span className="results-count"><strong>{visibleRepositories.length}</strong> shown</span>
              <span className="results-count-divider">·</span>
              <span>Top {limit} max</span>
            </div>
          </div>

          {activeData?.isStale && (
            <div className="notice-banner stale-banner" role="status">
              <Activity size={17} aria-hidden="true" />
              <div><strong>Showing the last successful sync.</strong><span>{activeData.staleReason || 'GitHub Trending could not be refreshed.'} Last fetched {formatDateTime(activeData.fetchedAt)}.</span></div>
              <button type="button" onClick={refreshData} disabled={isRefreshing}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
            </div>
          )}

          {activeData?.metadata?.warnings?.map((warning) => (
            <div className="notice-banner metadata-banner" role="status" key={warning}>
              <ShieldCheck size={17} aria-hidden="true" />
              <span>{warning}</span>
            </div>
          ))}

          {currentError && activeData && (
            <div className="notice-banner metadata-banner" role="alert">
              <Activity size={17} aria-hidden="true" />
              <span>{currentError.message} The latest successful data remains visible below.</span>
              <button type="button" onClick={refreshData} disabled={isRefreshing}>Retry</button>
            </div>
          )}

          {isLoading && !activeData ? (
            <LoadingState />
          ) : currentError && !activeData ? (
            <ErrorState error={currentError} onRetry={refreshData} retrying={isRefreshing} />
          ) : activeData && repositories.length === 0 ? (
            <section className="empty-state" role="status">
              <div className="empty-icon"><Github size={21} aria-hidden="true" /></div>
              <p className="eyebrow">NO VERIFIED REPOSITORIES</p>
              <h3>No valid trending rows were returned.</h3>
              <p>The app will not replace missing period-growth data with lifetime stars. Refresh to try the GitHub source again.</p>
              <button className="button-primary retry-button" type="button" onClick={refreshData} disabled={isRefreshing}>
                <RefreshCw size={15} aria-hidden="true" /> Try again
              </button>
            </section>
          ) : visibleRepositories.length > 0 ? (
            <>
              <div className="result-context" aria-live="polite">
                <span><span className="context-dot" /> Live period ranking</span>
                <span>Sorted by {sortBy === 'rank' ? 'stars gained' : sortBy === 'stars' ? 'total stars' : sortBy === 'updated' ? 'recent updates' : 'forks'}</span>
                {activeData?.sourceCount > 0 && <span>{repositories.length} verified feed {repositories.length === 1 ? 'entry' : 'entries'}</span>}
              </div>
              <div className="projects-grid">
                {visibleRepositories.map((repository) => (
                  <ProjectCard key={repository.id} repository={repository} period={period} />
                ))}
              </div>
              {matchingRepositories.length < limit && (
                <p className="count-explanation">
                  {activeFilterCount
                    ? `Only ${matchingRepositories.length} ${matchingRepositories.length === 1 ? 'project matches' : 'projects match'} these filters out of ${repositories.length} available feed entries.`
                    : `GitHub Trending returned ${matchingRepositories.length} valid project${matchingRepositories.length === 1 ? '' : 's'} for this window. The app shows the actual count and does not pad the list.`}
                </p>
              )}
            </>
          ) : (
            <section className="empty-state" role="status">
              <div className="empty-icon"><Search size={21} aria-hidden="true" /></div>
              <p className="eyebrow">NO MATCHES</p>
              <h3>No projects match these filters.</h3>
              <p>Try another search, programming language, or topic—or clear filters to return to the full ranking.</p>
              <button className="button-primary retry-button" type="button" onClick={clearFilters}>
                <X size={15} aria-hidden="true" /> Clear filters
              </button>
            </section>
          )}
        </section>

        <footer className="app-footer">
          <div className="footer-brand"><span className="footer-mark"><Github size={16} aria-hidden="true" /></span><span>Made for the curious builders.</span></div>
          <div className="footer-notes">
            <a href="https://github.com/trending" target="_blank" rel="noreferrer">Source: GitHub Trending <ArrowUpRight size={12} aria-hidden="true" /></a>
            <span>Growth is GitHub’s period-specific stars count; repository metadata is enriched with the GitHub REST API.</span>
            <span>REST API rate limits apply. Missing values are labeled unavailable; no growth estimates are shown.</span>
            <span>GitHub Trending is rendered HTML, not a stable public JSON feed; parser failures are surfaced.</span>
          </div>
        </footer>
      </main>
      <SpeedInsights />
    </div>
  );
}

export default App;
