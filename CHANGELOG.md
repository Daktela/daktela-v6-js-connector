# Changelog

All notable changes to this project are documented in this file. The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.2.0] - 2026-08-20

### Security

- Raised the Axios dependency floor to 1.19.0 and regenerated the lockfile so supported production dependency resolutions include current security fixes.
- Restricted connector endpoints to the configured Daktela instance. Absolute URLs, protocol-relative URLs, credentials in instance URLs, and relative path traversal segments are rejected before authentication is attached.
- Protected the connector URL, method, payload, query parameters, and authentication credentials from per-request Axios configuration overrides.

### Added

- Added a centralized public `request()` pipeline used by all HTTP verb helpers.
- Added opt-in retries with bounded exponential backoff, jitter, configurable status codes, and connection-error handling. Automatic retries default to idempotent methods only.
- Added independent HTTP 429 handling with `Retry-After` support, bounded waits, and cancellation.
- Added `pages()` and `iterate()` async generators plus `getAll()` aggregation for large paginated datasets.
- Added `ping()` and detailed `healthCheck()` helpers.
- Added optional structured logging, `axiosConfig`, and custom `axiosInstance` support.
- Added per-request Axios configuration and `AbortSignal` cancellation.
- Added response headers, application errors, and `isSuccess()`, `hasErrors()`, and `isEmpty()` helpers.
- Added richer `DaktelaError` metadata: `cause`, `code`, `errors`, `headers`, `retryAfter`, `isRateLimit`, and `isCanceled`.
- Added bundled TypeScript declarations, package exports, and CommonJS/ES module consumer coverage.
- Added the Apache 2.0 license file.

### Fixed

- Preserved explicit `http://` instance URLs for local development instead of producing malformed `https://http://...` URLs.
- Validated authentication methods instead of silently sending unauthenticated requests for invalid values.
- Stopped query construction from mutating caller-owned parameter and filter arrays.
- Made response and error parsing safe for empty, bodyless, and non-object responses.
- Corrected package imports in documentation and tests to use `@daktela/daktela-connector` or the package root.
- Awaited rejection assertions and removed accidental global test state.
- Stopped pagination at the API-reported total, including exact page-size boundaries, and made a zero item limit return without an API request.
- Prevented HTTP 429 responses from receiving both a rate-limit wait and a general retry delay.

### Changed

- Split the implementation into connector, response, query, and constants modules while preserving the existing root exports and CRUD signatures.
- Declared Node.js 18 or newer as the supported runtime.
- Added a versioned Node.js User-Agent by default, with full replacement and suffix options.
- Replaced state-changing live tests as the default suite with deterministic mocked transport tests. Live tests now run only through `npm run test:integration` with credentials.
- Added Docker-based CI across Node.js 18, 20, 22, and 24 with TypeScript declaration checks and coverage reporting. Added package-consumer smoke tests and dependency audits to release verification.

No existing public CRUD method signatures or exports were removed. The deprecated `cookieAuth` option remains functional for backward compatibility.

## [1.1.0]

- Added `X-AUTH-TOKEN` header authentication as the default.
- Added the `authMethod` option with `header`, `cookie`, and `query` values.
- Deprecated `cookieAuth` while keeping it functional for backward compatibility.

## [1.0.1]

- Updated the README.

## [1.0.0]

- Initial version of the library.

[Unreleased]: https://github.com/Daktela/daktela-v6-js-connector/compare/1.2.0...HEAD
[1.2.0]: https://github.com/Daktela/daktela-v6-js-connector/compare/1.1.0...1.2.0
