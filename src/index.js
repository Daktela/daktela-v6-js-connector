const axios = require('axios');

/**
 * Default number of rows to be returned.
 */
const PaginationTake = 100;

/**
 * Default number of rows to be skipped.
 */
const PaginationSkip = 0;

/**
 * Asceding direction of sorting.
 */
const SortAscending = 'asc';

/**
 * Descending direcion of sorting.
 */
const SortDescending = 'desc';

/**
 * Logical AND of Daktela filter.
 */
const FilterLogicAnd = 'and';

/**
 * Logical OR of Daktela filter.
 */
const FilterLogicOr = 'or';

/**
 * Build Daktela's pagination object.
 * 
 * @param {number} [take=PaginationTake]   Number of rows to be returned.
 * @param {number} [skip=PaginationSkip]   Number of rows to be skipped.
 * @return {Object}
 */
const Pagination = function (take = PaginationTake, skip = PaginationSkip) {
    return {
        take: take,
        skip: skip
    };
};

/**
 * Builds Daktela's Sort object.
 * 
 * @param {string} field    Name of field to sort rows by.
 * @param {string} dir      Direction of sorting (allowed values are 'asc' or 'desc'). Defined constants are @see SortAscending and @see SortDescending.
 * @return {Object}
 */
const Sort = function (field, dir) {
    return {
        field: field,
        dir: dir
    };
};

/**
 * Builds Daktela's simple filter.
 *
 * @param {string} field    Name of the field. 
 * @param {string} operator Operator of the filter.
 * @param {string} value    Value use for filtering.
 * @return {Object}
 */
const FilterSimple = function (field, operator, value) {
    return {
        field: field,
        operator: operator,
        value: value
    };
};

/**
 * A class representing Daktela response.
 * 
 * @property {number}           status Status code of the request.
 * @property {Object|Array}     data Returned data (can be object or array).
 * @property {number|undefined} total Total number of rows.
 */
class DaktelaResponse {
    /**
     * @param {axios.AxiosResponse} response 
     */
    constructor(response) {
        var body = response.data;
        this.status = response.status;
        const result = body.result ?? null;
        this.data = result;
        if (result !== null && Array.isArray(result.data)) {
            this.data = result.data;
        }
        if (result !== null && result.total !== null) {
            this.total = result.total;
        }
    }
};

/**
 * A class representing Daktela error.
 * 
 * @property {number|undefined} status Status code of the request.
 * @property {Object|undefined} apiError Error returned by Daktela API.
 */
class DaktelaError extends Error {
    /**
     * @param {Error} prevError Original error thrown during request.
     */
    constructor(prevError) {
        super(prevError.message);
        this.name = 'DaktelaError';
        this.prevError = prevError;
        this.status = null;
        this.apiError = null;
        if (prevError.response) {
            this.status = prevError.response.status;
            if (prevError.response.data.error) {
                this.apiError = prevError.response.data.error;
            }
        }
    }
}

/**
 * Daktela connector. Use its HTTP methods (get, post, put, delete) to send requests to Daktela API.
 *
 * @param {string}  url                 Target Daktela instance (e. g. my.daktela.com).
 * @param {string}  [accessToken=null]  Access token.
 * @param {Object}  [options={}]        Options of the connector. See below.
 * @param {boolean} options.cookieAuth  Authorize requests via Cookie header. Default value is true. Otherwise access token will be passed as query parameter.
 * @param {string}  options.userAgent   User agent header.
 * @param {number}  options.timeout     Specifies the number of milliseconds before the request times out. Default is 0 (no timout)
 */
const DaktelaConnector = function DaktelaConnector(url, accessToken = null, options = {}) {
    if (!url.startsWith('https://')) {
        url = 'https://' + url;
    }
    if (!url.endsWith('/')) {
        url += '/';
    }
    this.cookieAuth = options.cookieAuth ?? true;
    var headers = {};
    if (this.cookieAuth && accessToken != null) {
        headers['Cookie'] = 'c_user=' + accessToken;
    }
    if (options.userAgent !== null) {
        headers['User-Agent'] = options.userAgent;
    }
    this.api = axios.create({
        baseURL: url + 'api/v6/',
        headers: headers,
        timeout: Number.isInteger(options.timeout) && options.timeout >= 0 ? options.timeout : 0
    });
    this.accessToken = accessToken;
};

/**
 * Checks whether given item is an object or not.
 * 
 * @param {any} item 
 * @return {boolean}
 */
function isObject(item) {
    return (typeof item === 'object' && !Array.isArray(item) && item !== null);
}

/**
 * Builds Axios' `config` parameter.
 * 
 * @param {Object|null} options Options of the request.
 * @return {Object}
 */
