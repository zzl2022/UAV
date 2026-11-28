import loadHighs from 'highs';
import runtimeURL from 'highs/runtime?url';
import {estimateFleetCoverage} from './fleet-capacity.js';

self.onmessage=async({data})=>{
 try{
  const solver=await loadHighs({locateFile:()=>runtimeURL});
  self.postMessage({result:estimateFleetCoverage(solver,data)});
 }catch(error){self.postMessage({error:error.message});}
};
