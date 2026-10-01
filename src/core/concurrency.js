/**
 * Small helpers for running network-bound work in parallel while keeping the
 * steps that must not overlap (e.g. "is this paper new? then create it") in
 * order.
 */

/**
 * Calls `fn` on every element with at most `limit` calls in flight, and
 * returns the results in input order. A rejection is passed on after the
 * calls already running have settled; no new calls are started after it.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapConcurrent(items, limit, fn) {
	const results = new Array(items.length);
	let next = 0;
	let failed = false;
	const worker = async () => {
		while (!failed && next < items.length) {
			const index = next++;
			try {
				results[index] = await fn(items[index], index);
			}
			catch (e) {
				failed = true;
				throw e;
			}
		}
	};
	const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker);
	const settled = await Promise.allSettled(workers);
	const rejected = settled.find((s) => s.status === "rejected");
	if (rejected) throw /** @type {PromiseRejectedResult} */ (rejected).reason;
	return results;
}

/**
 * A queue that runs the functions given to it one at a time, in call order.
 * A failing function does not stop the queue.
 * @returns {<R>(fn: () => Promise<R>) => Promise<R>}
 */
export function serialized() {
	/** @type {Promise<unknown>} */
	let tail = Promise.resolve();
	return (fn) => {
		const run = tail.then(fn);
		tail = run.catch(() => {});
		return run;
	};
}

/**
 * One {@link serialized} queue per key: functions with the same key run one at
 * a time, functions with different keys run independently.
 * @returns {<R>(key: unknown, fn: () => Promise<R>) => Promise<R>}
 */
export function serializedByKey() {
	/** @type {Map<unknown, { queue: ReturnType<typeof serialized>, pending: number }>} */
	const queues = new Map();
	return async (key, fn) => {
		let entry = queues.get(key);
		if (!entry) {
			entry = { queue: serialized(), pending: 0 };
			queues.set(key, entry);
		}
		entry.pending++;
		try {
			return await entry.queue(fn);
		}
		finally {
			if (--entry.pending === 0) queues.delete(key);
		}
	};
}
