// Settings nearly every request reads (the accounts, the clubs), kept in
// memory for a few seconds per server instance instead of downloaded each
// time. Writes from this instance clear the copy at once; another instance
// sees a change within `ttlMs`. Each caller gets its own copy to change.

export function hot<T>(load: () => Promise<T>, ttlMs = 20_000) {
  let value: Promise<T> | null = null;
  let at = 0;
  const get = async (): Promise<T> => {
    if (!value || Date.now() - at >= ttlMs) {
      at = Date.now();
      const loading = load();
      value = loading;
      // A failed read isn't kept.
      loading.catch(() => {
        if (value === loading) value = null;
      });
    }
    return structuredClone(await value);
  };
  return Object.assign(get, {
    forget: () => {
      value = null;
    },
  });
}
