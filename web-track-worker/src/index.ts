/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { sign } from '@tsndr/cloudflare-worker-jwt';

function withCors(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set('Access-Control-Allow-Origin', '*');
	headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
	return new Response(response.body, {
		...response,
		headers,
	});
}

async function generateBQAccessToken(env: Env): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const claim = {
		iss: env.CLIENT_EMAIL,
		scope: 'https://www.googleapis.com/auth/bigquery',
		aud: 'https://oauth2.googleapis.com/token',
		iat: now,
		exp: now + 3600,
	};
	const key = env.PRIVATE_KEY.replace(/\\n/g, '\n');
	const jwt = await sign(claim, key, {
		algorithm: 'RS256',
	});
	const response = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
	});
	const { access_token } = (await response.json()) as { access_token: string };
	return access_token;
}

async function isTableExists(env: Env, accessToken: string, datasetId: string): Promise<boolean> {
	const tableId = 'events';
	const response = await fetch(
		`https://bigquery.googleapis.com/bigquery/v2/projects/${env.PROJECT_ID}/datasets/${datasetId}/tables/${tableId}`,
		{
			headers: { Authorization: `Bearer ${accessToken}` },
		}
	);
	return response.status === 200;
}

async function createTable(env: Env, accessToken: string, datasetId: string): Promise<Boolean> {
	const tableId = 'events';

	if (await isTableExists(env, accessToken, datasetId)) {
		return true;
	}

	const schema = {
		tableReference: {
			projectId: env.PROJECT_ID,
			datasetId,
			tableId,
		},
		schema: {
			fields: [
				{ name: 'event_type', type: 'STRING', mode: 'REQUIRED' },
				{ name: 'data', type: 'JSON', mode: 'REQUIRED' },
				{ name: 'timestamp', type: 'TIMESTAMP', mode: 'REQUIRED' },
			],
		},
		timePartitioning: {
			type: 'DAY',
			field: 'timestamp',
		},
		clustering: {
			fields: ['event_type'],
		},
	};

	const response = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${env.PROJECT_ID}/datasets/${datasetId}/tables`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(schema),
	});

	return response.status === 200 || response.status === 201;
}

async function hashSessionId(cfIp:string, userAgent:string) {
	const encoder = new TextEncoder();
	const data = encoder.encode(cfIp + userAgent);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	return hashHex;
  }

async function addData(
	request: Request,
	env: Env,
	accessToken: string,
	datasetId: string,
	arr: { event_type: string; json: { [x: string]: any } }[]
): Promise<Response> {
	const tableId = 'events';
	const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${env.PROJECT_ID}/datasets/${datasetId}/tables/${tableId}/insertAll`;

	const rows = arr.map(({ event_type, json }) => ({
		json: {
			event_type,
			json: JSON.stringify(json),
			timestamp: new Date().toISOString(),
		},
	}));
	const payload = { rows };
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(payload),
	});
	if (response.ok) return new Response('Success', { status: 200 });

	return new Response('Somethign went wrong', { status: response.status });
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const { url, method } = request;

		// Handle GET request to root path
		if (method === 'GET' && new URL(url).pathname === '/') {
			return Response.redirect('https://iwebcode.design/', 301);
		}

		// Check if it's a request for common browser assets
		const reqPath = new URL(url).pathname;
		if (reqPath.match(/\.(ico|png|jpg|jpeg)$/) || reqPath.includes('favicon') || reqPath.includes('apple-touch-icon')) {
			return new Response(null, { status: 404 });
		}

		const urlParams = new URLSearchParams(url.split('?')[1]);

		const events = urlParams.get('events') ? JSON.parse(decodeURIComponent(urlParams.get('events')!)) : '';

		let browser = 'Unknown Browser';
		const site_id = urlParams.get('sid')!;
		const country_code = request.cf?.country;
		const city = request.cf?.city;
		const region = request.cf?.region;

		const currentDate = new Date().toISOString().split('T')[0];

		if (events === '' || events.length === 0) {
			// in case no events are received
			return new Response('ok', { status: 200 });
		}
		const userAgent = request.headers.get('User-Agent') ?? '';

		let device_type = 'Unknown Device';

		if (/mobile/i.test(userAgent)) {
			device_type = 'Mobile';
		} else if (/tablet/i.test(userAgent)) {
			device_type = 'Tablet';
		} else if (/desktop/i.test(userAgent) || /windows|macintosh|linux/i.test(userAgent)) {
			device_type = 'Desktop';
		}

		if (/edg/i.test(userAgent)) {
			browser = 'Edge';
		} else if (/chrome|crios|crmo/i.test(userAgent)) {
			browser = 'Chrome';
		} else if (/firefox|fxios/i.test(userAgent)) {
			browser = 'Firefox';
		} else if (/safari/i.test(userAgent)) {
			browser = 'Safari';
		} else if (/msie|trident/i.test(userAgent)) {
			browser = 'Internet Explorer';
		} else if (/opr|opera/i.test(userAgent)) {
			browser = 'Opera';
		} else {
			browser = 'Unknown Browser';
		}

		const payloadArr = [];
		const session_id = hashSessionId(request.headers.get('cf-connecting-ip')??"UNKNOWN_IP",userAgent)

		for (var i = 0; i < events.length; i++) {
			const [event, data] = events[i];
			const formattedData = { ...events[i], browser, user_agent: userAgent, country_code, city, region, device_type,session_id };
			const payload = {
				event_type: event,
				json: {
					...formattedData,
				},
			};
			payloadArr.push(payload);
		}
		const access_token = await generateBQAccessToken(env)
		if(await isTableExists(env,access_token,site_id)){
			await addData(request,env,access_token,site_id,payloadArr)
		}else{
			if(await createTable(env,access_token,site_id)){
				await addData(request,env,access_token,site_id,payloadArr)
			}
		}
		return new Response('OK');
	},
} satisfies ExportedHandler<Env>;
