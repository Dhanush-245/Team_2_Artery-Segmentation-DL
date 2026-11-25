import { useEffect, useState } from 'react';
import { apiUrl } from './api';

type Version = { id: string; note: string; created_at: string };
type Listing = { original_sha256: string; width: number; height: number; versions: Version[] };
export default function ImageMaskReview({imageId, runId, token, sourceHash, canReview}: {imageId: string; runId: string; token: string; sourceHash?: string; canReview: boolean}) {
  const base = `/api/images/${imageId}/analyses/${runId}/mask-review`;
  const [data, setData] = useState<Listing | null>(null);
  const [message, setMessage] = useState('');
  const [pixels, setPixels] = useState<{x:number;y:number;foreground:boolean}[]>([]);
  const [foreground, setForeground] = useState(true);
  const [preview, setPreview] = useState('');
  const [metrics, setMetrics] = useState('');
  const headers = {Authorization: `Bearer ${token}`};
  useEffect(() => { let active = true; fetch(apiUrl(base), {headers:{Authorization:`Bearer ${token}`}}).then(r => r.ok ? r.json() : null).then(value => {if(active)setData(value);}); return () => {active=false;}; }, [base, token]);
  useEffect(() => { let url=''; let active=true; fetch(apiUrl(`/api/images/${imageId}/analyses/${runId}/artifacts/artery_mask`), {headers:{Authorization:`Bearer ${token}`}}).then(r=>r.ok?r.blob():null).then(blob=>{if(blob&&active){url=URL.createObjectURL(blob);setPreview(url);}});return()=>{active=false;if(url)URL.revokeObjectURL(url);};},[imageId,runId,token]);
  async function post(path:string, body:object) {
    const response=await fetch(apiUrl(path),{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json(); if(!response.ok)throw new Error(String(result.detail));return result;
  }
  if(!data)return null;
  return <section className="panel" aria-label="2D mask review and reference metrics">
    <h3>Reviewer mask corrections and reference metrics</h3>
    <p>Corrections use the saved prepared mask grid. Each saved version preserves the original prediction and prior measurements.</p>
    {preview&&<div style={{position:'relative',maxWidth:512}}><img src={preview} alt="Prepared model artery mask" style={{width:'100%',cursor:canReview?'crosshair':'default'}} onClick={event=>{if(!canReview)return;const box=event.currentTarget.getBoundingClientRect();setPixels(p=>p.length>=4096?p:[...p,{x:Math.min(data.width-1,Math.floor((event.clientX-box.left)/box.width*data.width)),y:Math.min(data.height-1,Math.floor((event.clientY-box.top)/box.height*data.height)),foreground}]);}}/>
      <svg viewBox={`0 0 ${data.width} ${data.height}`} style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'}}>{pixels.map((p,i)=><rect key={i} x={p.x} y={p.y} width={1} height={1} fill={p.foreground?'lime':'red'}/>)}</svg></div>}
    {canReview&&<><label>Paint foreground<input type="checkbox" checked={foreground} onChange={e=>setForeground(e.target.checked)}/></label><button type="button" disabled={!pixels.length} onClick={()=>setPixels(p=>p.slice(0,-1))}>Undo pixel</button>
    <form onSubmit={async event=>{event.preventDefault();const note=String(new FormData(event.currentTarget).get('note'));try{const row=await post(base,{original_sha256:data.original_sha256,edits:pixels,note});setData({...data,versions:[...data.versions,row]});setPixels([]);setMessage('Correction saved');}catch(e){setMessage(String(e));}}}>
      <label>Correction reason<input name="note" required maxLength={1000}/></label><button disabled={!pixels.length}>Save correction version ({pixels.length} pixels)</button>
    </form>
    <form onSubmit={async event=>{event.preventDefault();const fields=new FormData(event.currentTarget);const file=fields.get('reference') as File;try{const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);const result=await post(base+'/reference-metrics',{image_sha256:sourceHash,mask_png_base64:btoa(binary),provenance:fields.get('provenance'),same_frame_confirmed:fields.get('confirmed')==='on'});setMetrics(JSON.stringify(result,null,2));}catch(e){setMessage(String(e));}}}>
      <h4>Compare with a source-grid expert reference</h4><label>Binary source-grid PNG<input type="file" name="reference" accept="image/png" required/></label><label>Reference author and provenance<input name="provenance" minLength={10} required/></label><label><input type="checkbox" name="confirmed" required/>I verified the reference matches this source frame</label><button disabled={!sourceHash}>Calculate reference metrics</button>
      <p>Distances are in source pixels. Reference provenance is recorded for review. Independent validation requires exposure and expert-reference eligibility checks.</p>
    </form></>}
    <p role="status">{message}</p><ul>{data.versions.map(v=><li key={v.id}>{v.created_at} · {v.note} · {v.id}</li>)}</ul>{metrics&&<pre className="provenance-json">{metrics}</pre>}
  </section>;
}
