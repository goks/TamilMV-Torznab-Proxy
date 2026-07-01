import test from 'node:test';
import assert from 'node:assert/strict';
import {isRetryableError, getFetchCandidates} from '../src/scraper.js';

test('recognizes connection reset errors as retryable', () => {
	assert.equal(isRetryableError(new Error('read ECONNRESET')), true);
	assert.equal(isRetryableError(new Error('socket hang up')), true);
	assert.equal(isRetryableError(new Error('HTTP 500 from server')), false);
});

test('builds fallback URL candidates when the configured mirror fails', () => {
	const candidates = getFetchCandidates('https://www.1tamilmv.durban/index.php?/topic/1/', 'https://www.1tamilmv.durban');
	assert.deepEqual(candidates, [
		'https://www.1tamilmv.durban/index.php?/topic/1/',
		'https://www.1tamilmv.cards/index.php?/topic/1/',
	]);
});
