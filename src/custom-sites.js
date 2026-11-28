import './custom-sites.css';

const API='./api/sites';
const MB=1024*1024;
const APPROVED=/\.(shp|dbf|prj|cpg|tif|tiff|json|glb|jpg|jpeg|png)$/i;
const TIFF=/\.tiff?$/i;
const IMAGE=/\.(tif|tiff|jpg|jpeg|png)$/i;
const SLUG=/^custom-[a-f0-9]{32}$/;
const ROLES=['建筑矢量（必需）','地形 DEM（必需）','影像底图（可选）','白模 tileset（可选）'];
const extension=path=>path.slice(path.lastIndexOf('.')).toLowerCase();
const basename=path=>path.split('/').at(-1);
const directory=path=>path.slice(0,path.lastIndexOf('/')+1);
const stem=path=>basename(path).replace(/\.[^.]+$/,'').toLowerCase();
const paired=(path,source,ext)=>directory(path)===directory(source)&&stem(path)===stem(source)&&extension(path)===ext;
const imageryHint=path=>/影像|image|ortho/i.test(path);
const tiffCache=new WeakMap();

function tiffInfo(file){
  if(!tiffCache.has(file))tiffCache.set(file,(async()=>{
    const header=new DataView(await file.slice(0,16).arrayBuffer());
    const little=header.getUint16(0)===0x4949;
    if(!little&&header.getUint16(0)!==0x4d4d)throw Error('文件不是 TIFF');
    const magic=header.getUint16(2,little),large=magic===43;
    if(magic!==42&&!large)throw Error('文件不是 TIFF');
    const offset=large?Number(header.getBigUint64(8,little)):header.getUint32(4,little);
    const countBytes=large?8:2,entryBytes=large?20:12;
    if(!Number.isSafeInteger(offset)||offset<countBytes||offset+countBytes>file.size)throw Error('TIFF 目录无效');
    const prefix=new DataView(await file.slice(offset,offset+countBytes).arrayBuffer());
    const count=large?Number(prefix.getBigUint64(0,little)):prefix.getUint16(0,little);
    const start=offset+countBytes,end=start+entryBytes*count;
    if(!Number.isSafeInteger(end)||end>file.size||count>65535)throw Error('TIFF 标签无效');
    const entries=new DataView(await file.slice(start,end).arrayBuffer());
    let bands=1,palette=false,geo=false;
    for(let at=0;at<entries.byteLength;at+=entryBytes){
      const tag=entries.getUint16(at,little);
      if(tag===34735||tag===42112)geo=true;
      const valueAt=at+(large?12:8);
      if(tag===277)bands=entries.getUint16(valueAt,little);
      if(tag===262)palette=entries.getUint16(valueAt,little)===3;
    }
    return {bands,palette,geo};
  })().catch(()=>null));
  return tiffCache.get(file);
}

