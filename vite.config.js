import {cp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {defineConfig} from 'vite';

const target = process.env.CAPABILITY_API_URL || 'http://127.0.0.1:8765';
const configuredSites=process.env.UAV_CUSTOM_SITES_DIR?resolve(process.env.UAV_CUSTOM_SITES_DIR):null;
const modelDirectories=['**/data/custom-sites','**/.custom-sites-work',
  ...(configuredSites?[configuredSites.replaceAll('\\','/')]:[])];
const modelGlobs=modelDirectories.flatMap(path=>[path,`${path}/**`]);
let publicDir;
export default defineConfig({
  base: './',
  server: {
    proxy: {'/api/capabilities': {target}, '/api/project-chat': {target}, '/api/sites': {target}, '/data/custom-sites/': {target}},
    watch: {ignored:modelGlobs},
    fs: {deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml',
      '**/.git/**', ...modelGlobs]},
  },
  build: {copyPublicDir: false},
  plugins: [{
    name: 'uav-public-assets',
    apply: 'build',
    configResolved(config){publicDir=config.publicDir;},
    async writeBundle(output){
      if(!output.dir)return;
      const custom=resolve(publicDir,'data/custom-sites');
      await cp(publicDir,output.dir,{recursive:true,filter:source=>![custom,configuredSites].includes(resolve(source))});
    },
  }],
});
