'use strict';

const http = require('http');
const util = require('util');
const Daktela = require('..');
const {version} = require('../package.json');

function apiResponse(result, status = 200, headers = {}, error = undefined) {
    return {
        status,
        headers,
        data: {result, ...(error === undefined ? {} : {error})}
    };
}

function requestError(message, status = null, data = undefined, headers = {}, code = null) {
    const error = new Error(message);
    error.code = code;
    if (status !== null) {
        error.response = {status, data, headers};
    }
    return error;
}

function fakeAxios(...steps) {
    let index = 0;
    return {
        request: jest.fn(async (config) => {
            const step = steps[Math.min(index, steps.length - 1)];
            index++;
            if (typeof step === 'function') {
                return step(config, index);
            }
            if (step instanceof Error) {
                throw step;
            }
            return step;
        })
    };
}

function connectorWith(client, options = {}) {
    return new Daktela.DaktelaConnector('https://example.daktela.test', 'secret-token', {
        axiosInstance: client,
        ...options
    });
}

async function collect(iterable) {
    const values = [];
    for await (const value of iterable) {
        values.push(value);
    }
    return values;
}

describe('query helpers', () => {
    test('build pagination with defaults and overrides', () => {
        expect(Daktela.Pagination()).toEqual({take: 100, skip: 0});
        expect(Daktela.Pagination(25, 50)).toEqual({take: 25, skip: 50});
    });

    test('build sort and simple filter values', () => {
        expect(Daktela.Sort('created', Daktela.SortDescending)).toEqual({
            field: 'created',
            dir: 'desc'
        });
        expect(Daktela.FilterSimple('stage', 'in', ['OPEN', 'NEW'])).toEqual({
            field: 'stage',
            operator: 'in',
            value: ['OPEN', 'NEW']
        });
    });
});

describe('connector configuration', () => {
    test('normalizes hostnames and preserves explicit HTTP development URLs', () => {
        const httpsClient = new Daktela.DaktelaConnector('example.daktela.test');
        const httpClient = new Daktela.DaktelaConnector('http://localhost:8080//');

        expect(httpsClient.baseUrl).toBe('https://example.daktela.test/api/v6/');
        expect(httpClient.baseUrl).toBe('http://localhost:8080/api/v6/');
    });

    test.each([
        [null, 'non-empty string'],
        ['', 'non-empty string'],
        ['https:/broken.test', 'malformed'],
        ['ftp://example.test', 'HTTP or HTTPS'],
        ['https://user:pass@example.test', 'must not contain credentials'],
        ['https://example.test?debug=1', 'query string or fragment']
    ])('rejects unsafe or invalid instance URL %p', (url, message) => {
        expect(() => new Daktela.DaktelaConnector(url)).toThrow(message);
    });

    test('sets header authentication by default', () => {
        const client = new Daktela.DaktelaConnector('example.test', 'token');
        expect(client.api.defaults.headers['X-AUTH-TOKEN']).toBe('token');
        expect(client.api.defaults.headers['User-Agent']).toBe(
            `@daktela/daktela-connector/${version}`
        );
    });

    test('supports cookie, query, and legacy authentication without mutating inputs', () => {
        const cookie = new Daktela.DaktelaConnector('example.test', 'token', {
            authMethod: 'cookie'
        });
        const query = new Daktela.DaktelaConnector('example.test', 'token', {
            authMethod: 'query'
        });
        const legacy = new Daktela.DaktelaConnector('example.test', 'token', {
            cookieAuth: false
        });
        const params = {custom: 'value'};

        expect(cookie.api.defaults.headers.Cookie).toBe('c_user=token');
        expect(query.buildRequestParams({params}).params).toEqual({
            custom: 'value',
            accessToken: 'token'
        });
        expect(legacy.buildRequestParams({}).params.accessToken).toBe('token');
        expect(params).toEqual({custom: 'value'});
    });

    test('rejects unsupported auth methods and malformed options', () => {
        expect(() => new Daktela.DaktelaConnector('example.test', 'token', {
            authMethod: 'bearer'
        })).toThrow('authMethod');
        expect(() => new Daktela.DaktelaConnector('example.test', 'token', [])).toThrow(
            'options must be an object'
        );
    });

    test('appends a user-agent suffix and accepts Axios creation config', () => {
        const client = new Daktela.DaktelaConnector('example.test', 'token', {
            userAgentSuffix: 'CRM-Sync/2.0',
            timeout: 2500,
            axiosConfig: {maxContentLength: 1024}
        });
        expect(client.api.defaults.headers['User-Agent']).toBe(
            `@daktela/daktela-connector/${version} CRM-Sync/2.0`
        );
        expect(client.api.defaults.timeout).toBe(2500);
        expect(client.api.defaults.maxContentLength).toBe(1024);
    });
});

