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


async function getStatelessIds(request: Request) {
  const now = Math.floor(Date.now() / 1000);
  const visitorBucket = Math.floor(now / (60 * 60 * 24)); // 1-day window
  const sessionBucket = Math.floor(now / (60 * 30)); // 30-minute window

  const cfIp = request.headers.get('cf-connecting-ip') ?? 'UNKNOWN_IP';
  const userAgent = request.headers.get('User-Agent') ?? '';
  const acceptLang = request.headers.get('Accept-Language') ?? '';
  const acceptEnc = request.headers.get('Accept-Encoding') ?? '';

  const fingerprint = cfIp + userAgent + acceptLang + acceptEnc;

  const visitor_id = await hashSessionId(fingerprint + visitorBucket);
  const session_id = await hashSessionId(fingerprint + sessionBucket);

  return { visitor_id, session_id };
}

async function hashSessionId(fingerprint: string) {
	const encoder = new TextEncoder();
	const data = encoder.encode(fingerprint);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
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
			data: JSON.stringify(json),
			timestamp: new Date().toISOString(),
		},
	}));
	const payload = { rows };

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${accessToken}`,
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
			return Response.redirect('https://flooanalytics.com/', 301);
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
		const cfIp = request.headers.get('cf-connecting-ip') ?? 'UNKNOWN_IP';
		const acceptLang = request.headers.get('Accept-Language') ?? '';
		const acceptEnc = request.headers.get('Accept-Encoding') ?? '';
		const fingerprint = cfIp + userAgent + acceptLang + acceptEnc;

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

		const {visitor_id,session_id} = await getStatelessIds(request);

		for (var i = 0; i < events.length; i++) {
			const [event, data] = events[i];
			const formattedData = { ...data, browser, user_agent: userAgent, country_code, city, region, device_type, session_id,visitor_id };
			const payload = {
				event_type: event,
				json: {
					...formattedData,
				},
			};
			payloadArr.push(payload);
		}
		const access_token = await generateBQAccessToken(env);
		await addData(request, env, access_token, `site_${site_id}`, payloadArr);
		return new Response('OK');
	},
} satisfies ExportedHandler<Env>;
