'use strict';

const axios = require('axios');
const {version: packageVersion} = require('../package.json');
const {
    PaginationTake,
    PaginationSkip,
    FilterLogicAnd
} = require('./constants');
const {isObject} = require('./query');
const {
    DaktelaResponse,
    DaktelaError,
    getHeader,
    parseRetryAfter
} = require('./response');

const AUTH_METHODS = new Set(['header', 'cookie', 'query']);
const AUTH_HEADER_PATTERN = /^(?:x-auth-token|cookie|authorization)$/i;
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_PAGES = 999;
const DEFAULT_MAX_CONSECUTIVE_ERRORS = 3;
const DEFAULT_RETRY_STATUS_CODES = [408, 425, 500, 502, 503, 504];
const DEFAULT_RETRY_METHODS = ['get', 'head', 'options', 'delete'];
const PAGINATION_OPTION_KEYS = new Set([
    'pageSize',
    'maxItems',
    'maxPages',
    'stopOnError',
    'maxConsecutiveErrors'
]);
const QUERY_HELPER_KEYS = ['fields', 'sort', 'pagination', 'filters', 'filter'];

function normalizeUrl(url) {
    if (typeof url !== 'string' || url.trim() === '') {
        throw new TypeError('Daktela instance URL must be a non-empty string');
    }

    let normalized = url.trim();
    if (/^https?:/i.test(normalized) && !/^https?:\/\//i.test(normalized)) {
        throw new TypeError('Daktela instance URL is malformed');
    }
    if (!/^[a-z][a-z\d+.-]*:\/\//i.test(normalized)) {
        normalized = `https://${normalized}`;
    }

    const parsed = new URL(normalized);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new TypeError('Daktela instance URL must use HTTP or HTTPS');
    }
    if (parsed.username || parsed.password) {
        throw new TypeError('Daktela instance URL must not contain credentials');
    }
    if (parsed.search || parsed.hash) {
        throw new TypeError('Daktela instance URL must not contain a query string or fragment');
    }

    return parsed.toString().replace(/\/+$/, '');
}

function validateAccessToken(accessToken, authMethod) {
    if (accessToken == null) {
        return;
    }
    if (typeof accessToken !== 'string' || accessToken === '') {
        throw new TypeError('Access token must be a non-empty string, null, or undefined');
    }
    if (/[\u0000-\u001f\u007f]/.test(accessToken)) {
        throw new TypeError('Access token must not contain control characters');
    }
    if (authMethod === 'cookie' && /[\s;,]/.test(accessToken)) {
        throw new TypeError('Access token used for cookie authentication must not contain whitespace, commas, or semicolons');
    }
}

function normalizeTimeout(value) {
    if (value === undefined) {
        return DEFAULT_TIMEOUT_MS;
    }
    if (!Number.isInteger(value) || value < 0) {
        throw new TypeError('timeout must be a non-negative integer number of milliseconds (0 disables it)');
    }
    return value;
}

function originOf(options) {
    try {
        if (typeof options.href === 'string') {
            return new URL(options.href).origin;
        }
        const host = options.hostname ?? options.host;
        const port = options.port ? `:${options.port}` : '';
        return new URL(`${options.protocol}//${host}${port}`).origin;
    } catch (_error) {
        return null;
    }
}

function removeAuthHeaders(headers) {
    if (headers === null || typeof headers !== 'object') {
        return;
    }
    for (const name of Object.keys(headers)) {
        if (AUTH_HEADER_PATTERN.test(name)) {
            delete headers[name];
        }
    }
}

function applicationError(response, message = 'Daktela API returned application errors') {
    const error = new Error(message);
    error.code = 'ERR_DAKTELA_APPLICATION';
    error.response = {
        status: response.status,
        headers: response.headers,
        data: {error: response.errors}
    };
    return new DaktelaError(error);
}

function positiveNumber(value, defaultValue, name, allowZero = false) {
    const selected = value ?? defaultValue;
    if (!Number.isFinite(selected) || (allowZero ? selected < 0 : selected <= 0)) {
        throw new TypeError(`${name} must be ${allowZero ? 'a non-negative' : 'a positive'} number`);
    }
    return selected;
}