DaktelaConnector.prototype.buildRequestParams = function (options) {
    let params = {};
    if (isObject(options)) {
        if (isObject(options.params)) {
            params = options.params;
        } else {
            params = {};
            if (Array.isArray(options.fields)) {
                params.fields = options.fields;
            }
            if (Array.isArray(options.sort)) {
                params.sort = options.sort;
            }
            if (isObject(options.pagination)) {
                params.take = options.pagination.take ?? PaginationTake;
                params.skip = options.pagination.skip ?? PaginationSkip;
            }
            if (Array.isArray(options.filters)) {
                params.filter = {
                    logic: FilterLogicAnd,
                    filters: options.filters
                };
            }
            if (isObject(options.filter)) {
                if (isObject(params.filter)) {
                    params.filter.filters.push(options.filter);
                } else {
                    params.filter = options.filter;
                }
            }
        }
    }
    if (!this.cookieAuth && this.accessToken !== null) {
        params.accessToken = this.accessToken;
    }
    return {
        params: params
    };
};

/**
 * 
 * @param {Object|null} options 
 * @return 
 */
DaktelaConnector.prototype.enrichWithAccessToken = function (params) {
    return this.buildRequestParams({
        params: params
    });
};

/**
 * HTTP GET method.
 *
 * @param {string}           endpoint            Target endpoint (e.g. 'activities' or 'activities/activity_xxx').
 * @param {Object}           [options=null]      Options of the request. See below.
 * @param {Object}           options.params      Params of the Axios library. Useful to directly pass query params to the request. This value overrides all other options (i.e.: pagination, filter, sort).
 * @param {Array<string>}    options.fields      List of fields to be returned in response.
 * @param {Array<object>}    options.sort        List of Daktela's sorts. Use @function Sort to build single sort.
 * @param {object}           options.pagination  Pagination of the request. Use @function Pagination to build Daktela pagignation.
 * @param {Array<object>}    options.filters     List of simple filters (i.e. filters merged by AND condition). Use @see SimpleFilter to build simple Daktela filter. In one request use either simple filters or custom filtering object - not both of them.
 * @param {object}           options.filter      Object containing custom filter. In one request use either simple filters or custom filtering object - not both of them.
 * @throws {DaktelaError}
 * @return {Promise<DaktelaResponse>}
 */
DaktelaConnector.prototype.get = async function (endpoint, options = null) {
    try {
        const response = await this.api.get(endpoint, this.buildRequestParams(options));
        return new DaktelaResponse(response);
    } catch (error) {
        throw new DaktelaError(error);
    }
};

/**
 * HTTP POST method.
 * 
 * @param {string} endpoint         Target endpoint (e.g. 'activities' or 'tickets').
 * @param {Object} payload          Data payload of the request.
 * @param {Object} [params=null]    Params of the Axios library. Useful to directly pass query params to the request.
 * @throws {DaktelaError}
 * @return {Promise<DaktelaResponse>}
 */
DaktelaConnector.prototype.post = async function (endpoint, payload, params = null) {
    try {
        const response = await this.api.post(endpoint, payload, this.enrichWithAccessToken(params));
        return new DaktelaResponse(response);
    } catch (error) {
        throw new DaktelaError(error);
    }
};

/**
 * HTTP PUT method.
 * 
 * @param {string} endpoint         Target endpoint (e.g. 'activities/activity_xxx' or 'tickets/123').
 * @param {Object} payload          Data payload of the request.
 * @param {Object} [params=null]    Params of the Axios library. Useful to directly pass query params to the request.
 * @throws {DaktelaError}
 * @return {Promise<DaktelaResponse>}
 */
DaktelaConnector.prototype.put = async function (endpoint, payload, params = null) {
    try {
        const response = await this.api.put(endpoint, payload, this.enrichWithAccessToken(params));
        return new DaktelaResponse(response);
    } catch (error) {
        throw new DaktelaError(error);
    }
};

/**
 * HTTP DELETE method.
 * 
 * @param {string} endpoint         Target endpoint (e.g. 'activities/activity_xxx' or 'tickets/123').
 * @param {Object} [params=null]    Params of the Axios library. Useful to directly pass query params to the request.
 * @throws {DaktelaError}
 * @return {Promise<DaktelaResponse>}
 */
DaktelaConnector.prototype.delete = async function (endpoint, params = null) {
    try {
        const response = await this.api.delete(endpoint, this.enrichWithAccessToken(params));
        return new DaktelaResponse(response);
    } catch (error) {
        throw new DaktelaError(error);
    }
};

module.exports = {
    DaktelaConnector,
    DaktelaResponse,
    DaktelaError,
    PaginationTake,
    PaginationSkip,
    Pagination,
    SortAscending,
    SortDescending,
    Sort,
    FilterLogicAnd,
    FilterLogicOr,
    FilterSimple
};