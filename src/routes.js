import express from 'express';
import xml from 'xml';
import {XMLBuilder, XMLParser} from 'fast-xml-parser';
import {getConfig, updateConfig} from './db.js';
import {GLOBAL_SETTINGS} from './config.js';
import {
	searchMovies,
	scrapTorrents,
	hasNonEnglishCharacters,
} from './scraper.js';
import {createRssFeed, torznabTest, noTopics} from './torznab.js';

const router = new express.Router();

const lastApiInfo = {
	fullQuery: '-',
	requestUrl: '-',
	responseLength: 0,
	status: null,
	error: null,
	updatedAt: null,
};

const refreshLastApiInfo = ({
	fullQuery = '-',
	requestUrl = '-',
	status = null,
	responseLength = 0,
	error = null,
}) => {
	lastApiInfo.fullQuery = fullQuery;
	lastApiInfo.requestUrl = requestUrl;
	lastApiInfo.responseLength = responseLength;
	lastApiInfo.status = status;
	lastApiInfo.error = error;
	lastApiInfo.updatedAt = new Date().toISOString();
};

const processKeyword = key => {
	const searchKey = key?.toString()?.trim() || '';
	return searchKey ? encodeURIComponent(searchKey) : '';
};

const slugify = s => {
	const base = String(s || '')
		.toLowerCase()
		.replace(/[^a-z\d\s-]+/g, ' ')
		.trim()
		.replace(/\s+/g, '-')
		.slice(0, 80);
	return base || 't';
};

const getTopicUrl = (tid, title, tamilMvUrl) => `${tamilMvUrl}/index.php?/topic/${tid}-${slugify(title)}/`;

// GET / - Manager Settings Page
router.get('/', async (request, response, next) => {
	try {
		const loadSettings = await getConfig();
		if (!loadSettings) {
			return response.status(500).send('Database configuration not loaded.');
		}

		const settings = {
			...loadSettings,
			customSearch: Boolean(loadSettings.custom_search),
			customSearchOn: Boolean(loadSettings.custom_search),
			customSearchOff: !loadSettings.custom_search,
		};
		const tryUrl = `${loadSettings.tamilMvUrl}/search/?q=${encodeURIComponent(
			loadSettings.custom_search_keyword,
		)}`;

		response.render('index', {...GLOBAL_SETTINGS, tryUrl, ...settings});
	} catch (error) {
		next(error);
	}
});

// POST / - Update Settings
router.post('/', async (request, response, next) => {
	try {
		const previousConfig = await getConfig();
		if (!previousConfig) {
			return response.status(500).send('Database configuration not loaded.');
		}

		const updateSettings = await updateConfig({
			tamilmvUrl: request.body.tamilmv_url || previousConfig.tamilmv_url,
			customSearch: request.body.custom_search_toggle === '1',
			customSearchKeyword:
        request.body.custom_search || previousConfig.custom_search_keyword,
		});

		const loadSettings = await getConfig();
		const settings = {
			...loadSettings,
			customSearch: Boolean(loadSettings.custom_search),
			customSearchOn: Boolean(loadSettings.custom_search),
			customSearchOff: !loadSettings.custom_search,
			...(updateSettings
				? {
					savedMessage: 'Settings Saved!',
				}
				: null),
		};
		const tryUrl = `${loadSettings.tamilMvUrl}/search/?q=${encodeURIComponent(
			loadSettings.custom_search_keyword,
		)}`;

		response.render('index', {...GLOBAL_SETTINGS, tryUrl, ...settings});
	} catch (error) {
		next(error);
	}
});

// GET /api - Torznab Proxy RSS endpoint
router.get('/api', async (request, response) => {
	let config;
	try {
		config = await getConfig();
	} catch (dbError) {
		console.error('Failed to read database configuration:', dbError.message);
		refreshLastApiInfo({
			fullQuery: request.query.q?.toString() || '-',
			requestUrl: `${request.protocol}://${request.get('host')}${request.originalUrl}`,
			status: 500,
			responseLength: 0,
			error: dbError.message,
		});
		return response.status(500).json({
			message: 'Database connection failed',
			status: 'FAILED',
		});
	}

	const {tamilMvUrl, ...configs} = config;
	const rawQuery = request.query.q?.toString() || '';
	const baseUrl = request.protocol + '://' + request.get('host');
	const requestUrl = `${request.protocol}://${request.get('host')}${request.originalUrl}`;
	const testMode = request.query.t === 'caps';

	let keyword = processKeyword(rawQuery);
	refreshLastApiInfo({
		fullQuery: rawQuery || '-',
		requestUrl,
		status: null,
		responseLength: 0,
		error: null,
	});
	if (!testMode && !keyword && configs.custom_search) {
		keyword = encodeURIComponent(configs.custom_search_keyword);
	}
	if (!keyword) {
		keyword = 'drishyam 4';
	}
	console.log('Keyword:', keyword);

	let rssFeed;
	try {
		const searchResults = await searchMovies(keyword);
		try {
			if (testMode) {
				rssFeed = await torznabTest();
			} else if (request.query.offset >= 50) {
				rssFeed = await noTopics(baseUrl);
			} else if (
				configs.custom_search
        && hasNonEnglishCharacters(request.query.q)
			) {
				rssFeed = await noTopics(baseUrl);
			} else {
				const topics = searchResults
					.filter(result => Boolean(result.starter_role))
					.map(result => ({
						url: getTopicUrl(result.tid, result.title, tamilMvUrl),
						title: result.title,
					}));

				if (topics.length > 0) {
					const magnetInfo = await scrapTorrents(topics, keyword);
					rssFeed = magnetInfo.length > 0
						? await createRssFeed(baseUrl, magnetInfo, request.query)
						: await noTopics(baseUrl);
				} else {
					rssFeed = await noTopics(baseUrl);
				}
			}
		} catch (scrapError) {
			console.error('Error fetching topics / scraping torrents:', scrapError.message);
			refreshLastApiInfo({
				fullQuery: rawQuery || '-',
				requestUrl,
				status: 529,
				responseLength: 0,
				error: scrapError.message,
			});
			return response.status(529).json({
				message: 'Could not get topics',
				status: 'FAILED',
			});
		}
	} catch (searchError) {
		console.error(`Error connecting to search API at ${tamilMvUrl}:`, searchError.message);
		refreshLastApiInfo({
			fullQuery: rawQuery || '-',
			requestUrl,
			status: 521,
			responseLength: 0,
			error: searchError.message,
		});
		return response.status(521).json({
			message: `Could not connect to the server ${tamilMvUrl}`,
			status: 'FAILED',
		});
	}

	const parser = new XMLParser({
		ignoreAttributes: false,
		preserveOrder: true,
		cdataPropName: '__cdata',
	});

	const feed = `<?xml version="1.0" encoding="UTF-8" ?>${xml(rssFeed)}`;
	const builder = new XMLBuilder({
		ignoreAttributes: false,
		preserveOrder: true,
		cdataPropName: '__cdata',
		format: true,
	});
	const xmlContent = builder.build(parser.parse(feed));

	refreshLastApiInfo({
		fullQuery: rawQuery || '-',
		requestUrl,
		status: 200,
		responseLength: xmlContent.length,
		error: null,
	});

	response.contentType('Content-Type', 'text/xml');
	return response.send(xmlContent);
});

router.get('/api/last', (request, response) => {
	return response.json(lastApiInfo);
});

export default router;
