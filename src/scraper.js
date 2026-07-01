import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import {v5 as uuid} from 'uuid';
import moment from 'moment';
import {getConfig} from './db.js';
import {DEFAULT_TAMILMV_URL, KEYWORDS_TO_EXCLUDE} from './config.js';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/110.0';

export function isRetryableError(error) {
	const message = error?.message?.toLowerCase() || '';
	return ['econnreset', 'socket hang up', 'etimedout', 'timed out', 'networkerror', 'fetch failed', 'temporarily unavailable', '429'].some(token => message.includes(token));
}

export function getFetchCandidates(url, configuredBaseUrl) {
	const seen = new Set();
	const candidates = [];
	const addCandidate = candidate => {
		if (candidate && !seen.has(candidate)) {
			seen.add(candidate);
			candidates.push(candidate);
		}
	};

	addCandidate(url);

	if (!url) {
		return candidates;
	}

	try {
		const parsedUrl = new URL(url);
		const fallbackHosts = ['www.1tamilmv.cards', 'www.1tamilmv.durban'];
		for (const host of fallbackHosts) {
			if (host !== parsedUrl.host) {
				const replacedUrl = new URL(url);
				replacedUrl.host = host;
				addCandidate(replacedUrl.toString());
			}
		}
	} catch {
		// Ignore invalid URLs and keep the original candidate list.
	}

	if (configuredBaseUrl) {
		try {
			const parsedConfiguredUrl = new URL(configuredBaseUrl);
			const fallbackToConfiguredBase = new URL(url);
			fallbackToConfiguredBase.protocol = parsedConfiguredUrl.protocol;
			fallbackToConfiguredBase.host = parsedConfiguredUrl.host;
			addCandidate(fallbackToConfiguredBase.toString());
		} catch {
			// Ignore invalid configured base URLs.
		}
	}

	if (DEFAULT_TAMILMV_URL && DEFAULT_TAMILMV_URL !== configuredBaseUrl) {
		try {
			const parsedDefaultUrl = new URL(DEFAULT_TAMILMV_URL);
			const fallbackToDefaultBase = new URL(url);
			fallbackToDefaultBase.protocol = parsedDefaultUrl.protocol;
			fallbackToDefaultBase.host = parsedDefaultUrl.host;
			addCandidate(fallbackToDefaultBase.toString());
		} catch {
			// Ignore invalid default URLs.
		}
	}

	return candidates;
}

async function fetchWithFallback(urls, options = {}) {
	let lastError;
	for (const candidateUrl of urls) {
		try {
			const response = await fetch(candidateUrl, {
				...options,
				signal: AbortSignal.timeout(15000),
			});

			if (response.ok) {
				return response;
			}

			if (response.status >= 400 && response.status < 500) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			lastError = new Error(`HTTP error! status: ${response.status}`);
		} catch (error) {
			lastError = error;
			if (!isRetryableError(error)) {
				break;
			}
		}
	}

	throw lastError || new Error('Unable to fetch the requested URL.');
}

export function hasNonEnglishCharacters(string_) {
	// eslint-disable-next-line no-control-regex
	const regex = /[^\u0000-\u007F\dA-Za-z .,\-]+/; // eslint-disable-line no-useless-escape
	return regex.test(string_);
}

function cleanTitle(raw) {
	return raw
		.replace(/^www\.[^\s-]+\s*-\s*/i, '')
		.replace(/\s-\s/, ' ')
		.trim();
}

export async function searchMovies(keyword) {
	const config = await getConfig();
	if (!config) {
		throw new Error('Database configuration is not available.');
	}

	const tamilMvUrl = config.tamilMvUrl;
	const searchURL = `${tamilMvUrl}/search/api/search.php?q=${keyword}&priority=1&sort=title_asc&page=1&per_page=100`;
	console.log('Searching...', searchURL);

	try {
		const fetchSearch = await fetchWithFallback(getFetchCandidates(searchURL, tamilMvUrl), {
			headers: {
				'User-Agent': USER_AGENT,
				Referer: searchURL,
			},
		});

		const searchResults = await fetchSearch.json();
		return searchResults?.results || [];
	} catch (error) {
		console.error(`Error in searchMovies for keyword "${keyword}":`, error.message);
		throw error;
	}
}

export async function getMagnetLinks(topicUrl, keyword) {
	const config = await getConfig();
	const tamilMvUrl = config ? config.tamilMvUrl : '';
	console.log('Fetching topic:', topicUrl);

	try {
		const topicBody = await fetchWithFallback(getFetchCandidates(topicUrl, tamilMvUrl), {
			credentials: 'include',
			headers: {
				'User-Agent': USER_AGENT,
				Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
				'Accept-Language': 'en-US,en;q=0.5',
			},
			referrer: `${tamilMvUrl}/search/?q=${keyword}`,
			method: 'GET',
			mode: 'cors',
		});

		const forumTopic = await topicBody.text();
		const $ = cheerio.load(forumTopic);
		const releases = [];

		$('a[data-fileext="torrent"]').each((_, element) => {
			const torrentAnchor = $(element);
			const title = torrentAnchor.text().trim().replace('.torrent', '');
			const torrentPath = torrentAnchor.attr('href');

			// Find the next magnet link after this torrent link
			const magnetLink = torrentAnchor
				.parent()
				.nextAll('a[href^="magnet:"]')
				.first()
				.attr('href')
				|| torrentAnchor
					.nextAll('a[href^="magnet:"]')
					.first()
					.attr('href');

			const sizeMatch = title.match(/(\d+(?:\.\d+)?)\s*(gb|mb)/i);
			let sizeBytes = null;

			if (sizeMatch) {
				const value = Number.parseFloat(sizeMatch[1]);
				const unit = sizeMatch[2].toUpperCase();
				sizeBytes = Math.round(unit === 'GB' ? value * 1024 * 1024 * 1024 : value * 1024 * 1024);
			}

			const publishedDateTime = $('time[datetime]').first().attr('datetime');

			if (!KEYWORDS_TO_EXCLUDE.some(keyword => title.toLowerCase().includes(keyword.toLowerCase()))) {
				releases.push({
					name: cleanTitle(title),
					torrentPath,
					guid: uuid(title, '4d1d290e-e395-4ba3-9ef4-ec90def49826'),
					magnet: magnetLink,
					publishedDate: moment(publishedDateTime)
						.utc()
						.format('ddd, DD MMM YYYY HH:mm:ss ZZ'),
					torrentSize: sizeBytes,
				});
			}
		});

		return releases;
	} catch (error) {
		console.error(`Error fetching/parsing topic ${topicUrl}:`, error.message);
		return [];
	}
}

export async function scrapTorrents(topics, keyword, concurrencyLimit = 3) {
	const torrentCollection = [];
	const validTopics = topics.filter(t => Boolean(t.url));

	for (let i = 0; i < validTopics.length; i += concurrencyLimit) {
		const chunk = validTopics.slice(i, i + concurrencyLimit);
		// eslint-disable-next-line no-await-in-loop
		const chunkResults = await Promise.all(
			chunk.map(topic => getMagnetLinks(topic.url, keyword)),
		);
		torrentCollection.push(...chunkResults);
	}

	return torrentCollection.flat(1);
}
