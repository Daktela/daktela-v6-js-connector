'use strict';

function getHeader(headers, name) {
    if (!headers) {
        return null;
    }
    if (typeof headers.get === 'function') {
        return headers.get(name) ?? null;
    }
    const lowerName = name.toLowerCase();
    const key = Object.keys(headers).find((header) => header.toLowerCase() === lowerName);
    return key === undefined ? null : headers[key];
}

function normalizeErrors(error) {
    if (error === null || error === undefined) {
        return [];
    }
    return Array.isArray(error) ? error : [error];
}

const REDACTED = '[REDACTED]';
const SENSITIVE_HEADERS = new Set(['x-auth-token', 'cookie', 'authorization']);
const SENSITIVE_PARAMS = new Set(['accesstoken']);
const MAX_ERROR_SUMMARY_LENGTH = 500;

function redactEntries(target, names) {
    if (target === null || typeof target !== 'object') {
        return;
    }
    for (const key of Object.keys(target)) {
        if (names.has(key.toLowerCase()) && target[key] != null) {
            target[key] = REDACTED;
        }
    }
}

function hideProperty(target, name) {
    if (target === null || typeof target !== 'object'
        || !Object.prototype.hasOwnProperty.call(target, name)) {
        return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    if (descriptor.configurable) {
        Object.defineProperty(target, name, {...descriptor, enumerable: false});
    }
}

// Axios errors carry the full request config and the raw client request, both of
// which contain the access token. Redact them in place so logging or serializing
// a DaktelaError (or its cause) never discloses credentials.
function redactCredentials(error) {
    if (error === null || typeof error !== 'object') {
        return;
    }
    for (const config of [error.config, error.response?.config]) {
        if (config !== null && typeof config === 'object') {
            redactEntries(config.headers, SENSITIVE_HEADERS);
            redactEntries(config.params, SENSITIVE_PARAMS);
        }
    }
    hideProperty(error, 'request');
    hideProperty(error.response, 'request');
}

function summarizeErrors(errors) {
    const summary = errors
        .map((error) => (typeof error === 'string' ? error : JSON.stringify(error)))
        .filter((text) => typeof text === 'string' && text !== '')
        .join('; ');
    return summary.length > MAX_ERROR_SUMMARY_LENGTH
        ? `${summary.slice(0, MAX_ERROR_SUMMARY_LENGTH)}…`
        : summary;
}

function parseRetryAfter(value, now = Date.now()) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const normalized = String(value).trim();
    if (normalized === '') {
        return null;
    }

    const seconds = Number(normalized);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.ceil(seconds);
    }

    const timestamp = Date.parse(normalized);
    if (Number.isNaN(timestamp)) {
        return null;
    }
    return Math.max(0, Math.ceil((timestamp - now) / 1000));
}

class DaktelaResponse {
    constructor(response = {}) {
        const body = response.data;
        const result = body !== null && typeof body === 'object'
            ? (body.result ?? null)
            : null;

        this.status = response.status ?? null;
        this.headers = response.headers ?? {};
        this.data = result;
        this.errors = normalizeErrors(
            body !== null && typeof body === 'object' ? body.error : null
        );

        if (result !== null && typeof result === 'object' && Array.isArray(result.data)) {
            this.data = result.data;
        }
        if (result !== null && typeof result === 'object' && result.total != null) {
            this.total = result.total;
        }
    }

    isSuccess() {
        return this.status >= 200 && this.status < 300;
    }

    hasErrors() {
        return this.errors.length > 0;
    }

    isEmpty() {
        if (this.data === null || this.data === undefined) {
            return true;
        }
        if (Array.isArray(this.data) || typeof this.data === 'string') {
            return this.data.length === 0;
        }
        if (typeof this.data === 'object') {
            return Object.keys(this.data).length === 0;
        }
        return false;
    }
}

class DaktelaError extends Error {
    constructor(prevError) {
        redactCredentials(prevError);
        const apiError = prevError?.response?.data?.error ?? null;
        const errors = normalizeErrors(apiError);
        const baseMessage = prevError?.message ?? 'Daktela request failed';
        const summary = summarizeErrors(errors);
        super(summary === '' ? baseMessage : `${baseMessage}: ${summary}`);
        this.name = 'DaktelaError';
        this.prevError = prevError;
        this.cause = prevError;
        this.status = prevError?.response?.status ?? null;
        this.code = prevError?.code ?? null;
        this.apiError = apiError;
        this.errors = errors;
        this.headers = prevError?.response?.headers ?? {};
        this.retryAfter = parseRetryAfter(getHeader(this.headers, 'retry-after'));
        this.isRateLimit = this.status === 429;
        this.isCanceled = this.code === 'ERR_CANCELED' || prevError?.name === 'AbortError';

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, DaktelaError);
        }
    }
}

module.exports = {
    DaktelaResponse,
    DaktelaError,
    getHeader,
    normalizeErrors,
    parseRetryAfter
};
