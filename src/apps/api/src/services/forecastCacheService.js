const CACHE_TTL_MS = 2 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;

const queryCache = new Map();

function isExpired(entry) {
  return !entry || entry.expiresAt <= Date.now();
}

function pruneExpired() {
  for (const [key, entry] of queryCache.entries()) {
    if (isExpired(entry)) {
      queryCache.delete(key);
    }
  }
}

function evictOldest() {
  if (queryCache.size < MAX_CACHE_ENTRIES) {
    return;
  }

  const oldestKey = queryCache.keys().next().value;
  if (oldestKey) {
    queryCache.delete(oldestKey);
  }
}

export const ForecastCacheService = {
  get(key) {
    const entry = queryCache.get(key);

    if (isExpired(entry)) {
      queryCache.delete(key);
      return null;
    }

    return entry.value;
  },

  set(key, value) {
    pruneExpired();
    evictOldest();
    queryCache.set(key, {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS
    });
  },

  clear() {
    queryCache.clear();
  }
};