describe('query construction', () => {
    const client = new Daktela.DaktelaConnector('example.test');

    test('builds fields, sort, pagination, and combined filters', () => {
        const filters = [Daktela.FilterSimple('stage', 'eq', 'OPEN')];
        const nested = {
            logic: Daktela.FilterLogicOr,
            filters: [Daktela.FilterSimple('priority', 'gte', 5)]
        };
        const params = client.buildRequestParams({
            fields: ['name', 'title'],
            sort: Daktela.Sort('edited', Daktela.SortDescending),
            pagination: Daktela.Pagination(50, 10),
            filters,
            filter: nested
        }).params;

        expect(params).toEqual({
            fields: ['name', 'title'],
            sort: {field: 'edited', dir: 'desc'},
            take: 50,
            skip: 10,
            filter: {logic: 'and', filters: [filters[0], nested]}
        });
        expect(filters).toHaveLength(1);
    });

    test('direct params override query helpers and are cloned', () => {
        const direct = {take: 7};
        const built = client.buildRequestParams({
            params: direct,
            fields: ['ignored'],
            pagination: Daktela.Pagination(100)
        }).params;
        built.take = 8;

        expect(built.fields).toBeUndefined();
        expect(direct).toEqual({take: 7});
    });
});

describe('responses and errors', () => {
    test('parses list responses, metadata, and application errors', () => {
        const response = new Daktela.DaktelaResponse(apiResponse(
            {data: [{name: 'one'}], total: 1},
            200,
            {'x-request-id': 'abc'},
            [{message: 'warning'}]
        ));

        expect(response.status).toBe(200);
        expect(response.data).toEqual([{name: 'one'}]);
        expect(response.total).toBe(1);
        expect(response.headers['x-request-id']).toBe('abc');
        expect(response.isSuccess()).toBe(true);
        expect(response.hasErrors()).toBe(true);
        expect(response.isEmpty()).toBe(false);
    });

    test.each([
        [null, true],
        [[], true],
        [{}, true],
        ['', true],
        [0, false],
        [false, false]
    ])('reports empty data correctly for %p', (data, expected) => {
        const response = new Daktela.DaktelaResponse(apiResponse(data));
        expect(response.isEmpty()).toBe(expected);
    });

    test('safely wraps bodyless transport failures', () => {
        const original = requestError('gateway failed', 502, undefined, {
            'retry-after': '3'
        }, 'ERR_BAD_RESPONSE');
        const error = new Daktela.DaktelaError(original);

        expect(error.message).toBe('gateway failed');
        expect(error.status).toBe(502);
        expect(error.code).toBe('ERR_BAD_RESPONSE');
        expect(error.apiError).toBeNull();
        expect(error.retryAfter).toBe(3);
        expect(error.cause).toBe(original);
    });

    test('identifies rate limits and cancellations', () => {
        const limited = new Daktela.DaktelaError(requestError(
            'limited',
            429,
            {error: {message: 'slow down'}},
            {'Retry-After': '0'}
        ));
        const canceled = new Daktela.DaktelaError(requestError(
            'canceled',
            null,
            undefined,
            {},
            'ERR_CANCELED'
        ));

        expect(limited.isRateLimit).toBe(true);
        expect(limited.errors).toEqual([{message: 'slow down'}]);
        expect(canceled.isCanceled).toBe(true);
    });

    test('parses HTTP-date and AxiosHeaders-style retry-after values', () => {
        const future = new Date(Date.now() + 5000).toUTCString();
        const dated = new Daktela.DaktelaError(requestError(
            'limited',
            429,
            {error: []},
            {'retry-after': future}
        ));
        const axiosHeaders = new Daktela.DaktelaError(requestError(
            'limited',
            429,
            {error: []},
            {get: () => '2'}
        ));
        const invalid = new Daktela.DaktelaError(requestError(
            'limited',
            429,
            {error: []},
            {'retry-after': 'not-a-date'}
        ));

        expect(dated.retryAfter).toBeGreaterThanOrEqual(4);
        expect(dated.retryAfter).toBeLessThanOrEqual(5);
        expect(axiosHeaders.retryAfter).toBe(2);
        expect(invalid.retryAfter).toBeNull();
    });
});

