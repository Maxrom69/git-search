import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createTrendingService, PERIODS, ProviderError } from './trendingProvider.js';

const app = express();
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const builtClient = path.join(projectRoot, 'dist');
const trendingService = createTrendingService();
const port = Number(process.env.API_PORT || process.env.PORT || 3001);

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.get('/api/health', (_request, response) => {
  response.set('Cache-Control', 'no-store').json({ status: 'ok' });
});

app.get('/api/trending', async (request, response) => {
  const period = String(request.query.period ?? 'daily').toLowerCase();
  if (!Object.hasOwn(PERIODS, period)) {
    response.status(400).set('Cache-Control', 'no-store').json({
      error: { code: 'INVALID_PERIOD', message: 'Period must be daily, weekly, or monthly.' },
    });
    return;
  }

  const force = request.query.force === '1' || request.query.force === 'true';
  try {
    const data = await trendingService.getTrending(period, { force });
    response.set('Cache-Control', 'no-store').json(data);
  } catch (error) {
    const providerError = error instanceof ProviderError ? error : null;
    const status = providerError?.status ?? 502;
    if (providerError?.retryAt) {
      const seconds = Math.max(1, Math.ceil((providerError.retryAt - Date.now()) / 1000));
      response.set('Retry-After', String(seconds));
    }
    response.set('Cache-Control', 'no-store').status(status).json({
      error: {
        code: providerError?.code ?? 'UPSTREAM_ERROR',
        message: providerError?.message ?? 'The trending data source could not be reached. Please retry.',
        retryAt: providerError?.retryAt ? new Date(providerError.retryAt).toISOString() : null,
      },
    });
  }
});

app.use('/api', (_request, response) => {
  response.set('Cache-Control', 'no-store').status(404).json({
    error: { code: 'NOT_FOUND', message: 'API route not found.' },
  });
});

if (existsSync(builtClient)) {
  app.use(express.static(builtClient, { index: false, maxAge: '1h' }));
}

app.use((request, response) => {
  if (!existsSync(path.join(builtClient, 'index.html'))) {
    response.status(503).type('text/plain').send('The web client has not been built yet. Run npm run build first.');
    return;
  }
  response.sendFile(path.join(builtClient, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`GitHub Trending API listening on http://0.0.0.0:${port}`);
});
