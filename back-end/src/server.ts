import { mkdir } from 'node:fs/promises';
import { app } from './app.js';
import { env } from './env/index.js';

await mkdir(env.UPLOAD_DIR, { recursive: true });

app.listen({ host: env.HOST, port: +env.PORT }).then(() => {
  console.log('Server running!', env.HOST + ':' + env.PORT);
});