describe('request pipeline', () => {
    test('sends a protected generic request through an injected client', async () => {
        const http = fakeAxios(apiResponse({name: 'ticket-1'}, 201));
        const client = connectorWith(http);
        const signal = new AbortController().signal;
        const response = await client.request('POST', '/tickets', {
            data: {title: 'Example'},
            params: {fields: ['name']},
            requestConfig: {
                baseURL: 'https://evil.test/',
                url: 'elsewhere',
                method: 'delete',
                data: {bad: true},
                params: {bad: true},
                headers: {'X-AUTH-TOKEN': 'override', 'X-Trace-ID': 'trace'},
                signal
            }
        });

        expect(response.status).toBe(201);
        expect(http.request).toHaveBeenCalledWith(expect.objectContaining({
            method: 'post',
            url: 'tickets',
            baseURL: 'https://example.daktela.test/api/v6/',
            data: {title: 'Example'},
            params: {fields: ['name']},
            signal,
            allowAbsoluteUrls: false,
            headers: expect.objectContaining({
                'X-AUTH-TOKEN': 'secret-token',
                'X-Trace-ID': 'trace',
                'User-Agent': `@daktela/daktela-connector/${version}`
            })
        }));
    });

    test.each([
        ['https://evil.test/tickets'],
        ['https:%2f%2fevil.test/tickets'],
        ['//evil.test/tickets'],
        ['tickets/../users'],
        ['tickets/%2e%2e/users'],
        ['tickets\\..\\users'],
        ['tickets/%ZZ/users']
    ])('rejects unsafe endpoint %s before sending credentials', async (endpoint) => {
        const http = fakeAxios(apiResponse({}));
        const client = connectorWith(http);
        await expect(client.get(endpoint)).rejects.toThrow(TypeError);
        expect(http.request).not.toHaveBeenCalled();
    });

    test('validates generic request methods and options', async () => {
        const client = connectorWith(fakeAxios(apiResponse({})));
        await expect(client.request('', 'whoim')).rejects.toThrow('HTTP method');
        await expect(client.request('GET  ', 'whoim')).rejects.toThrow('HTTP method');
        await expect(client.request('GET', 'whoim', null)).rejects.toThrow('options');
    });

    test('preserves existing CRUD signatures', async () => {
        const http = fakeAxios(
            apiResponse({name: 'one'}),
            apiResponse({name: 'two'}, 201),
            apiResponse({name: 'three'}),
            apiResponse(null, 204)
        );
        const client = connectorWith(http);

        await client.get('tickets/one', {params: {fields: ['name']}});
        await client.post('tickets', {name: 'two'}, {returnFields: 'name'});
        await client.put('tickets/three', {title: 'Changed'}, {expand: 'user'});
        await client.delete('tickets/four', {force: 1});

        expect(http.request.mock.calls.map(([config]) => config.method)).toEqual([
            'get', 'post', 'put', 'delete'
        ]);
        expect(http.request.mock.calls[1][0]).toEqual(expect.objectContaining({
            data: {name: 'two'},
            params: {returnFields: 'name'}
        }));
    });

    test('retries configured idempotent failures with deterministic backoff', async () => {
        const http = fakeAxios(
            requestError('unavailable', 503, {error: []}),
            apiResponse({ok: true})
        );
        const logger = {debug: jest.fn(), warn: jest.fn(), error: jest.fn()};
        const client = connectorWith(http, {
            retry: {retries: 1, baseDelayMs: 0, jitter: false},
            logger
        });

        const response = await client.get('whoim');

        expect(response.data).toEqual({ok: true});
        expect(http.request).toHaveBeenCalledTimes(2);
        expect(logger.warn).toHaveBeenCalledWith(
            'Retrying Daktela API request',
            expect.objectContaining({status: 503, waitMs: 0})
        );
        const logCalls = [
            ...logger.debug.mock.calls,
            ...logger.warn.mock.calls,
            ...logger.error.mock.calls
        ];
        expect(JSON.stringify(logCalls)).not.toContain('secret-token');
    });

    test('does not retry unsafe methods unless explicitly configured', async () => {
        const failure = requestError('unavailable', 503, {error: []});
        const http = fakeAxios(failure);
        const client = connectorWith(http, {
            retry: {retries: 3, baseDelayMs: 0, jitter: false}
        });

        await expect(client.post('tickets', {title: 'once'})).rejects.toBeInstanceOf(
            Daktela.DaktelaError
        );
        expect(http.request).toHaveBeenCalledTimes(1);
    });

    test('retries connection failures when enabled', async () => {
        const http = fakeAxios(
            requestError('reset', null, undefined, {}, 'ECONNRESET'),
            apiResponse({ok: true})
        );
        const client = connectorWith(http, {
            retry: {retries: 1, baseDelayMs: 0, jitter: false}
        });

        await expect(client.get('whoim')).resolves.toBeInstanceOf(Daktela.DaktelaResponse);
        expect(http.request).toHaveBeenCalledTimes(2);
    });

    test('automatically handles a configured rate limit once', async () => {
        const http = fakeAxios(
            requestError('limited', 429, {error: []}, {'Retry-After': '0'}),
            apiResponse({ok: true})
        );
        const client = connectorWith(http, {
            rateLimit: {autoRetry: true, retries: 1, defaultDelayMs: 0}
        });

        await expect(client.get('whoim')).resolves.toBeInstanceOf(Daktela.DaktelaResponse);
        expect(http.request).toHaveBeenCalledTimes(2);
    });

    test('does not fall through to general retries for an unacceptable 429 wait', async () => {
        const failure = requestError('limited', 429, {error: []}, {'Retry-After': '10'});
        const http = fakeAxios(failure);
        const client = connectorWith(http, {
            rateLimit: {autoRetry: true, retries: 2, maxWaitMs: 5},
            retry: {retries: 2, statusCodes: [429], baseDelayMs: 0, jitter: false}
        });

        await expect(client.get('whoim')).rejects.toMatchObject({
            status: 429,
            retryAfter: 10,
            isRateLimit: true
        });
        expect(http.request).toHaveBeenCalledTimes(1);
    });

    test('cancels during retry backoff', async () => {
        const controller = new AbortController();
        controller.abort();
        const http = fakeAxios(requestError('unavailable', 503, {error: []}));
        const client = connectorWith(http, {
            retry: {retries: 1, baseDelayMs: 100, jitter: false}
        });

        await expect(client.get('whoim', {
            requestConfig: {signal: controller.signal}
        })).rejects.toMatchObject({isCanceled: true, status: 503});
        expect(http.request).toHaveBeenCalledTimes(1);
    });
});