async function buildingFiles(files,paths,shp){
  const errors=[];
  const header=new DataView(await files.get(shp).slice(0,100).arrayBuffer());
  if(header.byteLength<100||header.getUint32(0)!==9994)errors.push(`建筑轮廓不是有效的 Shapefile：${shp}`);
  for(const ext of ['.dbf','.prj']){
    const path=paths.find(path=>paired(path,shp,ext));
    if(!path){errors.push(`缺少与 ${shp} 同目录同名的 ${ext}。`);continue;}
    if(ext==='.prj'){
      const definition=(await files.get(path).slice(0,128).text()).trim();
      if(!/^[A-Z0-9_]+\s*\[/i.test(definition))errors.push(`建筑 .prj 坐标系格式无效：${path}`);
      continue;
    }
    const file=files.get(path);
    const descriptor=new DataView(await file.slice(0,32).arrayBuffer());
    const size=descriptor.byteLength===32?descriptor.getUint16(8,true):0;
    if(size<33||size>file.size){errors.push(`建筑 DBF 文件头无效：${path}`);continue;}
    const fields=new Uint8Array(await file.slice(32,size).arrayBuffer());
    const decoder=new TextDecoder();
    let hasHeight=false;
    for(let offset=0;offset+11<=fields.length&&fields[offset]!==13;offset+=32){
      const name=decoder.decode(fields.subarray(offset,offset+11)).split('\0')[0].trim();
      if(/^(high|height)$/i.test(name)){hasHeight=true;break;}
    }
    if(!hasHeight)errors.push(`建筑 DBF 缺少 high 或 height 高度字段：${path}`);
  }
  return errors;
}

async function inspect(files){
  const errors=[],roles=['待选择','待选择','未提供','未提供'];
  const paths=[...files.keys()];
  const list=items=>items.join('、');
  if(paths.length>200)errors.push('每个模型最多上传 200 个文件。');
  if([...files.values()].reduce((sum,file)=>sum+file.size,0)>200*MB)errors.push('总大小不能超过 200 MB。');
  for(const [path,file] of files){
    if(path.split('/').some(part=>!part||part==='.'||part==='..'||/[<>:"\\|?*\p{Cc}\p{Cf}\p{Cs}]/u.test(part)||/[. ]$/.test(part)
      ||/^(con|prn|aux|nul|(?:com|lpt)[1-9¹²³])\s*(\.|$)/i.test(part)||new TextEncoder().encode(part).length>255)){
      errors.push(`文件路径包含非法字符：${path}`);
    }
    if(file.size===0||file.size>64*MB)errors.push(`文件必须大于 0 字节且不超过 64 MB：${path}`);
  }
  const shapes=paths.filter(path=>extension(path)==='.shp');
  if(shapes.length===1){
    const shp=shapes[0];
    errors.push(...await buildingFiles(files,paths,shp));
    roles[0]=shp;
  }else if(shapes.length)errors.push(`找到 ${shapes.length} 个 .shp，请只保留一个区域：${list(shapes)}`);
  else errors.push('缺少 .shp 建筑文件。');
  const tiles=paths.filter(path=>basename(path).toLowerCase()==='tileset.json');
  if(tiles.length>1)errors.push(`找到多个白模 tileset.json：${list(tiles)}`);
  if(tiles.length===1)roles[3]=tiles[0];

  if(paths.length>200)return {roles,errors};
  const allTiffs=paths.filter(path=>TIFF.test(path));
  const tagged=allTiffs.filter(path=>/dem/i.test(path)&&!imageryHint(path));
  const info=new Map(await Promise.all(allTiffs.map(async path=>[path,await tiffInfo(files.get(path))])));
  const candidates=[...tagged,...allTiffs.filter(path=>{
    const tiff=info.get(path);
    return !tagged.includes(path)&&!imageryHint(path)&&tiff?.bands===1&&!tiff.palette;
  })];
  const dem=candidates.length===1?candidates[0]:null;
  if(dem){
    roles[1]=dem;
    const tiff=info.get(dem);
    if(!tiff||tiff.bands!==1||tiff.palette||!tiff.geo)errors.push(`DEM 必须是带坐标系的单波段 GeoTIFF：${dem}`);
  }else if(candidates.length)errors.push(`找到多个 DEM GeoTIFF：${list(candidates)}`);
  else errors.push('缺少 DEM GeoTIFF。');
  for(const [path,data] of info)if(!data&&path!==dem)errors.push(`无法读取 TIFF 文件：${path}`);
  if(dem){
    const imagery=paths.filter(path=>IMAGE.test(path)&&path!==dem);
    if(imagery.length>1)errors.push(`找到多个影像底图：${list(imagery)}`);
    if(imagery.length===1){
      const image=imagery[0];
      roles[2]=image;
      if(!info.get(image)?.geo&&!paths.some(path=>paired(path,image,'.json')&&path!==tiles[0])){
        errors.push(`影像 ${image} 缺少定位，请同时选择同名 JSON（crs 和 bbox）。`);
      }
    }
  }
  return {roles,errors};
}

export async function requestCustomSites(path='',options={}){
  try{
    const response=await fetch(API+path,options);
    const data=await response.json().catch(()=>null);
    if(!response.ok||!data)throw Error(data?.error??`自定义模型服务请求失败（HTTP ${response.status}），请检查后端是否运行。`);
    return data;
  }catch(error){
    if(error instanceof TypeError)throw Error('无法连接自定义模型服务，请检查后端是否运行。');
    throw error;
  }
}

export function mountCustomSites({menu,select,register,unregister,switchTo,currentSite,announce}){
  const trigger=document.createElement('button');
  trigger.id='add-custom-site';trigger.type='button';trigger.textContent='增加新模型';
  trigger.setAttribute('aria-controls','custom-site-panel');trigger.setAttribute('aria-expanded','false');
  menu.querySelector('#city-scene-page .stats').after(trigger);
  const panel=document.createElement('section');
  panel.id='custom-site-panel';panel.hidden=true;panel.setAttribute('aria-labelledby','custom-site-title');
  panel.innerHTML=`
    <h2 id="custom-site-title">增加新模型</h2>
    <form novalidate>
      <label for="custom-site-name">模型名称</label>
      <input id="custom-site-name" type="text" required placeholder="输入 1–24 个字符">
      <div class="custom-site-actions">
        <button type="button" data-pick="folder">选择文件夹</button>
        <button type="button" data-pick="files">添加文件</button>
        <button type="button" data-clear>清空文件</button>
      </div>
      <input type="file" id="custom-site-folder" webkitdirectory multiple hidden>
      <input type="file" id="custom-site-files" multiple hidden>
      <p id="custom-site-summary"></p>
      <dl>${ROLES.map(label=>`<dt>${label}</dt><dd></dd>`).join('')}</dl>
      <p id="custom-site-feedback" role="status" aria-live="polite"></p>
      <progress id="custom-site-progress" aria-label="生成进度" max="100" value="0" hidden></progress>
      <div class="custom-site-actions">
        <button type="submit" disabled>开始生成</button>
        <button type="button" data-cancel>取消</button>
      </div>
    </form>`;
  menu.append(panel);
  const get=selector=>panel.querySelector(selector);
  const form=get('form'),name=get('#custom-site-name'),folder=get('#custom-site-folder'),picker=get('#custom-site-files');
  const submit=get('[type=submit]'),cancel=get('[data-cancel]'),feedback=get('#custom-site-feedback');
  const summary=get('#custom-site-summary'),progress=get('progress'),roleValues=panel.querySelectorAll('dd');
  const inputs=[name,...panel.querySelectorAll('[data-pick], [data-clear]')],files=new Map();
  let operation=null,inspection=0,listRevision=0,omitted=0,available=false,listError='',deleting=false;
  const customOptions=new Map(),removeButton=menu.querySelector('#delete-custom-site');

  function syncDeleteButton(){
    removeButton.hidden=!customOptions.has(select.value);
    removeButton.disabled=deleting||select.disabled||!!operation;
    removeButton.textContent=deleting?'…':'×';
  }

  function showMessage(message,error=false){
    feedback.textContent=message;
    feedback.dataset.error=String(error);
  }
  function setOpen(value){
    panel.hidden=!value;trigger.setAttribute('aria-expanded',String(value));
    if(value){name.focus();if(!operation)validate();}
    else if(trigger.getClientRects().length)trigger.focus();
  }
  function addSite(site){
    if(!site||!SLUG.test(site.slug)||typeof site.name!=='string')return;
    register(site);
    let option=customOptions.get(site.slug);
    if(!option){
      option=new Option(site.name,site.slug);
      customOptions.set(site.slug,option);
      select.append(option);
    }else option.textContent=site.name;
  }
  function removeSite(slug){
    customOptions.get(slug)?.remove();
    customOptions.delete(slug);
    unregister(slug);
    syncDeleteButton();
  }
  async function refresh(){
    const revision=++listRevision;
    try{
      const result=await requestCustomSites();
      if(revision!==listRevision)return;
      const sites=result.sites??[];
      const slugs=new Set(sites.map(site=>site.slug));
      for(const slug of customOptions.keys())if(!slugs.has(slug)&&slug!==currentSite())removeSite(slug);
      for(const site of sites)addSite(site);
      available=true;listError='';
    }catch(error){if(revision===listRevision)listError=error.message;}
    syncDeleteButton();
    if(!panel.hidden&&!operation)await validate();
  }
  select.addEventListener('change',syncDeleteButton);
  new MutationObserver(syncDeleteButton).observe(select,{attributes:true,attributeFilter:['disabled']});
  removeButton.onclick=async()=>{
    const slug=select.value,option=customOptions.get(slug);
    if(!option||deleting||operation||select.disabled)return;
    const name=option.textContent;
    if(!window.confirm(`删除自定义模型“${name}”？该操作会删除服务器上的模型文件，且无法恢复。`))return;
    const wasActive=currentSite()===slug;
    deleting=true;trigger.disabled=true;syncDeleteButton();
    try{
      if(wasActive&&!await switchTo('recon'))throw Error('无法切换到河南博物院，已中止删除。');
      select.disabled=true;
      announce(`正在删除自定义模型 ${name}…`);
      try{
        await requestCustomSites(`/${slug}`,{method:'DELETE'});
      }catch(error){
        select.disabled=false;
        if(wasActive&&!await switchTo(slug))throw Error(`${error.message}。请在下拉框中重新选择原模型。`);
        throw error;
      }
      removeSite(slug);
      await refresh();
      announce(`已删除自定义模型 ${name}`);
    }catch(error){announce(error.message);}
    finally{
      deleting=false;select.disabled=false;trigger.disabled=false;syncDeleteButton();
      (removeButton.hidden?select:removeButton).focus({preventScroll:true});
    }
  };
  function refreshSummary(){
    const total=[...files.values()].reduce((sum,file)=>sum+file.size,0);
    summary.textContent=`已选 ${files.size} 个文件 · ${(total/MB).toFixed(2)} MB${omitted?` · 已忽略 ${omitted} 个其他文件`:''}`;
  }
  async function validate(){
    const id=++inspection;
    submit.disabled=true;refreshSummary();
    showMessage(files.size?'正在检查文件…':'请选择区域数据文件夹。');
    const {roles,errors}=await inspect(new Map(files));
    if(id!==inspection||operation)return false;
    roles.forEach((value,index)=>{roleValues[index].textContent=value;roleValues[index].title=value;});
    if(!name.value.trim())errors.unshift('请输入模型名称。');
    else if([...name.value.trim()].length>24||/[\p{Cc}\p{Cs}]/u.test(name.value))errors.unshift('模型名称需为 1–24 个字符，且不能包含控制字符。');
    if(!available&&listError)errors.unshift(listError);
    showMessage(errors.join('\n')||'文件检查通过，可以开始生成。',errors.length>0);
    submit.disabled=errors.length>0||!available;
    return !submit.disabled;
  }
  function append(input){
    for(const file of input.files??[]){
      const path=(file.webkitRelativePath?.split('/').slice(1).join('/')||file.name).normalize('NFC');
      if(!APPROVED.test(path)){omitted++;continue;}
      files.set(path,file);
    }
    input.value='';void validate();
  }
  trigger.onclick=()=>{if(!operation&&!deleting)setOpen(panel.hidden);if(!available)void refresh();};
  for(const [input,kind] of [[folder,'folder'],[picker,'files']]){
    get(`[data-pick=${kind}]`).onclick=()=>input.click();
    input.onchange=()=>append(input);
  }
  get('[data-clear]').onclick=()=>{files.clear();omitted=0;void validate();};
  name.oninput=()=>{void validate();};
  cancel.onclick=()=>{
    if(!operation){setOpen(false);return;}
    if(operation.applying)return;
    operation.controller.abort();
    if(operation.upload)void discard(operation.upload);
  };
  panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();cancel.click();}});

  async function discard(upload){
    try{await requestCustomSites(`/uploads/${upload}`,{method:'DELETE'});}
    catch{await refresh();}
  }
  form.onsubmit=async event=>{
    event.preventDefault();
    if(operation||deleting||!await validate()||deleting)return;
    const active={controller:new AbortController(),upload:null,applying:false};
    const {signal}=active.controller;
    operation=active;
    syncDeleteButton();
    for(const input of inputs)input.disabled=true;
    submit.disabled=true;progress.hidden=false;progress.value=0;
    showMessage('正在创建上传会话…');
    try{
      const {uploadId}=await requestCustomSites('/uploads',{method:'POST',signal});active.upload=uploadId;
      const entries=[...files];let uploaded=0;
      for(const [path,file] of entries){
        showMessage(`正在上传 ${uploaded+1}/${entries.length}：${path}`);
        const encoded=path.split('/').map(encodeURIComponent).join('/');
        await requestCustomSites(`/uploads/${uploadId}/${encoded}`,{method:'PUT',signal,body:file});
        progress.value=25*++uploaded/entries.length;
      }
      const {jobId}=await requestCustomSites(`/uploads/${uploadId}/build`,{method:'POST',signal,
        headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.value})});
      while(!signal.aborted){
        const state=await requestCustomSites(`/builds/${jobId}`,{signal});
        if(state.status==='failed')throw Error(state.error||'模型生成失败，请检查源文件。');
        if(state.status==='done'){
          active.applying=true;cancel.disabled=true;
          progress.value=100;showMessage('模型已生成，正在切换…');
          listRevision++;
          addSite(state.site);
          if(!await switchTo(state.site.slug))throw Error('模型已生成，但当前无法加载。请从模型下拉框重试。');
          files.clear();omitted=0;name.value='';setOpen(false);
          return;
        }
        showMessage(state.stage);progress.value=25+state.progress*.75;
        await new Promise(resolve=>setTimeout(resolve,600));
      }
      signal.throwIfAborted();
    }catch(error){
      if(active.upload&&!active.applying&&!signal.aborted)void discard(active.upload);
      showMessage(signal.aborted?'已取消，已选文件可用于重新生成。':error.message,!signal.aborted);
    }finally{
      operation=null;progress.hidden=true;cancel.disabled=false;
      syncDeleteButton();
      for(const input of inputs)input.disabled=false;
      submit.disabled=!files.size;
    }
  };
  syncDeleteButton();
  void refresh();
}
