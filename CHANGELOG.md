# Changelog

All notable changes to this project are documented in this file. The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Added a GitHub Actions workflow that publishes to npm through trusted publishing (OIDC) when a GitHub release is published, after verifying the tag matches `package.json` and running the audit, test, and type-check gate.

## [1.3.0] - 2026-10-06

### Security

- Access tokens are no longer forwarded on cross-origin redirects. Previously the default `X-AUTH-TOKEN` header was sent to any host a Daktela response redirected to. The connector now strips `X-AUTH-TOKEN`, `Cookie`, and `Authorization` headers when a redirect leaves the instance origin, and configures Axios's `fetch` adapter to reject redirects.
- `DaktelaError` no longer discloses the access token when it is logged, serialized with `JSON.stringify`, or inspected. Credential headers and the `accessToken` query parameter in the wrapped error's request config are redacted, and the raw `request` object is non-enumerable.
- Raised the Axios floor to 1.20.0, which fixes 12 advisories affecting 1.0.0–1.19.0 (GHSA-vh66-26gq-q6x8, GHSA-9fr6-4gfg-395g, GHSA-r4gj-5m52-g5wh, and others). CI now fails on production dependency advisories of moderate severity or higher.
- Access tokens are validated: they must be non-empty strings without control characters, and cookie authentication rejects tokens with whitespace, commas, or semicolons.

### Added

- `maxConsecutiveErrors` pagination option (default `3`): with `stopOnError: false`, a run aborts after that many consecutive failed pages instead of issuing up to 999 failing requests.
- `DaktelaConnector#origin` exposes the configured instance origin.
- Logger warning when query helper options (`fields`, `sort`, `pagination`, `filters`, `filter`) are ignored because `params` is supplied.

### Fixed

- `iterate()` throws a `DaktelaError` when a page contains application errors and `stopOnError` is `true`, instead of ending as if the data were complete.
- `getAll()` reports application errors from every skipped page, not only the last page.
- Reaching the default 999-page safety limit while data remains throws `DaktelaError` with code `ERR_PAGINATION_LIMIT` instead of silently truncating results at 99,900 records with the default page size. An explicit `maxPages` still caps a run without an error.
- General retries respect `Retry-After` (bounded by `retry.maxDelayMs`).
- `DaktelaError#message` includes the API's application error text, e.g. `Request failed with status code 400: Ticket title is required`. Application errors raised by pagination use the code `ERR_DAKTELA_APPLICATION`.
- A custom `axiosInstance` now keeps its own `defaults.timeout` when `timeout` is not passed; 1.2.0 overrode it with no timeout.

### Changed

- Requests now time out after 60 seconds by default instead of waiting indefinitely. Pass `timeout: 0` to restore the previous behavior, or any other non-negative integer.
- An invalid `timeout` (e.g. a string or negative number) now throws `TypeError` instead of silently disabling the timeout.
- Upgraded Jest to 30 and dotenv to 16.6 (development only).

### Upgrade notes

- Long-running requests that take more than 60 seconds need an explicit `timeout`.
- The constructor now throws `TypeError` for an empty-string or non-string access token (watch for patterns such as `process.env.TOKEN || ''`), and for cookie-mode tokens containing whitespace, commas, or semicolons. Pass `null` or omit the token for unauthenticated use.
- `timeout` values such as `null`, strings, negative numbers, and non-integers now throw `TypeError`; in 1.2.0 they silently disabled the timeout.
- With `stopOnError: false`, `pages()`, `iterate()`, and `getAll()` now throw after 3 consecutive failed pages instead of returning partial data. Raise `maxConsecutiveErrors` to tolerate longer failure streaks.
- With Axios's `fetch` adapter, all redirects (including same-origin ones) are now rejected.
- `DaktelaError#message` can now contain server-supplied error text; review log handling if API errors may echo personal data.
- Code that matches exact `DaktelaError#message` strings should switch to `status`, `code`, or `errors`.
- Code that relied on `iterate()` ending quietly on an application error, or on reading more than 999 pages without setting `maxPages`, now receives a `DaktelaError`.
- Node.js 18 and 20 are end-of-life. They remain supported in 1.x; a future major release will require Node.js 22 or newer.

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

[Unreleased]: https://github.com/Daktela/daktela-v6-js-connector/compare/1.3.0...HEAD
[1.3.0]: https://github.com/Daktela/daktela-v6-js-connector/compare/1.2.0...1.3.0
[1.2.0]: https://github.com/Daktela/daktela-v6-js-connector/compare/1.1.0...1.2.0
