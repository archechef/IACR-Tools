import { test } from "node:test";
import assert from "node:assert/strict";

import { mapConcurrent, serialized, serializedByKey } from "../src/core/concurrency.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("mapConcurrent keeps the input order and never exceeds the limit", async () => {
	let inFlight = 0;
	let maxInFlight = 0;
	const results = await mapConcurrent([30, 5, 20, 1, 10, 15, 2], 3, async (ms, index) => {
		maxInFlight = Math.max(maxInFlight, ++inFlight);
		await delay(ms);
		inFlight--;
		return `${index}:${ms}`;
	});
	assert.deepEqual(results, ["0:30", "1:5", "2:20", "3:1", "4:10", "5:15", "6:2"]);
	assert.equal(maxInFlight, 3);
	assert.deepEqual(await mapConcurrent([], 4, async () => 1), []);
});

test("mapConcurrent stops starting new calls after a failure", async () => {
	const started = [];
	await assert.rejects(mapConcurrent([1, 2, 3, 4, 5], 2, async (n) => {
		started.push(n);
		await delay(5);
		if (n === 1) throw new Error("boom");
	}), /boom/);
	assert.ok(started.length < 5, `started ${started}`);
});

test("serialized runs one function at a time, in call order, past failures", async () => {
	const run = serialized();
	const log = [];
	const task = (name, ms, fail = false) => run(async () => {
		log.push(`start ${name}`);
		await delay(ms);
		log.push(`end ${name}`);
		if (fail) throw new Error(name);
		return name;
	});
	const results = await Promise.allSettled([task("a", 20), task("b", 1, true), task("c", 1)]);
	assert.deepEqual(log, ["start a", "end a", "start b", "end b", "start c", "end c"]);
	assert.deepEqual(results.map((r) => r.status), ["fulfilled", "rejected", "fulfilled"]);
});

test("serializedByKey only orders functions with the same key", async () => {
	const run = serializedByKey();
	const log = [];
	const task = (key, name, ms) => run(key, async () => {
		log.push(`start ${name}`);
		await delay(ms);
		log.push(`end ${name}`);
	});
	await Promise.all([task(1, "a1", 20), task(2, "b", 1), task(1, "a2", 1)]);
	assert.ok(log.indexOf("end b") < log.indexOf("end a1"), "different keys overlap");
	assert.ok(log.indexOf("end a1") < log.indexOf("start a2"), "same key waits");
});
