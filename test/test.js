
require('dotenv').config();
const Daktela = require('daktela-connector')
const daktela = new Daktela.DaktelaConnector(process.env.INSTANCE, process.env.ACCESS_TOKEN);
const currentDateTime = Date.now()

test('Pagination test', () => {
    let pagination = Daktela.Pagination()
    expect(pagination.take).toBe(Daktela.PaginationTake);
    expect(pagination.skip).toBe(Daktela.PaginationSkip);

    let take = 321
    pagination = Daktela.Pagination(take)
    expect(pagination.take).toBe(take);
    expect(pagination.skip).toBe(Daktela.PaginationSkip);

    take = 567
    skip = 250
    pagination = Daktela.Pagination(take, skip)

    expect(pagination.take).toBe(take);
    expect(pagination.skip).toBe(skip);
});

test('Sort test', () => {
    const field = 'field_xxx'
    let sort = Daktela.Sort(field, Daktela.SortAscending)

    expect(sort.field).toBe(field);
    expect(sort.dir).toBe(Daktela.SortAscending);
});

test('Filter test', () => {
    const field = 'field_yyy'
    const operator = 'neq'
    const value = 'test_zzz'
    let filter = Daktela.FilterSimple(field, operator, value)

    expect(filter.field).toBe(field);
    expect(filter.operator).toBe(operator);
    expect(filter.value).toBe(value);
});

test('Build params test', () => {
    const fields = ['a', 'b']
    const take = 50
    let options = {
        params: {
            xxx: 'yyy'
        },
        fields: fields,
        sort: [
            Daktela.Sort('edited', Daktela.SortDescending), 
            Daktela.Sort('title', Daktela.SortAscending)
        ],
        pagination: Daktela.Pagination(take)
    }
    let params = daktela.buildRequestParams(options)
    expect(params.params.xxx).toBe('yyy');
    expect(params.params.fields).toBe(undefined);
    expect(params.params.accessToken).toBe(undefined);

    options.params = undefined
    params = daktela.buildRequestParams(options)
    expect(params.params.fields).toBe(fields)
    expect(params.params.sort.length).toBe(2)
    expect(params.params.sort[0].field).toBe('edited')
    expect(params.params.sort[0].dir).toBe('desc')
    expect(params.params.sort[1].field).toBe('title')
    expect(params.params.sort[1].dir).toBe('asc')
    expect(params.params.take).toBe(take)
    expect(params.params.skip).toBe(Daktela.PaginationSkip)

    const filters = [
        Daktela.FilterSimple('firstname', 'eq', 'John'),
        Daktela.FilterSimple('lastname', 'neq', 'Doe')
    ]
    options = {
        filters: filters
    }
    params = daktela.buildRequestParams(options)
    expect(params.params.filter.logic).toBe(Daktela.FilterLogicAnd)
    expect(params.params.filter.filters.length).toBe(2)
    expect(params.params.filter.filters[0].field).toBe('firstname')
    expect(params.params.filter.filters[0].operator).toBe('eq')
    expect(params.params.filter.filters[0].value).toBe('John')
    expect(params.params.filter.filters[1].field).toBe('lastname')
    expect(params.params.filter.filters[1].operator).toBe('neq')
    expect(params.params.filter.filters[1].value).toBe('Doe')

    const filter = {
        logic: Daktela.FilterLogicOr,
        filters: [
            Daktela.FilterSimple('edited', 'lte', '2023-12-31')
        ]
    }
    options = {
        filter: filter
    }
    params = daktela.buildRequestParams(options)
    expect(params.params.filter.logic).toBe(Daktela.FilterLogicOr)
    expect(params.params.filter.filters.length).toBe(1)
    expect(params.params.filter.filters[0].field).toBe('edited')
    expect(params.params.filter.filters[0].operator).toBe('lte')
    expect(params.params.filter.filters[0].value).toBe('2023-12-31')

    options = {
        filters: filters,
        filter: filter
    }
    params = daktela.buildRequestParams(options)
    expect(params.params.filter.logic).toBe(Daktela.FilterLogicAnd)
    expect(params.params.filter.filters.length).toBe(3)
    expect(params.params.filter.filters[0].field).toBe('firstname')
    expect(params.params.filter.filters[0].operator).toBe('eq')
    expect(params.params.filter.filters[0].value).toBe('John')
    expect(params.params.filter.filters[1].field).toBe('lastname')
    expect(params.params.filter.filters[1].operator).toBe('neq')
    expect(params.params.filter.filters[1].value).toBe('Doe')
    expect(params.params.filter.filters[2].logic).toBe(Daktela.FilterLogicOr)
    expect(params.params.filter.filters[2].filters.length).toBe(1)
    expect(params.params.filter.filters[2].filters[0].field).toBe('edited')
    expect(params.params.filter.filters[2].filters[0].operator).toBe('lte')
    expect(params.params.filter.filters[2].filters[0].value).toBe('2023-12-31')

    const daktela2 = new Daktela.DaktelaConnector(process.env.INSTANCE, process.env.ACCESS_TOKEN, {
        cookieAuth: false
    });
    params = daktela2.buildRequestParams()
    expect(params.params.accessToken).toBe(process.env.ACCESS_TOKEN)
});

test('Initial request test', async () => {
    const daktela2 = new Daktela.DaktelaConnector(process.env.INSTANCE)
    const r = await daktela2.get('whoim')
    expect(r.status).toBe(200)
    expect(r.total).toBe(undefined)
    expect(r.data.version).not.toBe(null)
    expect(r.data.user).not.toBe(undefined)
    expect(r.data.user).toBe(null)
});

test('Access token test', async () => {
    const r = await daktela.get('whoim')
    expect(r.status).toBe(200)
    expect(r.data.user).not.toBe(null)
    expect(r.data.user._sys.accessToken).toBe(process.env.ACCESS_TOKEN)
});

test('Exception test', async () => {
    expect(daktela.get('xxx')).rejects.toThrow(Daktela.DaktelaError)
    expect(daktela.get('tickets/xxx')).rejects.toThrow(Daktela.DaktelaError)
    expect(daktela.post('login', {'username': 'xyz', 'password': '-123'})).rejects.toThrow(Daktela.DaktelaError)
});

describe('CRUD test', () => {
    const name = 'name_' + currentDateTime
    const title = 'title_' + currentDateTime

    test('POST request test', async () => {
        const r = await daktela.post('statuses', {
            name: name,
            title: title
        })
        expect(r.status).toBe(201)
        expect(r.data.name).toBe(name)
        expect(r.data.title).toBe(title)
    })
    
    test('GET request test', async () => {
        const r = await daktela.get('statuses/' + name)
        expect(r.status).toBe(200)
        expect(r.data.title).toBe(title)
    })

    test('GET all request test', async () => {
        const r = await daktela.get('statuses', {
            filters: [Daktela.FilterSimple('name', 'eq', name)]
        })
        expect(r.status).toBe(200)
        expect(r.total).toBe(1)
        expect(r.data[0].name).toBe(name)
        expect(r.data[0].title).toBe(title)
    })

    test('PUT request test', async () => {
        const description = 'test XXX'
        const r = await daktela.put('statuses/' + name, {
            description: description
        })
        expect(r.status).toBe(200)
        expect(r.data.name).toBe(name)
        expect(r.data.description).toBe(description)
    })

    test('DELETE request test', async () => {
        const r = await daktela.delete('statuses/' + name)
        expect(r.status).toBe(204)
        expect(r.data).toBe(null)
    })
});