describe('health and pagination', () => {
    test('provides simple and detailed health checks', async () => {
        const healthyHttp = fakeAxios(apiResponse({version: '6'}));
        const failingHttp = fakeAxios(requestError('offline', null, undefined, {}, 'ECONNREFUSED'));
        const healthy = connectorWith(healthyHttp);
        const failing = connectorWith(failingHttp);

        await expect(healthy.ping()).resolves.toBe(true);
        await expect(failing.ping()).resolves.toBe(false);
        await expect(healthy.healthCheck()).resolves.toEqual(expect.objectContaining({
            healthy: true,
            status: 200,
            latencyMs: expect.any(Number)
        }));
        await expect(failing.healthCheck()).resolves.toEqual(expect.objectContaining({
            healthy: false,
            error: 'offline',
            latencyMs: expect.any(Number)
        }));
    });

    test('treats successful HTTP responses with API errors as unhealthy', async () => {
        const http = fakeAxios(apiResponse({version: '6'}, 200, {}, [{message: 'error'}]));
        const client = connectorWith(http);

        await expect(client.ping()).resolves.toBe(false);
        await expect(client.healthCheck()).resolves.toEqual(expect.objectContaining({
            healthy: false,
            status: 200
        }));
    });

    test('iterates exact page boundaries and stops at the API total', async () => {
        const http = fakeAxios((config) => {
            const skip = config.params.skip;
            return apiResponse({
                data: skip === 0 ? [{id: 1}, {id: 2}] : [{id: 3}, {id: 4}],
                total: 4
            });
        });
        const client = connectorWith(http);

        await expect(collect(client.iterate('tickets', {pageSize: 2}))).resolves.toEqual([
            {id: 1}, {id: 2}, {id: 3}, {id: 4}
        ]);
        expect(http.request).toHaveBeenCalledTimes(2);
        expect(http.request.mock.calls.map(([config]) => config.params.skip)).toEqual([0, 2]);
    });

    test('respects maxItems without requesting unnecessary pages', async () => {
        const http = fakeAxios(apiResponse({data: [{id: 1}, {id: 2}], total: 10}));
        const client = connectorWith(http);

        await expect(collect(client.iterate('tickets', {
            pageSize: 2,
            maxItems: 1
        }))).resolves.toEqual([{id: 1}]);
        expect(http.request).toHaveBeenCalledTimes(1);
    });

    test('a zero item limit returns without an API request', async () => {
        const http = fakeAxios(apiResponse({data: [{id: 1}], total: 1}));
        const client = connectorWith(http);

        await expect(collect(client.iterate('tickets', {maxItems: 0}))).resolves.toEqual([]);
        const all = await client.getAll('tickets', {maxItems: 0});
        expect(all.data).toEqual([]);
        expect(all.total).toBe(0);
        expect(http.request).not.toHaveBeenCalled();
    });

    test('getAll aggregates pages into a response and preserves total', async () => {
        const http = fakeAxios((config) => apiResponse({
            data: config.params.skip === 0 ? [{id: 1}, {id: 2}] : [{id: 3}],
            total: 3
        }));
        const client = connectorWith(http);
        const response = await client.getAll('tickets', {pageSize: 2});

        expect(response).toBeInstanceOf(Daktela.DaktelaResponse);
        expect(response.data).toEqual([{id: 1}, {id: 2}, {id: 3}]);
        expect(response.total).toBe(3);
        expect(response.isSuccess()).toBe(true);
    });

    test('supports direct params while injecting page offsets', async () => {
        const http = fakeAxios(apiResponse({data: [], total: 0}));
        const client = connectorWith(http);
        await collect(client.pages('tickets', {
            pageSize: 20,
            params: {fields: ['name']}
        }));

        expect(http.request).toHaveBeenCalledWith(expect.objectContaining({
            params: {fields: ['name'], take: 20, skip: 0}
        }));
    });

    test('can skip a failed page within a bounded pagination run', async () => {
        const http = fakeAxios(
            requestError('temporary', 500, {error: []}),
            apiResponse({data: [], total: 0})
        );
        const client = connectorWith(http);
        const pages = await collect(client.pages('tickets', {
            pageSize: 10,
            maxPages: 2,
            stopOnError: false
        }));

        expect(pages).toHaveLength(1);
        expect(http.request.mock.calls.map(([config]) => config.params.skip)).toEqual([0, 10]);
    });

    test.each([
        [{pageSize: 0}, 'pageSize'],
        [{maxPages: 0}, 'maxPages'],
        [{maxItems: -1}, 'maxItems']
    ])('validates pagination option %p', async (options, message) => {
        const client = connectorWith(fakeAxios(apiResponse({data: []})));
        await expect(collect(client.iterate('tickets', options))).rejects.toThrow(message);
    });
});

