import {defineConfig} from 'vite';

const target = process.env.CAPABILITY_API_URL || 'http://127.0.0.1:8765';
export default defineConfig({
  base: './',
  server: {proxy: {'/api/capabilities': {target}, '/api/project-chat': {target}}},
});
