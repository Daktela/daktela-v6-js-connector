import type {
    AxiosInstance,
    AxiosRequestConfig,
    AxiosResponse,
    AxiosResponseHeaders,
    RawAxiosResponseHeaders
} from 'axios';

export type AuthMethod = 'header' | 'cookie' | 'query';
export type SortDirection = 'asc' | 'desc';
export type FilterLogic = 'and' | 'or';

export interface PaginationValue {
    take: number;
    skip: number;
}

export interface SortValue {
    field: string;
    dir: SortDirection | string;
}

export interface SimpleFilter<T = unknown> {
    field: string;
    operator: string;
    value: T;
}

export interface FilterGroup {
    logic: FilterLogic | string;
    filters: Array<SimpleFilter | FilterGroup>;
}

export interface RetryOptions {
    retries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    multiplier?: number;
    jitter?: boolean;
    statusCodes?: number[];
    methods?: string[];
    retryOnConnectionError?: boolean;
}

export interface RateLimitOptions {
    autoRetry?: boolean;
    retries?: number;
    maxWaitMs?: number;
    defaultDelayMs?: number;
}

export interface DaktelaLogger {
    debug?(message: string, context: Record<string, unknown>): void;
    warn?(message: string, context: Record<string, unknown>): void;
    error?(message: string, context: Record<string, unknown>): void;
}

export interface ConnectorOptions {
    authMethod?: AuthMethod;
    /** @deprecated Use authMethod instead. */
    cookieAuth?: boolean;
    userAgent?: string;
    userAgentSuffix?: string;
    timeout?: number;
    retry?: boolean | RetryOptions;
    rateLimit?: boolean | RateLimitOptions;
    logger?: DaktelaLogger;
    axiosConfig?: AxiosRequestConfig;
    axiosInstance?: AxiosInstance;
}

export interface QueryOptions {
    params?: Record<string, unknown>;
    fields?: string[];
    sort?: SortValue | SortValue[];
    pagination?: Partial<PaginationValue>;
    filters?: Array<SimpleFilter | FilterGroup>;
    filter?: FilterGroup | SimpleFilter;
    requestConfig?: AxiosRequestConfig;
    retry?: boolean | RetryOptions;
    rateLimit?: boolean | RateLimitOptions;
}

export interface RequestOptions<TPayload = unknown> extends QueryOptions {
    data?: TPayload;
}

export interface IterationOptions extends QueryOptions {
    pageSize?: number;
    maxItems?: number | null;
    maxPages?: number;
    stopOnError?: boolean;
}

export interface HealthCheckResult {
    healthy: boolean;
    latencyMs: number;
    status?: number | null;
    error?: string;
}

export class DaktelaResponse<T = unknown> {
    constructor(response?: Partial<AxiosResponse>);
    status: number | null;
    data: T | null;
    total?: number;
    errors: unknown[];
    headers: AxiosResponseHeaders | RawAxiosResponseHeaders | Record<string, unknown>;
    isSuccess(): boolean;
    hasErrors(): boolean;
    isEmpty(): boolean;
}

export class DaktelaError extends Error {
    constructor(previousError: unknown);
    name: 'DaktelaError';
    prevError: unknown;
    cause: unknown;
    status: number | null;
    code: string | null;
    apiError: unknown;
    errors: unknown[];
    headers: AxiosResponseHeaders | RawAxiosResponseHeaders | Record<string, unknown>;
    retryAfter: number | null;
    isRateLimit: boolean;
    isCanceled: boolean;
}

export class DaktelaConnector {
    constructor(url: string, accessToken?: string | null, options?: ConnectorOptions);
    readonly baseUrl: string;
    readonly accessToken: string | null;
    readonly authMethod: AuthMethod;
    readonly api: AxiosInstance;
    readonly timeout: number;

    buildRequestParams(options?: QueryOptions | null): {params: Record<string, unknown>};
    enrichWithAccessToken(params?: Record<string, unknown> | null): {
        params: Record<string, unknown>;
    };
    buildRequestConfig(options?: QueryOptions): AxiosRequestConfig;

    request<T = unknown, TPayload = unknown>(
        method: string,
        endpoint: string,
        options?: RequestOptions<TPayload>
    ): Promise<DaktelaResponse<T>>;
    get<T = unknown>(endpoint: string, options?: QueryOptions | null): Promise<DaktelaResponse<T>>;
    post<T = unknown, TPayload = unknown>(
        endpoint: string,
        payload: TPayload,
        params?: Record<string, unknown> | null,
        requestConfig?: AxiosRequestConfig | null
    ): Promise<DaktelaResponse<T>>;
    put<T = unknown, TPayload = unknown>(
        endpoint: string,
        payload: TPayload,
        params?: Record<string, unknown> | null,
        requestConfig?: AxiosRequestConfig | null
    ): Promise<DaktelaResponse<T>>;
    delete<T = unknown>(
        endpoint: string,
        params?: Record<string, unknown> | null,
        requestConfig?: AxiosRequestConfig | null
    ): Promise<DaktelaResponse<T>>;

    ping(requestConfig?: AxiosRequestConfig | null): Promise<boolean>;
    healthCheck(requestConfig?: AxiosRequestConfig | null): Promise<HealthCheckResult>;
    pages<T = unknown>(
        endpoint: string,
        options?: IterationOptions
    ): AsyncGenerator<DaktelaResponse<T[]>, void, unknown>;
    iterate<T = unknown>(
        endpoint: string,
        options?: IterationOptions
    ): AsyncGenerator<T, void, unknown>;
    getAll<T = unknown>(
        endpoint: string,
        options?: IterationOptions
    ): Promise<DaktelaResponse<T[]>>;
}

export const PaginationTake: 100;
export const PaginationSkip: 0;
export const SortAscending: 'asc';
export const SortDescending: 'desc';
export const FilterLogicAnd: 'and';
export const FilterLogicOr: 'or';

export function Pagination(take?: number, skip?: number): PaginationValue;
export function Sort(field: string, dir: SortDirection | string): SortValue;
export function FilterSimple<T = unknown>(
    field: string,
    operator: string,
    value: T
): SimpleFilter<T>;

declare const Daktela: {
    DaktelaConnector: typeof DaktelaConnector;
    DaktelaResponse: typeof DaktelaResponse;
    DaktelaError: typeof DaktelaError;
    PaginationTake: typeof PaginationTake;
    PaginationSkip: typeof PaginationSkip;
    Pagination: typeof Pagination;
    SortAscending: typeof SortAscending;
    SortDescending: typeof SortDescending;
    Sort: typeof Sort;
    FilterLogicAnd: typeof FilterLogicAnd;
    FilterLogicOr: typeof FilterLogicOr;
    FilterSimple: typeof FilterSimple;
};

export default Daktela;
