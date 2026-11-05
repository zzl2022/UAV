import {defineConfig} from 'vite';
export default defineConfig({base:'./',server:{proxy:{'/api/capabilities':{target:process.env.CAPABILITY_API_URL||'http://127.0.0.1:8765'}}}});
