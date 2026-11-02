import test from 'node:test';
import assert from 'node:assert/strict';
import {isRetryableError, getFetchCandidates, searchQueryVariants} from '../src/scraper.js';

test('also searches the ampersand spelling of "and" queries', () => {
	assert.deepEqual(searchQueryVariants('Avaraachan and Sons 2026'), [
		'Avaraachan and Sons 2026',
		'Avaraachan & Sons 2026',
	]);
	assert.deepEqual(searchQueryVariants('Avaraachan & Sons 2026'), ['Avaraachan & Sons 2026']);
	assert.deepEqual(searchQueryVariants('Drishyam 3'), ['Drishyam 3']);
});

test('recognizes connection reset errors as retryable', () => {
	assert.equal(isRetryableError(new Error('read ECONNRESET')), true);
	assert.equal(isRetryableError(new Error('socket hang up')), true);
	assert.equal(isRetryableError(new Error('HTTP 500 from server')), false);
});

test('builds fallback URL candidates when the configured mirror fails', () => {
	const candidates = getFetchCandidates('https://www.1tamilmv.durban/index.php?/topic/1/', 'https://www.1tamilmv.durban');
	assert.deepEqual(candidates, [
		'https://www.1tamilmv.durban/index.php?/topic/1/',
		'https://www.1tamilmv.style/index.php?/topic/1/',
		'https://www.1tamilmv.cards/index.php?/topic/1/',
	]);
});
