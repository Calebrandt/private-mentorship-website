import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  integrations: [react()],
  base: '/hiring-apply',
  trailingSlash: 'never',
  server: {
    port: 4321,
    host: true,
  },
});
