/** An iterable whose first `next()` rejects with `error`. Used for work
 *  requested while a connection is unavailable. */
export function failedIterable<T>(error: Error): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]: (): AsyncIterator<T> => ({
      next: () => Promise.reject(error),
    }),
  };
}
