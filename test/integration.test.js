'use strict';

require('dotenv').config();
const Daktela = require('..');

const hasCredentials = Boolean(process.env.INSTANCE && process.env.ACCESS_TOKEN);
const integrationDescribe = hasCredentials ? describe : describe.skip;

integrationDescribe('live Daktela API integration', () => {
    let client;

    beforeAll(() => {
        client = new Daktela.DaktelaConnector(
            process.env.INSTANCE,
            process.env.ACCESS_TOKEN
        );
    });

    test('authenticates and reads instance information', async () => {
        const response = await client.get('whoim');
        expect(response.status).toBe(200);
        expect(response.data.version).toBeDefined();
        expect(response.data.user).not.toBeNull();
    });

    test('performs CRUD against a temporary status', async () => {
        const name = `connector_test_${Date.now()}`;
        const title = `Connector test ${Date.now()}`;
        let created = false;

        try {
            const create = await client.post('statuses', {name, title});
            created = true;
            expect(create.status).toBe(201);

            const read = await client.get(`statuses/${name}`);
            expect(read.data.title).toBe(title);

            const update = await client.put(`statuses/${name}`, {
                description: 'Updated by connector integration test'
            });
            expect(update.status).toBe(200);
            expect(update.data.description).toBe('Updated by connector integration test');
        } finally {
            if (created) {
                const remove = await client.delete(`statuses/${name}`);
                expect(remove.status).toBe(204);
            }
        }
    });
});