function normalizeRetryConfig(value) {
    if (!value) {
        return {
            retries: 0,
            baseDelayMs: 100,
            maxDelayMs: 10000,
            multiplier: 2,
            jitter: true,
            statusCodes: DEFAULT_RETRY_STATUS_CODES.slice(),
            methods: DEFAULT_RETRY_METHODS.slice(),
            retryOnConnectionError: true
        };
    }

    const config = value === true ? {} : value;
    if (!isObject(config)) {
        throw new TypeError('retry must be a boolean or an object');
    }

    const retries = config.retries ?? 3;
    if (!Number.isInteger(retries) || retries < 0) {
        throw new TypeError('retry.retries must be a non-negative integer');
    }

    return {
        retries,
        baseDelayMs: positiveNumber(config.baseDelayMs, 100, 'retry.baseDelayMs', true),
        maxDelayMs: positiveNumber(config.maxDelayMs, 10000, 'retry.maxDelayMs', true),
        multiplier: positiveNumber(config.multiplier, 2, 'retry.multiplier'),
        jitter: config.jitter ?? true,
        statusCodes: Array.isArray(config.statusCodes)
            ? config.statusCodes.slice()
            : DEFAULT_RETRY_STATUS_CODES.slice(),
        methods: Array.isArray(config.methods)
            ? config.methods.map((method) => String(method).toLowerCase())
            : DEFAULT_RETRY_METHODS.slice(),
        retryOnConnectionError: config.retryOnConnectionError ?? true
    };
}

function normalizeRateLimitConfig(value) {
    if (!value) {
        return {
            autoRetry: false,
            retries: 1,
            maxWaitMs: 60000,
            defaultDelayMs: 5000
        };
    }

    const config = value === true ? {} : value;
    if (!isObject(config)) {
        throw new TypeError('rateLimit must be a boolean or an object');
    }

    const retries = config.retries ?? 1;
    if (!Number.isInteger(retries) || retries < 0) {
        throw new TypeError('rateLimit.retries must be a non-negative integer');
    }

    return {
        autoRetry: config.autoRetry ?? true,
        retries,
        maxWaitMs: positiveNumber(config.maxWaitMs, 60000, 'rateLimit.maxWaitMs', true),
        defaultDelayMs: positiveNumber(
            config.defaultDelayMs,
            5000,
            'rateLimit.defaultDelayMs',
            true
        )
    };
}

