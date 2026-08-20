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
        const message = prevError?.message ?? 'Daktela request failed';
        super(message);
        this.name = 'DaktelaError';
        this.prevError = prevError;
        this.cause = prevError;
        this.status = prevError?.response?.status ?? null;
        this.code = prevError?.code ?? null;
        this.apiError = prevError?.response?.data?.error ?? null;
        this.errors = normalizeErrors(this.apiError);
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