describe('hardening', () => {
    function listen(handler) {
        return new Promise((resolve) => {
            const server = http.createServer(handler);
            server.listen(0, '127.0.0.1', () => resolve(server));
        });
    }

    function close(server) {
        return new Promise((resolve) => server.close(resolve));
    }

    test('strips credentials from cross-origin redirects but keeps same-origin ones', async () => {
        const received = [];
        const other = await listen((req, res) => {
            received.push({target: 'other', token: req.headers['x-auth-token'] ?? null});
            res.setHeader('content-type', 'application/json');
            res.end('{"result":{}}');
        });
        const instance = await listen((req, res) => {
            if (req.url.startsWith('/api/v6/away')) {
                res.writeHead(302, {Location: `http://127.0.0.1:${other.address().port}/x`});
                return res.end();
            }
            if (req.url.startsWith('/api/v6/home')) {
                res.writeHead(302, {Location: '/api/v6/landed'});
                return res.end();
            }
            received.push({target: 'instance', token: req.headers['x-auth-token'] ?? null});
            res.setHeader('content-type', 'application/json');
            return res.end('{"result":{}}');
        });
        try {
            const client = new Daktela.DaktelaConnector(
                `http://127.0.0.1:${instance.address().port}`,
                'secret-token'
            );
            await client.get('away');
            await client.get('home');
            expect(received).toEqual([
                {target: 'other', token: null},
                {target: 'instance', token: 'secret-token'}
            ]);
        } finally {
            await close(other);
            await close(instance);
        }
    });

    test.each(['header', 'query'])(
        'never discloses the %s token when an error is serialized or inspected',
        async (authMethod) => {
            const server = await listen((req, res) => {
                res.writeHead(400, {'content-type': 'application/json'});
                res.end('{"error":["Ticket title is required"]}');
            });
            try {
                const client = new Daktela.DaktelaConnector(
                    `http://127.0.0.1:${server.address().port}`,
                    'secret-token',
                    {authMethod}
                );
                const error = await client.get('tickets').catch((caught) => caught);

                expect(error).toBeInstanceOf(Daktela.DaktelaError);
                expect(error.message).toBe(
                    'Request failed with status code 400: Ticket title is required'
                );
                expect(JSON.stringify(error)).not.toContain('secret-token');
                expect(util.inspect(error, {depth: 8})).not.toContain('secret-token');
                expect(error.cause.request).toBeDefined();
            } finally {
                await close(server);
            }
        }
    );

    test('applies a default timeout and rejects invalid timeouts', () => {
        expect(new Daktela.DaktelaConnector('example.test').timeout).toBe(60000);
        expect(new Daktela.DaktelaConnector('example.test', null, {timeout: 0}).timeout).toBe(0);
        expect(() => new Daktela.DaktelaConnector('example.test', null, {
            timeout: '5000'
        })).toThrow('timeout');
        expect(() => new Daktela.DaktelaConnector('example.test', null, {
            timeout: -1
        })).toThrow('timeout');
    });

    test('rejects malformed access tokens', () => {
        expect(() => new Daktela.DaktelaConnector('example.test', 123)).toThrow('Access token');
        expect(() => new Daktela.DaktelaConnector('example.test', 'a\r\nb')).toThrow(
            'control characters'
        );
        expect(() => new Daktela.DaktelaConnector('example.test', 'a; admin=1', {
            authMethod: 'cookie'
        })).toThrow('cookie');
    });

    test('warns when query helpers are ignored because params is supplied', () => {
        const logger = {warn: jest.fn()};
        const client = connectorWith(fakeAxios(apiResponse({})), {logger});
        client.buildRequestParams({params: {take: 5}, fields: ['name']});
        client.buildRequestParams({params: {take: 5}});

        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(
            'Query helper options are ignored when params is supplied',
            {ignored: ['fields']}
        );
    });

    test('honours Retry-After on retried responses within maxDelayMs', () => {
        const client = connectorWith(fakeAxios(apiResponse({})));
        const config = {baseDelayMs: 10, maxDelayMs: 5000, multiplier: 2, jitter: false};
        const unavailable = requestError('busy', 503, undefined, {'retry-after': '2'});
        const tooLong = requestError('busy', 503, undefined, {'retry-after': '60'});

        expect(client.retryDelay(config, 0, unavailable)).toBe(2000);
        expect(client.retryDelay(config, 0, tooLong)).toBe(5000);
        expect(client.retryDelay(config, 0)).toBe(10);
    });

    test('throws instead of silently truncating at the default page limit', async () => {
        const http = fakeAxios(apiResponse({data: [{id: 1}], total: 5000}));
        const client = connectorWith(http);

        await expect(collect(client.iterate('tickets', {pageSize: 1}))).rejects.toMatchObject({
            code: 'ERR_PAGINATION_LIMIT'
        });
        expect(http.request).toHaveBeenCalledTimes(999);
        await expect(client.getAll('tickets', {pageSize: 1})).rejects.toMatchObject({
            code: 'ERR_PAGINATION_LIMIT'
        });
    });

    test('an explicit maxPages caps pagination quietly', async () => {
        const http = fakeAxios(apiResponse({data: [{id: 1}], total: 5000}));
        const client = connectorWith(http);

        await expect(collect(client.iterate('tickets', {
            pageSize: 1,
            maxPages: 3
        }))).resolves.toHaveLength(3);
    });

    test('aborts after repeated failures when skipping failed pages', async () => {
        const http = fakeAxios(requestError('unauthorized', 401, {error: ['denied']}));
        const client = connectorWith(http);

        await expect(collect(client.pages('tickets', {stopOnError: false}))).rejects.toMatchObject({
            status: 401
        });
        expect(http.request).toHaveBeenCalledTimes(3);

        const appErrors = fakeAxios(apiResponse(null, 200, {}, ['broken']));
        const appClient = connectorWith(appErrors);
        await expect(collect(appClient.pages('tickets', {
            stopOnError: false,
            maxConsecutiveErrors: 2
        }))).rejects.toThrow('2 consecutive failed pages');
        expect(appErrors.request).toHaveBeenCalledTimes(2);
    });

    test('iterate() surfaces application errors instead of ending silently', async () => {
        const http = fakeAxios(
            apiResponse({data: [{id: 1}], total: 3}),
            apiResponse(null, 200, {}, ['database unavailable'])
        );
        const client = connectorWith(http);
        const seen = [];

        await expect((async () => {
            for await (const item of client.iterate('tickets', {pageSize: 1})) {
                seen.push(item);
            }
        })()).rejects.toThrow('database unavailable');
        expect(seen).toEqual([{id: 1}]);
    });

    test('getAll() keeps application errors from every skipped page', async () => {
        const http = fakeAxios(
            apiResponse(null, 200, {}, ['first']),
            apiResponse({data: [{id: 1}], total: 3}),
            apiResponse(null, 200, {}, ['second']),
            apiResponse({data: [], total: 3})
        );
        const client = connectorWith(http);
        const response = await client.getAll('tickets', {pageSize: 1, stopOnError: false});

        expect(response.data).toEqual([{id: 1}]);
        expect(response.errors).toEqual(['first', 'second']);
    });

    test('resets the consecutive failure count after a successful page', async () => {
        const failed = () => apiResponse(null, 200, {}, ['temporary']);
        const http = fakeAxios(
            failed(),
            failed(),
            apiResponse({data: [{id: 1}], total: 6}),
            failed(),
            failed(),
            apiResponse({data: [], total: 6})
        );
        const client = connectorWith(http);
        const response = await client.getAll('tickets', {
            pageSize: 1,
            stopOnError: false,
            maxConsecutiveErrors: 3
        });

        expect(response.data).toEqual([{id: 1}]);
        expect(response.errors).toHaveLength(4);
        expect(http.request).toHaveBeenCalledTimes(6);
    });

    test('runs user redirect hooks after the guard and forces fetch redirects to fail', () => {
        const userHook = jest.fn();
        const client = connectorWith(fakeAxios(apiResponse({})));
        const config = client.buildRequestConfig({
            requestConfig: {beforeRedirect: userHook, fetchOptions: {redirect: 'follow', cache: 'no-store'}}
        });
        const options = {
            href: 'https://elsewhere.test/x',
            headers: {'X-AUTH-TOKEN': 'secret-token', Accept: 'application/json'}
        };
        config.beforeRedirect(options, {});

        expect(options.headers).toEqual({Accept: 'application/json'});
        expect(userHook).toHaveBeenCalledWith(options, {});
        expect(config.fetchOptions).toEqual({redirect: 'error', cache: 'no-store'});
    });

    test('keeps the timeout of an injected Axios instance unless one is passed', () => {
        const instance = {defaults: {timeout: 120000}, request: jest.fn()};
        const inherited = connectorWith(instance);
        const explicit = connectorWith(instance, {timeout: 5000});

        expect(inherited.timeout).toBe(120000);
        expect(inherited.buildRequestConfig().timeout).toBeUndefined();
        expect(explicit.buildRequestConfig().timeout).toBe(5000);
    });

    test('summarizes object-shaped and very long API errors in the message', () => {
        const objectError = new Daktela.DaktelaError(
            requestError('Request failed', 400, {error: {form: {title: 'required'}}})
        );
        const longError = new Daktela.DaktelaError(
            requestError('Request failed', 400, {error: ['x'.repeat(800)]})
        );

        expect(objectError.message).toBe('Request failed: {"form":{"title":"required"}}');
        expect(longError.message).toHaveLength('Request failed: '.length + 501);
    });

    test.each([
        [{maxConsecutiveErrors: 0}, 'maxConsecutiveErrors']
    ])('validates pagination option %p', async (options, message) => {
        const client = connectorWith(fakeAxios(apiResponse({data: []})));
        await expect(collect(client.pages('tickets', options))).rejects.toThrow(message);
    });
});
