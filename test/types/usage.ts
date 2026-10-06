import axios from 'axios';
import Daktela, {
    DaktelaConnector,
    DaktelaError,
    DaktelaResponse,
    FilterSimple,
    Pagination,
    Sort,
    SortDescending,
    type HealthCheckResult
} from '../..';

type Ticket = {
    name: string;
    title: string;
};

const injected = axios.create({adapter: 'fetch'});
const client = new DaktelaConnector('https://example.daktela.test', 'token', {
    axiosInstance: injected,
    timeout: 10_000,
    retry: {
        retries: 3,
        methods: ['get'],
        statusCodes: [500, 502, 503, 504]
    },
    rateLimit: true,
    logger: {
        debug(message, context) {
            void message;
            void context;
        }
    }
});

const defaultClient = new Daktela.DaktelaConnector('example.daktela.test');
void defaultClient;

async function useConnector(): Promise<void> {
    const response: DaktelaResponse<Ticket[]> = await client.get<Ticket[]>('tickets', {
        pagination: Pagination(100, 0),
        fields: ['name', 'title'],
        sort: Sort('edited', SortDescending),
        filters: [FilterSimple('stage', 'eq', 'OPEN')],
        requestConfig: {signal: new AbortController().signal}
    });

    if (response.isSuccess() && !response.hasErrors()) {
        response.data?.forEach((ticket) => ticket.title);
    }

    for await (const ticket of client.iterate<Ticket>('tickets', {
        pageSize: 100,
        maxItems: 500,
        stopOnError: false,
        maxConsecutiveErrors: 5
    })) {
        ticket.name;
    }

    const all = await client.getAll<Ticket>('tickets');
    all.data?.map((ticket) => ticket.name);

    const health: HealthCheckResult = await client.healthCheck();
    health.latencyMs;
}

function handle(error: unknown): void {
    if (error instanceof DaktelaError) {
        error.status;
        error.retryAfter;
        error.isCanceled;
    }
}

void useConnector;
void handle;
