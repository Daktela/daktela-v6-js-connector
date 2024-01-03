# Daktela V6 JavaScript Connector

Daktela V6 JavaScript Connector is a library that connects your JavaScript application and your Daktela instance through REST API.
Complete documentation of Daktela API is available on following link: https://customer.daktela.com/apihelp/v6/global/general-information.

## Setup

The connector requires following prerequisites:

* Instance URL (e.g. my.daktela.com).
* Access token to access protected Daktela API endpoints.

The only dependency of this library is HTTP client `Axios` (https://axios-http.com/).

## Usage

`DaktelaConnector` is a class that allows you to send CRUD requests on your Daktela server.
Beside `instance` and `accessToken` you can pass `options` object with following parameters:

* `cookieAuth` (boolean) - whether authorize requests via Cookie header or via query parameters. Default value is authorization via cookies.
* `userAgent` (string) - HTTP User-Agent header.
* `timeout` {number} - requests' timeout. Default value is `0` (no timeout).

Once `DaktelaConnector` is initalized you can call HTTP GET, POST, PUT and DELETE requests via provided methods. 

Response is an instance of `DaktelaResponse` which contains:

* `status` (number) - status code of a HTTP request.
* `data` (object or array) - returned data.
* `total` (number) - total number of rows (in case of GET reponse contains multiple objects). 

An request may throw `DaktelaError`. The class contains originally thrown error as well as `status` code and `apiError` returned by Daktela API.

In `options` argument of HTTP GET method `get` you can specify optional arguments of the Daktela API like `fields`, `sort`, `pagination`, `filters` or `filter`.
To build `sort`, `pagination` or `filters` use functions `Sort`, `Pagination`, `FilterSimple` predefined by the library.

Other way is to directly pass Axios's `params` argument which overrides Daktela API parameters and is available in all methods (`get`, `post`, `put`, `delete`).

## Example

```js
require('dotenv').config();
const Daktela = require('daktela-connector');
let daktela = new Daktela.DaktelaConnector(process.env.INSTANCE, process.env.ACCESS_TOKEN);

//...

// login request
try {
    const r = await daktela.post('login', {
        username: 'user_1',
        password: 'password_1',
    });
    console.log(r.data);
} catch (e) {
    console.log(e);
}

// filter tickets
try {
    const r = await daktela.get('tickets', {
        pagination: Daktela.Pagination(3),
        fields: ['name', 'title', 'category', 'user'],
        sort: Daktela.Sort('edited', Daktela.SortDescending),
        filters: [Daktela.FilterSimple('stage', 'eq', 'OPEN')]
    });
    console.log(r.data);
} catch (e) {
  console.log(e);
}
```