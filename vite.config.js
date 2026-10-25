import {defineConfig} from 'vite';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
export default defineConfig({
  base:'./',
  server:{proxy:{'/api/capabilities':{target:process.env.CAPABILITY_API_URL||'http://127.0.0.1:8765'}}},
  build:{rollupOptions:{input:{main:resolve(root,'index.html'),sat3dgen:resolve(root,'sat3dgen.html'),beijing:resolve(root,'beijing.html')}}},
});
