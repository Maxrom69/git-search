import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveFilterOptions, filterAndSortRepositories, limitResults, RESULT_LIMITS } from '../src/lib/filterResults.js';

const repositories = [
  {
    rank: 2,
    id: 'acme/api-client',
    fullName: 'Acme/api-client',
    name: 'api-client',
    owner: 'Acme',
    description: 'A fast TypeScript client for public APIs.',
    language: 'TypeScript',
    topics: ['api', 'developer-tools'],
    totalStars: 800,
    forks: 70,
    updatedAt: '2026-10-16T10:00:00Z',
  },
  {
    rank: 1,
    id: 'studio/shipit',
    fullName: 'studio/shipit',
    name: 'shipit',
    owner: 'studio',
    description: 'Deploy open-source apps with a simple workflow.',
    language: 'Go',
    topics: ['deployment', 'open-source'],
    totalStars: 1_200,
    forks: 150,
    updatedAt: '2026-10-14T10:00:00Z',
  },
  {
    rank: 3,
    id: 'team/no-metadata',
    fullName: 'team/no-metadata',
    name: 'no-metadata',
    owner: 'team',
    description: null,
    language: null,
    topics: [],
    totalStars: null,
    forks: null,
    updatedAt: null,
  },
];

test('search matches repository name, owner, and description without case sensitivity', () => {
  assert.deepEqual(filterAndSortRepositories(repositories, { search: 'ACME' }).map(({ id }) => id), ['acme/api-client']);
  assert.deepEqual(filterAndSortRepositories(repositories, { search: 'workflow' }).map(({ id }) => id), ['studio/shipit']);
  assert.deepEqual(filterAndSortRepositories(repositories, { search: 'no-metadata' }).map(({ id }) => id), ['team/no-metadata']);
});

test('language, topic, and minimum total-star filters combine', () => {
  const result = filterAndSortRepositories(repositories, {
    language: 'typescript',
    topic: 'DEVELOPER-TOOLS',
    minStars: '500',
  });
  assert.deepEqual(result.map(({ id }) => id), ['acme/api-client']);
  assert.deepEqual(filterAndSortRepositories(repositories, { minStars: '900' }).map(({ id }) => id), ['studio/shipit']);
  assert.deepEqual(filterAndSortRepositories(repositories, { topic: 'missing-topic' }), []);
});

test('sort modes put unavailable metrics last and keep rank as a stable tie-breaker', () => {
  assert.deepEqual(filterAndSortRepositories(repositories, { sortBy: 'stars' }).map(({ id }) => id), [
    'studio/shipit', 'acme/api-client', 'team/no-metadata',
  ]);
  assert.deepEqual(filterAndSortRepositories(repositories, { sortBy: 'updated' }).map(({ id }) => id), [
    'acme/api-client', 'studio/shipit', 'team/no-metadata',
  ]);
  assert.deepEqual(filterAndSortRepositories(repositories, { sortBy: 'forks' }).map(({ id }) => id), [
    'studio/shipit', 'acme/api-client', 'team/no-metadata',
  ]);
  assert.deepEqual(filterAndSortRepositories(repositories).map(({ id }) => id), [
    'studio/shipit', 'acme/api-client', 'team/no-metadata',
  ]);
});

test('Top 5, 10, 15, and 20 controls return exactly the selected number when available', () => {
  const many = Array.from({ length: 23 }, (_, index) => ({ rank: index + 1, id: `repo-${index + 1}` }));
  assert.deepEqual(RESULT_LIMITS, [5, 10, 15, 20]);
  for (const limit of RESULT_LIMITS) {
    assert.equal(limitResults(many, limit).length, limit);
  }
  assert.equal(limitResults(many.slice(0, 7), 10).length, 7);
  assert.equal(limitResults(many, 999).length, 20);
});

test('filter choices are derived only from the currently verified feed', () => {
  const options = deriveFilterOptions(repositories);
  assert.deepEqual(options.languages, ['Go', 'TypeScript']);
  assert.deepEqual(options.topics, ['api', 'deployment', 'developer-tools', 'open-source']);
});
