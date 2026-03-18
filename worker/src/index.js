const TOOLS = [
  {
    name: 'add_item',
    description: 'Add a place or activity to the user\'s trip. Use this when the user confirms they want to add something.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Place name' },
        category: { type: 'string', enum: ['eats', 'sleeps', 'spots', 'events', 'transport'] },
        address: { type: 'string', description: 'Full address' },
        time: { type: 'string', description: 'Date/time, e.g. "Mar 15 7pm"' },
        cost: { type: 'string', description: 'Estimated cost, e.g. "$50"' },
        notes: { type: 'string', description: 'Additional notes' },
      },
      required: ['name', 'category'],
    },
  },
  {
    name: 'suggest_items',
    description: 'Suggest multiple places for the user to consider. Use this instead of add_item when recommending options the user hasn\'t explicitly asked to add.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              category: { type: 'string', enum: ['eats', 'sleeps', 'spots', 'events', 'transport'] },
              address: { type: 'string' },
              time: { type: 'string' },
              cost: { type: 'string' },
              notes: { type: 'string' },
              reason: { type: 'string', description: 'Why this place is recommended' },
            },
            required: ['name', 'category'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'get_trip_summary',
    description: 'Get a summary of the current trip including total budget, item counts by category, and date range.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

function buildSystemPrompt(tripContext) {
  const tripName = tripContext?.name || 'No trip loaded';
  const items = tripContext?.items || [];
  const itemsJson = items.length > 0
    ? JSON.stringify(items, null, 2)
    : '(no items yet)';

  return `You are a trip planning assistant for Trip Terminal. You help users plan trips by suggesting places, answering travel questions, and managing their itinerary.

Current trip: ${tripName}
Current items:
${itemsJson}

Guidelines:
- Use suggest_items when recommending places (let the user choose what to add)
- Use add_item only when the user explicitly says to add something specific
- Keep responses concise — this is a chat widget, not an essay
- When suggesting places, include address and estimated cost when possible
- You can reference existing trip items by name
- For budget questions, parse the "cost" field of existing items
- For itinerary optimization, consider item locations and times`;
}

function corsHeaders(origin, allowedOrigin) {
  const allowed = origin === allowedOrigin || (origin && origin.startsWith('http://localhost'));
  return {
    'Access-Control-Allow-Origin': allowed ? origin : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

async function checkDailyCap(env) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `daily:${today}`;
  const count = parseInt(await env.RATE_STORE.get(key) || '0');
  const cap = parseInt(env.DAILY_REQUEST_CAP || '500');
  if (count >= cap) return { allowed: false, count };
  await env.RATE_STORE.put(key, String(count + 1), { expirationTtl: 86400 });
  return { allowed: true, count: count + 1 };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = env.ALLOWED_ORIGIN || 'https://tripterminal.net';
    const headers = corsHeaders(origin, allowedOrigin);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    // Only POST to /api/chat
    const url = new URL(request.url);
    if (url.pathname !== '/api/chat' && url.pathname !== '/') {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    // Check origin
    const originAllowed = origin === allowedOrigin || origin.startsWith('http://localhost');
    if (!originAllowed) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    // Check daily cap
    const { allowed } = await checkDailyCap(env);
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Daily request limit reached. Try again tomorrow.' }), {
        status: 429,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    // Parse request
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    const { messages, tripContext } = body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages array required' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    // Build Anthropic API request
    const apiBody = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: buildSystemPrompt(tripContext),
      tools: TOOLS,
      messages,
    };

    // Call Anthropic API
    try {
      const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(apiBody),
      });

      const result = await apiRes.json();

      if (!apiRes.ok) {
        const status = apiRes.status === 529 || apiRes.status === 503 ? 503 : apiRes.status;
        return new Response(JSON.stringify({ error: result.error?.message || 'Anthropic API error' }), {
          status,
          headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Failed to reach Claude API' }), {
        status: 502,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
  },
};
