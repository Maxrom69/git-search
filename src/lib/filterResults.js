export const RESULT_LIMITS = Object.freeze([5, 10, 15, 20]);

const normalize = (value) => String(value ?? '').trim().toLocaleLowerCase();

export function filterAndSortRepositories(repositories, filters = {}) {
  const search = normalize(filters.search);
  const language = normalize(filters.language);
  const topic = normalize(filters.topic);
  const minStars = filters.minStars === '' || filters.minStars === null || filters.minStars === undefined
    ? null
    : Number(filters.minStars);
  const sortBy = filters.sortBy ?? 'rank';

  const matches = repositories.filter((repository) => {
    if (search) {
      const searchable = `${repository.name} ${repository.fullName} ${repository.owner} ${repository.description ?? ''}`;
      if (!normalize(searchable).includes(search)) return false;
    }

    if (language && normalize(repository.language) !== language) return false;
    if (topic && !(repository.topics ?? []).some((entry) => normalize(entry) === topic)) return false;
    if (minStars !== null && Number.isFinite(minStars)) {
      if (!Number.isFinite(repository.totalStars) || repository.totalStars < minStars) return false;
    }
    return true;
  });

  const compareNumber = (left, right, key) => {
    const leftValue = Number.isFinite(left[key]) ? left[key] : null;
    const rightValue = Number.isFinite(right[key]) ? right[key] : null;
    if (leftValue === null && rightValue === null) return left.rank - right.rank;
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    return rightValue - leftValue || left.rank - right.rank;
  };

  matches.sort((left, right) => {
    if (sortBy === 'stars') return compareNumber(left, right, 'totalStars');
    if (sortBy === 'updated') {
      const leftDate = Date.parse(left.updatedAt ?? '');
      const rightDate = Date.parse(right.updatedAt ?? '');
      const leftValid = Number.isFinite(leftDate);
      const rightValid = Number.isFinite(rightDate);
      if (!leftValid && !rightValid) return left.rank - right.rank;
      if (!leftValid) return 1;
      if (!rightValid) return -1;
      return rightDate - leftDate || left.rank - right.rank;
    }
    if (sortBy === 'forks') return compareNumber(left, right, 'forks');
    return left.rank - right.rank;
  });

  return matches;
}

export function limitResults(repositories, limit) {
  const numericLimit = Number(limit);
  const safeLimit = RESULT_LIMITS.includes(numericLimit) ? numericLimit : RESULT_LIMITS.at(-1);
  return repositories.slice(0, safeLimit);
}

export function deriveFilterOptions(repositories) {
  const languages = new Set();
  const topics = new Set();

  for (const repository of repositories) {
    if (typeof repository.language === 'string' && repository.language.trim()) {
      languages.add(repository.language.trim());
    }
    for (const topic of repository.topics ?? []) {
      if (typeof topic === 'string' && topic.trim()) topics.add(topic.trim());
    }
  }

  const sortOptions = (values) => [...values].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
  return { languages: sortOptions(languages), topics: sortOptions(topics) };
}
