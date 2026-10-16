import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {createRequire} from 'node:module'
import Graph from 'graphology'
import {calcolaCameraCompleta,calcolaRatioDettaglio} from '../src/camera-fit.js'
import {proporzionaAziende} from '../src/company-layout.js'
import {classificaProdotto,confrontaProdottiClassificati} from '../src/product-taxonomy.js'
const require=createRequire(import.meta.url)
const {createNormalizationFunction:normalize,getCorrectionRatio:correction}=require('../node_modules/sigma/dist/normalization-aed467cc.cjs.prod.js')
const root=new URL('../',import.meta.url)
const source=fs.readFileSync(process.env.DESIGN_NETWORK_APP_SOURCE||new URL('src/App.jsx',root),'utf8').replace(/\r\n/g,'\n')
const data=n=>JSON.parse(fs.readFileSync(new URL('src/data/'+n+'.json',root),'utf8'))
const prefix=source.slice(0,source.indexOf('function preloadImages')).replace(/^import .*\n/gm,'')
const layout=source.slice(source.indexOf('    const prodottiPerDesigner = {}'),source.indexOf('    const renderer = new Sigma'))
const bboxStart=source.indexOf('    // Il layout può superare')
const bboxEnd=source.indexOf('    impostaBBoxCondiviso()',bboxStart)+'    impostaBBoxCondiviso()'.length
const restoreStart=source.indexOf('    let cameraImpostata = false')
const restoreEnd=source.indexOf('    if (!cameraImpostata && graph.hasNode(',restoreStart)
function between(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b)}
let checked=0
const references=new Map()
for(const [width,height,mobile]of[[1440,900,false],[1366,768,false],[1920,1080,false],[768,1024,false],[390,844,true],[844,390,true]]){
 for(const restored of ['designer','prodotti','aziende']){
  let bbox;const viewport={width,height};const settings={};const cameraState={x:.5,y:.5,ratio:1,angle:0}
  const project=p=>{const {width:w,height:h}=viewport;const n=normalize(bbox)(p);const scale=(Math.min(w,h)-60)*correction(viewport,{width:bbox.x[1]-bbox.x[0],height:bbox.y[1]-bbox.y[0]})/cameraState.ratio;return{x:w/2+(n.x-cameraState.x)*scale,y:h/2-(n.y-cameraState.y)*scale}}
  const context={proporzionaAziende,classificaProdotto,confrontaProdottiClassificati,calcolaCameraCompleta,calcolaRatioDettaglio,window:{innerWidth:width,innerHeight:height,matchMedia:()=>({matches:mobile})},navigator:{maxTouchPoints:mobile?1:0},container:{getBoundingClientRect:()=>({width,height,top:0})},topBarRef:{current:null},isMobile:mobile,modelloVista:restored,vistaCorrenteRef:{current:restored},timelineAttivaRef:{current:false},designerAlphaAnimata:1,aziendaAlphaAnimata:0,cameraRatio:1,graph:new Graph(),animated:{},designers:data('designers'),prodotti:data('prodotti'),relazioni:data('relazioni'),aziendeData:data('aziende'),immaginiEsistentiArr:data('immagini_esistenti'),coloriImmaginiPrecalcolati:data('colori_immagini'),renderer:{getStagePadding:()=>30,setCustomBBox:b=>{bbox=b},setSetting:(k,v)=>{settings[k]=v},graphToViewport:project,refresh(){}},camera:{getState:()=>({...cameraState}),setState:value=>{Object.assign(cameraState,value);cameraState.ratio=Math.max(settings.minCameraRatio,Math.min(settings.maxCameraRatio,cameraState.ratio));context.cameraRatio=cameraState.ratio}}}
  const sandbox=vm.createContext(context)
  const result=vm.runInContext(prefix+layout.replaceAll('import.meta.env.BASE_URL','"/"')+source.slice(bboxStart,bboxEnd)+'\n;({fit:cameraCompleta("prodotti"),sharedFit:cameraCompleta("designer"),points:graph.filterNodes((_,a)=>a.tipo==="prodotto").map(n=>{const a=graph.getNodeAttributes(n);return {name:a.dati.nome,x:a.prodottiX,y:a.prodottiY}}),geometry:graph.mapNodes((n,a)=>[n,a.orbitaX,a.orbitaY,a.timelineX,a.timelineY,a.aziendaOrbitaX,a.aziendaOrbitaY,a.aziendaTimelineY,a.prodottiX,a.prodottiY]),companies:Object.entries(aziendePosizioniMap).map(([n,p])=>[n,p.x,p.y])})',sandbox)
  context.modelloVista='prodotti';context.camera.setState(result.fit)
  const uiScale=.6+width/1440*.4;const clipTop=mobile?112:110*uiScale
  const radius=mobile?7:13
  const cropped=result.points.filter(p=>{const s=project(p);return s.y-radius<clipTop||s.y+radius>height-(mobile?10:16)||(!mobile&&(s.x-radius<20||s.x+radius>width-40))})
  assert.equal(cropped.length,0,`${width}x${height}, partenza ${restored}: ${cropped.length} prodotti tagliati; ${cropped.slice(0,3).map(p=>p.name).join(', ')}`)
  assert.equal(result.points.length,data('prodotti').length)
  const signature=JSON.stringify({bbox,fit:result.sharedFit,geometry:result.geometry,companies:result.companies})
  const key=`${width}x${height}`
  if(restored==='designer')references.set(key,signature)
  else assert.equal(signature,references.get(key),'La vista salvata non deve cambiare il bbox o la geometria Designer/Aziende')
  vm.runInContext(between('    function zoomT()','    // Le linee vita'),sandbox)
  vm.runInContext(between('    function ratioDaT(t)','    // Scala reale comune'),sandbox)
  const productHome=vm.runInContext('ratioDaT(0)',sandbox)
  assert.ok(Math.abs(productHome-result.fit.ratio)<1e-12,'0% Prodotti deve coincidere col fit completo')
  assert.ok(Math.abs(vm.runInContext('zoomT()',sandbox))<1e-12)
  context.modelloVista='designer'
  assert.ok(Math.abs(vm.runInContext('ratioDaT(0)',sandbox)-result.sharedFit.ratio)<1e-12)
  const sharedEnd=vm.runInContext('ratioDaT(1)',sandbox);context.modelloVista='prodotti'
  assert.equal(vm.runInContext('ratioDaT(1)',sandbox),sharedEnd,'Il massimo ingrandimento resta invariato')
  vm.runInContext(between('    function clampCameraAllaGriglia(state)','    camera.on("updated"'),sandbox)
  context.camera.setState({...result.fit,ratio:settings.maxCameraRatio*1.2})
  vm.runInContext('clampCameraAllaGriglia(camera.getState())',sandbox)
  assert.ok(Math.abs(cameraState.ratio-result.fit.ratio)<1e-12,'Clamp sulla panoramica Prodotti')
  context.modelloVista='designer';context.camera.setState({...result.sharedFit,ratio:settings.maxCameraRatio})
  vm.runInContext('clampCameraAllaGriglia(camera.getState())',sandbox)
  assert.ok(Math.abs(cameraState.ratio-result.sharedFit.ratio)<1e-12,'Designer non deve poter superare la panoramica già tarata')
  context.modelloVista='prodotti';context.localStorage={getItem:()=>JSON.stringify({...result.sharedFit})}
  vm.runInContext(source.slice(restoreStart,restoreEnd),sandbox)
  assert.ok(Math.abs(cameraState.ratio-result.fit.ratio)<1e-12,'Una vecchia panoramica Prodotti salvata va migrata')
  assert.ok(Math.abs(cameraState.y-result.fit.y)<1e-12)
  const savedDetail={x:.47,y:.6,ratio:(settings.minCameraRatio+result.fit.ratio)/2,productFitVersion:1}
  context.localStorage={getItem:()=>JSON.stringify(savedDetail)}
  vm.runInContext('{'+source.slice(restoreStart,restoreEnd)+'}',sandbox)
  assert.equal(cameraState.x,savedDetail.x);assert.equal(cameraState.y,savedDetail.y);assert.equal(cameraState.ratio,savedDetail.ratio)
  context.camera.setState(result.fit)
  let resizeCallback
  context.container={getBoundingClientRect:()=>({...viewport,top:0}),get clientWidth(){return viewport.width},get clientHeight(){return viewport.height}}
  context.ResizeObserver=class{constructor(cb){resizeCallback=cb}observe(){}}
  context.impostaStileContainer=()=>{};context.ridimensionaOverlay=()=>{};context.richiediDisegnoOverlay=()=>{}
  vm.runInContext(between('    let dimensioneMinPrecedente =','    Object.values(imgCache)'),sandbox)
  viewport.width+=150;viewport.height-=80;context.window.innerWidth=viewport.width;context.window.innerHeight=viewport.height
  resizeCallback()
  const resizedFit=vm.runInContext('cameraCompleta()',sandbox)
  for(const k of ['x','y','ratio'])assert.ok(Math.abs(cameraState[k]-resizedFit[k])<1e-12,'Resize Prodotti: '+k)
  for(const p of result.points){const s=project(p);assert.ok(s.y-radius>=clipTop&&s.y+radius<=viewport.height-10,'File complete dopo resize')}
  checked++
 }
}
console.log(`${checked} inquadrature su dati reali OK: tutti i ${data('prodotti').length} prodotti entro i bordi verticali, griglia desktop intera, riapertura in tre viste, zoom 0/100%, clamp e migrazione della vecchia panoramica. Designer/Aziende invariati.`)
