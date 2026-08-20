# Daktela V6 JavaScript Connector

Official JavaScript client for the Daktela V6 REST API. It provides authenticated CRUD requests, query helpers, safe response and error objects, retries, HTTP 429 handling, cancellation, health checks, and memory-efficient pagination.

## Requirements

- Node.js 18 or newer
- A Daktela Contact Centre instance
- An access token with the permissions required by the API operations you call

## Installation

```bash
npm install @daktela/daktela-connector
```

## Quick start

CommonJS:

```js
const Daktela = require('@daktela/daktela-connector');

const client = new Daktela.DaktelaConnector(
    'https://my.daktela.com',
    process.env.ACCESS_TOKEN
);

const response = await client.get('tickets', {
    pagination: Daktela.Pagination(25),
    fields: ['name', 'title', 'stage'],
    sort: Daktela.Sort('edited', Daktela.SortDescending),
    filters: [Daktela.FilterSimple('stage', 'eq', 'OPEN')]
});

console.log(response.data, response.total);
```

ES modules and TypeScript:

```js
import {
    DaktelaConnector,
    FilterSimple,
    Pagination
} from '@daktela/daktela-connector';

const client = new DaktelaConnector(
    'my.daktela.com',
    process.env.ACCESS_TOKEN
);

const response = await client.get('tickets', {
    pagination: Pagination(25),
    filters: [FilterSimple('stage', 'eq', 'OPEN')]
});
```

The package includes TypeScript declarations. It is implemented as CommonJS and can be consumed from both CommonJS and Node.js ES modules.

## Configuration

The constructor accepts the instance URL, an optional access token, and an options object:

```js
const client = new Daktela.DaktelaConnector(instanceUrl, accessToken, {
    authMethod: 'header',
    timeout: 10_000,
    userAgentSuffix: 'MyIntegration/2.0',
    retry: {
        retries: 3,
        baseDelayMs: 100,
        maxDelayMs: 10_000,
        multiplier: 2,
        jitter: true
    },
    rateLimit: {
        autoRetry: true,
        retries: 1,
        maxWaitMs: 60_000,
        defaultDelayMs: 5_000
    }
});
```

Available connector options:

| Option | Description |
|---|---|
| `authMethod` | `header` (default), `cookie`, or `query` |
| `cookieAuth` | Deprecated compatibility option; use `authMethod` |
| `timeout` | Axios timeout in milliseconds; default `0` preserves the existing unlimited timeout |
| `userAgent` | Complete Node.js User-Agent value |
| `userAgentSuffix` | Suffix appended to the connector User-Agent |
| `retry` | `true` or retry configuration; disabled by default |
| `rateLimit` | `true` or HTTP 429 configuration; automatic retry is disabled by default |
| `logger` | Object with optional `debug`, `warn`, and `error` methods |
| `axiosConfig` | Additional configuration used when creating the internal Axios instance |
| `axiosInstance` | Custom Axios instance, useful for adapters, interceptors, proxies, and tests |

Instance URLs without a scheme use HTTPS. Explicit `http://` URLs remain supported for local development. URLs containing credentials, query strings, or fragments are rejected.

### Authentication

Header authentication is the secure default:

```js
const client = new Daktela.DaktelaConnector(instance, token, {
    authMethod: 'header'
});
```

It sends:

```text
X-AUTH-TOKEN: <access token>
```

Query authentication is available for compatibility:

```js
const client = new Daktela.DaktelaConnector(instance, token, {
    authMethod: 'query'
});
```

Query authentication places the token in the URL, where it may be recorded by logs and proxies. Prefer header authentication in production.

Cookie authentication sends a `c_user` cookie header and is intended for Node.js environments:

```js
const client = new Daktela.DaktelaConnector(instance, token, {
    authMethod: 'cookie'
});
```

Browsers do not permit JavaScript to set `Cookie` or `User-Agent` headers. Browser applications should normally use header or query authentication and configure CORS on the Daktela instance appropriately.

## CRUD requests

```js
const created = await client.post('statuses', {
    name: 'integration_ready',
    title: 'Integration ready'
});

const read = await client.get('statuses/integration_ready');

const updated = await client.put('statuses/integration_ready', {
    description: 'Updated by the JavaScript connector'
});

const removed = await client.delete('statuses/integration_ready');
```

