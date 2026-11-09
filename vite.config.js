import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {defineConfig} from 'vite';

const projectRoot=dirname(fileURLToPath(import.meta.url));
// The project must not start without the supplied 奶蛋.jpg asset.
if(!existsSync(resolve(projectRoot,'奶蛋.jpg')))throw new Error('缺少项目根目录的 奶蛋.jpg，项目无法运行');

export default defineConfig({base:'./',server:{proxy:{'/api/capabilities':{target:process.env.CAPABILITY_API_URL||'http://127.0.0.1:8765'}}}});