function validateEndpoint(endpoint) {
    if (typeof endpoint !== 'string' || endpoint.trim() === '') {
        throw new TypeError('Daktela API endpoint must be a non-empty string');
    }
    const normalized = endpoint.trim();
    if (/^[a-z][a-z\d+.-]*:/i.test(normalized) || normalized.startsWith('//')) {
        throw new TypeError('Daktela API endpoint must be relative to the configured instance');
    }
    const relative = normalized.replace(/^\/+/, '');
    const pathname = relative.split(/[?#]/, 1)[0];
    if (pathname.includes('\\') || pathname.split('/').some((segment) => {
        let decoded = segment;
        try {
            decoded = decodeURIComponent(segment);
        } catch (_error) {
            return true;
        }
        return decoded === '.'
            || decoded === '..'
            || decoded.includes('/')
            || decoded.includes('\\');
    })) {
        throw new TypeError('Daktela API endpoint must not contain relative path segments');
    }
    return relative;
}

function abortError() {
    const error = new Error('The request was canceled');
    error.name = 'AbortError';
    error.code = 'ERR_CANCELED';
    return error;
}

function delay(ms, signal) {
    if (signal?.aborted) {
        return Promise.reject(abortError());
    }

    return new Promise((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
            reject(abortError());
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, {once: true});
    });
}

function withoutPaginationOptions(options) {
    const result = {};
    for (const [key, value] of Object.entries(options)) {
        if (!PAGINATION_OPTION_KEYS.has(key)) {
            result[key] = value;
        }
    }
    return result;
}

class DaktelaConnector {
    constructor(url, accessToken = null, options = {}) {
        if (!isObject(options)) {
            throw new TypeError('Connector options must be an object');
        }

        this.baseUrl = `${normalizeUrl(url)}/api/v6/`;
        this.accessToken = accessToken;
        this.authMethod = options.authMethod ?? 'header';
        if (options.cookieAuth !== undefined) {
            this.authMethod = options.cookieAuth ? 'cookie' : 'query';
        }
        if (!AUTH_METHODS.has(this.authMethod)) {
            throw new TypeError("authMethod must be 'header', 'cookie', or 'query'");
        }
        validateAccessToken(accessToken, this.authMethod);
        this.origin = new URL(this.baseUrl).origin;

        this.retryConfig = normalizeRetryConfig(options.retry);
        this.rateLimitConfig = normalizeRateLimitConfig(options.rateLimit);
        this.logger = options.logger ?? null;
        this.authHeaders = {};
        if (accessToken != null && this.authMethod === 'header') {
            this.authHeaders['X-AUTH-TOKEN'] = accessToken;
        } else if (accessToken != null && this.authMethod === 'cookie') {
            this.authHeaders.Cookie = `c_user=${accessToken}`;
        }

        const headers = {...(options.axiosConfig?.headers ?? {}), ...this.authHeaders};
        this.requestHeaders = {};
        if (typeof process !== 'undefined' && process.versions?.node) {
            const defaultUserAgent = `@daktela/daktela-connector/${packageVersion}`;
            if (typeof options.userAgent === 'string') {
                headers['User-Agent'] = options.userAgent;
            } else if (typeof options.userAgentSuffix === 'string') {
                headers['User-Agent'] = `${defaultUserAgent} ${options.userAgentSuffix}`;
            } else {
                headers['User-Agent'] = defaultUserAgent;
            }
            this.requestHeaders['User-Agent'] = headers['User-Agent'];
        }

        // An injected Axios instance keeps its own timeout unless one is passed explicitly.
        this.inheritTimeout = options.axiosInstance != null && options.timeout === undefined;
        const timeout = this.inheritTimeout
            ? (options.axiosInstance.defaults?.timeout ?? 0)
            : normalizeTimeout(options.timeout);
        const axiosConfig = isObject(options.axiosConfig) ? {...options.axiosConfig} : {};
        delete axiosConfig.baseURL;
        delete axiosConfig.headers;
        delete axiosConfig.timeout;
        delete axiosConfig.url;
        delete axiosConfig.method;
        delete axiosConfig.data;
        delete axiosConfig.params;

        this.api = options.axiosInstance ?? axios.create({
            ...axiosConfig,
            baseURL: this.baseUrl,
            headers,
            timeout,
            allowAbsoluteUrls: false
        });
        this.timeout = timeout;
    }

    buildRequestParams(options) {
        let params = {};
        if (isObject(options)) {
            if (isObject(options.params)) {
                params = {...options.params};
                const ignored = QUERY_HELPER_KEYS.filter((key) => options[key] != null);
                if (ignored.length > 0) {
                    this.log('warn', 'Query helper options are ignored when params is supplied', {
                        ignored
                    });
                }
            } else {
                if (Array.isArray(options.fields)) {
                    params.fields = options.fields.slice();
                }
                if (Array.isArray(options.sort)) {
                    params.sort = options.sort.map((sort) => isObject(sort) ? {...sort} : sort);
                } else if (isObject(options.sort)) {
                    params.sort = {...options.sort};
                }
                if (isObject(options.pagination)) {
                    params.take = options.pagination.take ?? PaginationTake;
                    params.skip = options.pagination.skip ?? PaginationSkip;
                }
                if (Array.isArray(options.filters)) {
                    params.filter = {
                        logic: FilterLogicAnd,
                        filters: options.filters.slice()
                    };
                }
                if (isObject(options.filter)) {
                    if (isObject(params.filter)) {
                        params.filter.filters.push(options.filter);
                    } else {
                        params.filter = {...options.filter};
                    }
                }
            }
        }
        if (this.authMethod === 'query' && this.accessToken !== null) {
            params.accessToken = this.accessToken;
        }
        return {params};
    }

    enrichWithAccessToken(params) {
        return this.buildRequestParams({params});
    }

    buildRequestConfig(options = {}) {
        const requestConfig = isObject(options.requestConfig)
            ? {...options.requestConfig}
            : {};
        delete requestConfig.url;
        delete requestConfig.method;
        delete requestConfig.data;
        delete requestConfig.params;
        delete requestConfig.baseURL;
        delete requestConfig.allowAbsoluteUrls;

        requestConfig.headers = {
            ...this.requestHeaders,
            ...(requestConfig.headers ?? {}),
            ...this.authHeaders
        };
        requestConfig.params = this.buildRequestParams(options).params;
        requestConfig.baseURL = this.baseUrl;
        requestConfig.allowAbsoluteUrls = false;
        requestConfig.beforeRedirect = this.redirectGuard(
            requestConfig.beforeRedirect ?? this.api?.defaults?.beforeRedirect
        );
        // The fetch adapter does not support beforeRedirect, so refuse redirects there.
        requestConfig.fetchOptions = {
            ...(this.api?.defaults?.fetchOptions ?? {}),
            ...(requestConfig.fetchOptions ?? {}),
            redirect: 'error'
        };
        if (requestConfig.timeout === undefined && !this.inheritTimeout) {
            requestConfig.timeout = this.timeout;
        }
        return requestConfig;
    }

    async request(method, endpoint, options = {}) {
        if (typeof method !== 'string' || !/^[A-Za-z]+$/.test(method)) {
            throw new TypeError('HTTP method must be a non-empty alphabetic string');
        }
        if (!isObject(options)) {
            throw new TypeError('Request options must be an object');
        }
        const normalizedMethod = method.toLowerCase();
        const normalizedEndpoint = validateEndpoint(endpoint);
        const config = this.buildRequestConfig(options);
        const retryConfig = options.retry === undefined
            ? this.retryConfig
            : normalizeRetryConfig(options.retry);
        const rateLimitConfig = options.rateLimit === undefined
            ? this.rateLimitConfig
            : normalizeRateLimitConfig(options.rateLimit);
        let retries = 0;
        let rateLimitRetries = 0;

        while (true) {
            try {
                this.log('debug', 'Sending Daktela API request', {
                    method: normalizedMethod.toUpperCase(),
                    endpoint: normalizedEndpoint,
                    attempt: retries + rateLimitRetries + 1
                });
                const response = await this.api.request({
                    ...config,
                    method: normalizedMethod,
                    url: normalizedEndpoint,
                    data: options.data
                });
                return new DaktelaResponse(response);
            } catch (error) {
                if (error instanceof DaktelaError) {
                    throw error;
                }
                const status = error?.response?.status ?? null;

                if (status === 429
                    && rateLimitConfig.autoRetry
                    && rateLimitRetries < rateLimitConfig.retries
                ) {
                    const retryAfter = parseRetryAfter(
                        getHeader(error.response?.headers, 'retry-after')
                    );
                    const waitMs = retryAfter === null
                        ? rateLimitConfig.defaultDelayMs
                        : retryAfter * 1000;
                    if (waitMs <= rateLimitConfig.maxWaitMs) {
                        rateLimitRetries++;
                        this.log('warn', 'Daktela API rate limit reached', {
                            endpoint: normalizedEndpoint,
                            waitMs,
                            retry: rateLimitRetries
                        });
                        await this.wait(waitMs, config.signal, error);
                        continue;
                    }
                }

                if (status === 429) {
                    throw new DaktelaError(error);
                }

                if (this.shouldRetry(error, normalizedMethod, retryConfig, retries)) {
                    const waitMs = this.retryDelay(retryConfig, retries, error);
                    retries++;
                    this.log('warn', 'Retrying Daktela API request', {
                        endpoint: normalizedEndpoint,
                        waitMs,
                        retry: retries,
                        status
                    });
                    await this.wait(waitMs, config.signal, error);
                    continue;
                }

                this.log('error', 'Daktela API request failed', {
                    method: normalizedMethod.toUpperCase(),
                    endpoint: normalizedEndpoint,
                    status,
                    code: error?.code ?? null
                });
                throw new DaktelaError(error);
            }
        }
    }

    redirectGuard(userBeforeRedirect) {
        return (options, responseDetails, ...rest) => {
            if (originOf(options) !== this.origin) {
                removeAuthHeaders(options.headers);
                this.log('warn', 'Removed Daktela credentials from a cross-origin redirect', {
                    origin: originOf(options)
                });
            }
            if (typeof userBeforeRedirect === 'function') {
                userBeforeRedirect(options, responseDetails, ...rest);
            }
        };
    }

    shouldRetry(error, method, config, retries) {
        if (retries >= config.retries || !config.methods.includes(method)) {
            return false;
        }
        if (error?.response?.status != null) {
            return config.statusCodes.includes(error.response.status);
        }
        return config.retryOnConnectionError && error?.code !== 'ERR_CANCELED';
    }

    retryDelay(config, attempt, error = null) {
        const base = Math.min(
            config.maxDelayMs,
            config.baseDelayMs * Math.pow(config.multiplier, attempt)
        );
        const backoff = config.jitter ? Math.floor(Math.random() * (base + 1)) : base;
        const retryAfter = parseRetryAfter(getHeader(error?.response?.headers, 'retry-after'));
        if (retryAfter === null) {
            return backoff;
        }
        return Math.max(backoff, Math.min(retryAfter * 1000, config.maxDelayMs));
    }

    async wait(waitMs, signal, originalError) {
        try {
            await delay(waitMs, signal);
        } catch (error) {
            error.response = originalError?.response;
            throw new DaktelaError(error);
        }
    }

    log(level, message, context) {
        const fn = this.logger?.[level];
        if (typeof fn === 'function') {
            fn.call(this.logger, message, context);
        }
    }

    get(endpoint, options = null) {
        return this.request('GET', endpoint, isObject(options) ? options : {});
    }

    post(endpoint, payload, params = null, requestConfig = null) {
        return this.request('POST', endpoint, {
            data: payload,
            params: isObject(params) ? params : {},
            requestConfig: isObject(requestConfig) ? requestConfig : {}
        });
    }

    put(endpoint, payload, params = null, requestConfig = null) {
        return this.request('PUT', endpoint, {
            data: payload,
            params: isObject(params) ? params : {},
            requestConfig: isObject(requestConfig) ? requestConfig : {}
        });
    }

    delete(endpoint, params = null, requestConfig = null) {
        return this.request('DELETE', endpoint, {
            params: isObject(params) ? params : {},
            requestConfig: isObject(requestConfig) ? requestConfig : {}
        });
    }

    async ping(requestConfig = null) {
        try {
            const response = await this.get('whoim', {
                requestConfig: isObject(requestConfig) ? requestConfig : {}
            });
            return response.isSuccess() && !response.hasErrors();
        } catch (_error) {
            return false;
        }
    }

    async healthCheck(requestConfig = null) {
        const start = Date.now();
        try {
            const response = await this.get('whoim', {
                requestConfig: isObject(requestConfig) ? requestConfig : {}
            });
            return {
                healthy: response.isSuccess() && !response.hasErrors(),
                latencyMs: Date.now() - start,
                status: response.status
            };
        } catch (error) {
            return {
                healthy: false,
                latencyMs: Date.now() - start,
                status: error.status,
                error: error.message
            };
        }
    }

    async *pages(endpoint, options = {}) {
        if (!isObject(options)) {
            throw new TypeError('Pagination options must be an object');
        }
        const pageSize = options.pageSize ?? options.pagination?.take ?? PaginationTake;
        const explicitMaxPages = options.maxPages !== undefined && options.maxPages !== null;
        const maxPages = explicitMaxPages ? options.maxPages : DEFAULT_MAX_PAGES;
        const stopOnError = options.stopOnError ?? true;
        const maxConsecutiveErrors = options.maxConsecutiveErrors
            ?? DEFAULT_MAX_CONSECUTIVE_ERRORS;
        let skip = options.pagination?.skip ?? PaginationSkip;

        if (!Number.isInteger(pageSize) || pageSize <= 0) {
            throw new TypeError('pageSize must be a positive integer');
        }
        if (!Number.isInteger(maxPages) || maxPages <= 0) {
            throw new TypeError('maxPages must be a positive integer');
        }
        if (!Number.isInteger(maxConsecutiveErrors) || maxConsecutiveErrors <= 0) {
            throw new TypeError('maxConsecutiveErrors must be a positive integer');
        }

        const baseOptions = withoutPaginationOptions(options);
        let consecutiveErrors = 0;
        for (let page = 0; page < maxPages; page++) {
            const pageOptions = {...baseOptions};
            if (isObject(baseOptions.params)) {
                delete pageOptions.pagination;
                pageOptions.params = {...baseOptions.params, take: pageSize, skip};
            } else {
                pageOptions.pagination = {take: pageSize, skip};
            }

            let response;
            try {
                response = await this.get(endpoint, pageOptions);
            } catch (error) {
                consecutiveErrors++;
                if (stopOnError || consecutiveErrors >= maxConsecutiveErrors) {
                    throw error;
                }
                skip += pageSize;
                continue;
            }

            yield response;
            if (response.hasErrors()) {
                if (stopOnError) {
                    return;
                }
                consecutiveErrors++;
                if (consecutiveErrors >= maxConsecutiveErrors) {
                    throw applicationError(
                        response,
                        `Pagination aborted after ${consecutiveErrors} consecutive failed pages`
                    );
                }
                skip += pageSize;
                continue;
            }
            consecutiveErrors = 0;

            if (!Array.isArray(response.data)
                || response.data.length < pageSize
                || (response.total != null && skip + response.data.length >= response.total)
            ) {
                return;
            }
            skip += pageSize;
        }

        // An explicit maxPages is an intentional cap. Hitting the default safety
        // bound means data remains, so fail loudly instead of truncating silently.
        if (!explicitMaxPages) {
            const error = new Error(
                `Pagination reached the default safety limit of ${DEFAULT_MAX_PAGES} pages `
                + 'before the end of the data; set maxPages or maxItems explicitly'
            );
            error.code = 'ERR_PAGINATION_LIMIT';
            throw new DaktelaError(error);
        }
    }

    async *iterate(endpoint, options = {}) {
        if (!isObject(options)) {
            throw new TypeError('Iteration options must be an object');
        }
        const maxItems = options.maxItems ?? null;
        if (maxItems !== null && (!Number.isInteger(maxItems) || maxItems < 0)) {
            throw new TypeError('maxItems must be a non-negative integer or null');
        }
        if (maxItems === 0) {
            return;
        }
        const stopOnError = options.stopOnError ?? true;

        let count = 0;
        for await (const response of this.pages(endpoint, options)) {
            if (response.hasErrors()) {
                if (stopOnError) {
                    throw applicationError(response);
                }
                continue;
            }
            if (!Array.isArray(response.data)) {
                continue;
            }
            for (const item of response.data) {
                yield item;
                count++;
                if (maxItems !== null && count >= maxItems) {
                    return;
                }
            }
        }
    }

    async getAll(endpoint, options = {}) {
        if (!isObject(options)) {
            throw new TypeError('Pagination options must be an object');
        }
        const data = [];
        const errors = [];
        let lastResponse = null;
        const maxItems = options.maxItems ?? null;
        if (maxItems !== null && (!Number.isInteger(maxItems) || maxItems < 0)) {
            throw new TypeError('maxItems must be a non-negative integer or null');
        }
        if (maxItems === 0) {
            return new DaktelaResponse({
                status: 200,
                data: {result: {data: [], total: 0}}
            });
        }

        for await (const response of this.pages(endpoint, options)) {
            lastResponse = response;
            if (response.hasErrors()) {
                errors.push(...response.errors);
                continue;
            }
            if (!Array.isArray(response.data)) {
                continue;
            }
            for (const item of response.data) {
                data.push(item);
                if (maxItems !== null && data.length >= maxItems) {
                    break;
                }
            }
            if (maxItems !== null && data.length >= maxItems) {
                break;
            }
        }

        return new DaktelaResponse({
            status: lastResponse?.status ?? 200,
            headers: lastResponse?.headers ?? {},
            data: {
                result: {
                    data,
                    total: lastResponse?.total ?? data.length
                },
                error: errors
            }
        });
    }
}

module.exports = {
    DaktelaConnector,
    normalizeUrl,
    normalizeRetryConfig,
    normalizeRateLimitConfig,
    validateEndpoint,
    delay
};
