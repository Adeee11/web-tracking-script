export class SiteQuota implements DurableObject {
	private storage: DurableObjectStorage;

	constructor(private state: DurableObjectState, env: Env) {
		this.storage = state.storage;
	}
	async fetch(request: Request): Promise<Response> {
		const { site_id, event_type } = await request.json<{ site_id: string; event_type: string }>();

		// Only enforce quota for page_view events
		if (event_type !== 'page_view') {
			return new Response('ok', { status: 200 });
		}

		const now = new Date();
		const monthKey = `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}`;
		const key = `quota:${site_id}:${monthKey}`;

		const count = (await this.storage.get<number>(key)) || 0;

		if (count >= 100000) {
			return new Response('Monthly limit reached for this site', { status: 429 });
		}

		await this.storage.put(key, count + 1);

		return new Response('ok', { status: 200 });
	}
	alarm?(alarmInfo?: AlarmInvocationInfo): void | Promise<void> {
		throw new Error('Method not implemented.');
	}
	webSocketMessage?(ws: WebSocket, message: string | ArrayBuffer): void | Promise<void> {
		throw new Error('Method not implemented.');
	}
	webSocketClose?(ws: WebSocket, code: number, reason: string, wasClean: boolean): void | Promise<void> {
		throw new Error('Method not implemented.');
	}
	webSocketError?(ws: WebSocket, error: unknown): void | Promise<void> {
		throw new Error('Method not implemented.');
	}
}