POST, PUT, and DELETE continue to accept query parameters in their existing argument positions:

```js
await client.post('tickets', payload, {fields: ['name', 'title']});
await client.put('tickets/ticket_1', payload, {expand: 'user'});
await client.delete('tickets/ticket_1', {force: 1});
```

Use the optional fourth argument of POST and PUT, or the third argument of DELETE, for per-request Axios configuration:

```js
await client.post('tickets', payload, null, {
    signal: abortController.signal,
    timeout: 30_000,
    headers: {'X-Trace-ID': traceId}
});
```

The generic method supports additional HTTP verbs while preserving the same response and error behavior:

```js
await client.request('PATCH', 'tickets/ticket_1', {
    data: {title: 'Changed'},
    params: {fields: ['name', 'title']},
    requestConfig: {signal: abortController.signal}
});
```

Endpoints must be relative to the configured Daktela instance. Absolute URLs and relative path traversal segments are rejected so authentication credentials cannot be redirected to another destination.

## Query helpers

### Pagination

```js
pagination: Daktela.Pagination(100, 200) // take, skip
```

The defaults are exported as `PaginationTake` (`100`) and `PaginationSkip` (`0`).

### Sorting

```js
sort: [
    Daktela.Sort('edited', Daktela.SortDescending),
    Daktela.Sort('title', Daktela.SortAscending)
]
```

### Filters

Simple filters passed through `filters` are combined with AND:

```js
filters: [
    Daktela.FilterSimple('stage', 'eq', 'OPEN'),
    Daktela.FilterSimple('priority', 'gte', 5)
]
```

Nested filter groups can be passed through `filter`:

```js
filter: {
    logic: Daktela.FilterLogicOr,
    filters: [
        Daktela.FilterSimple('stage', 'eq', 'OPEN'),
        Daktela.FilterSimple('stage', 'eq', 'NEW')
    ]
}
```

You can combine `filters` and `filter`. The connector does not mutate the provided arrays or parameter objects.

### Direct query parameters

Use `params` for API parameters not covered by a helper:

```js
await client.get('tickets', {
    params: {
        take: 50,
        skip: 0,
        customParameter: 'value'
    }
});
```

When `params` is supplied, it replaces `fields`, `sort`, `pagination`, `filters`, and `filter` for that request. Query authentication is still added automatically.

## Pagination and large datasets

### Iterate over individual records

`iterate()` is an async generator and keeps only one page in memory:

```js
for await (const ticket of client.iterate('tickets', {
    pageSize: 100,
    maxItems: 1000,
    filters: [Daktela.FilterSimple('stage', 'eq', 'OPEN')]
})) {
    await processTicket(ticket);
}
```

### Iterate over responses page by page

```js
for await (const page of client.pages('tickets', {pageSize: 100})) {
    console.log(page.status, page.total, page.data.length);
}
```

### Read and aggregate all pages

```js
const response = await client.getAll('tickets', {
    pageSize: 100,
    maxItems: 5000
});

console.log(response.data);
```

Pagination stops when any of these conditions is met:

- The API-reported total has been reached.
- A page is shorter than `pageSize`.
- `maxItems` has been reached.
- `maxPages` has been reached; the default safety limit is 999 pages.
- An application or transport error occurs and `stopOnError` is `true`, which is the default.

Set `stopOnError: false` to skip failed pages within the `maxPages` safety bound. A zero `maxItems` value returns immediately without making a request.

## Retries

Retries are disabled by default. Enable them globally:

```js
const client = new Daktela.DaktelaConnector(instance, token, {
    retry: {
        retries: 3,
        baseDelayMs: 100,
        maxDelayMs: 10_000,
        multiplier: 2,
        jitter: true,
        statusCodes: [408, 425, 500, 502, 503, 504],
        retryOnConnectionError: true
    }
});
```

`retries` is the number of additional attempts after the initial request. The default retryable methods are GET, HEAD, OPTIONS, and DELETE. POST and PUT are not retried automatically because repeating them can create duplicate writes.

To opt into retrying a write operation, use the generic request method and explicitly configure its method:

```js
await client.request('POST', 'safe-idempotent-operation', {
    data: payload,
    retry: {
        retries: 2,
        methods: ['post']
    }
});
```

Retry behavior can also be enabled, disabled, or overridden per generic or GET request through the `retry` option.

## HTTP 429 rate limits

