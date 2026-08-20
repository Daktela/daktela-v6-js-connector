'use strict';

const {
    PaginationTake,
    PaginationSkip
} = require('./constants');

function Pagination(take = PaginationTake, skip = PaginationSkip) {
    return {take, skip};
}

function Sort(field, dir) {
    return {field, dir};
}

function FilterSimple(field, operator, value) {
    return {field, operator, value};
}

function isObject(item) {
    return typeof item === 'object' && !Array.isArray(item) && item !== null;
}

module.exports = {
    Pagination,
    Sort,
    FilterSimple,
    isObject
};