Automatic HTTP 429 handling is separate from general retries and disabled by default:

```js
const client = new Daktela.DaktelaConnector(instance, token, {
    rateLimit: {
        autoRetry: true,
        retries: 1,
        maxWaitMs: 60_000,
        defaultDelayMs: 5_000
    }
});
```

The connector understands `Retry-After` as either a number of seconds or an HTTP date. It refuses to wait longer than `maxWaitMs`. A 429 response never falls through to the general retry mechanism, preventing two separate delays from being applied to the same response.

## Cancellation and request configuration

GET and generic requests accept Axios configuration through `requestConfig`:

```js
const controller = new AbortController();

const pending = client.get('tickets', {
    pagination: Daktela.Pagination(100),
    requestConfig: {
        signal: controller.signal,
        timeout: 15_000,
        headers: {'X-Trace-ID': traceId}
    }
});

controller.abort();

await pending;
```

Cancellation also interrupts retry and rate-limit waits. It is reported as a `DaktelaError` with `isCanceled === true`.

Request configuration cannot override the connector's URL, endpoint, method, payload, query parameters, or authentication credentials. Configure those through the corresponding connector arguments.

## Responses

Every successful request returns `DaktelaResponse`:

| Property or method | Description |
|---|---|
| `status` | HTTP status code |
| `data` | Parsed Daktela result object or result data array |
| `total` | API-reported total when present |
| `errors` | Application-level errors returned by the API |
| `headers` | Response headers |
| `isSuccess()` | `true` for HTTP 2xx responses |
| `hasErrors()` | `true` when the API response contains errors |
| `isEmpty()` | `true` for null, empty string, empty array, or empty object data |

A successful HTTP status can still contain application-level errors, so inspect `hasErrors()` when the operation requires it.

## Errors

Transport failures and non-2xx HTTP responses throw `DaktelaError`:

```js
try {
    await client.get('tickets/missing');
} catch (error) {
    if (error instanceof Daktela.DaktelaError) {
        console.error(error.status, error.apiError, error.code);

        if (error.isRateLimit) {
            console.error('Retry after seconds:', error.retryAfter);
        }
        if (error.isCanceled) {
            console.error('Request canceled');
        }
    }
}
```

`DaktelaError` preserves the original error in both `cause` and the backward-compatible `prevError` property. Bodyless and non-JSON errors are handled without masking the original failure.

## Health checks

```js
if (await client.ping()) {
    console.log('Daktela API is reachable');
}

const health = await client.healthCheck();
// Success: {healthy: true, latencyMs: 42, status: 200}
// Failure: {healthy: false, latencyMs: 1001, status: null, error: '...'}
```

Both checks use the `whoim` endpoint. `ping()` returns only a boolean; `healthCheck()` includes latency and failure details.

## Logging and custom Axios clients

Logging is opt-in and never includes the access token:

```js
const client = new Daktela.DaktelaConnector(instance, token, {
    logger: console
});
```

For advanced Axios configuration:

```js
const client = new Daktela.DaktelaConnector(instance, token, {
    axiosConfig: {
        proxy: {host: 'proxy.example.com', port: 8080},
        maxContentLength: 10 * 1024 * 1024
    }
});
```

Or inject an existing Axios instance with adapters or interceptors:

```js
const axios = require('axios');
const axiosInstance = axios.create();
axiosInstance.interceptors.response.use(recordMetrics);

const client = new Daktela.DaktelaConnector(instance, token, {
    axiosInstance
});
```

The connector still enforces its configured Daktela base URL and authentication when using an injected instance.

## Development and tests

Project commands must be run in Docker. The default suite is deterministic and does not require a Daktela instance:

```bash
docker run --rm -v "$PWD:/app" -w /app node:22-alpine npm ci
docker run --rm -v "$PWD:/app" -w /app node:22-alpine npm test
docker run --rm -v "$PWD:/app" -w /app node:22-alpine npm run test:coverage
docker run --rm -v "$PWD:/app" -w /app node:22-alpine npm run test:types
```

Live integration tests are separate because they create, update, and remove a temporary status:

```bash
docker run --rm --env-file .env -v "$PWD:/app" -w /app node:22-alpine \
    npm run test:integration
```

See `.env.example` for the required variables.

## License

Apache License 2.0. See [LICENSE](LICENSE).
