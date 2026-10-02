import * as ort from "onnxruntime-web/webgpu";

const SIZE = 640;
const ARC = 112;
const TEMPLATE = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041]
];

let detector;
let recognizer;
let provider = "webgpu";

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

function iou(a,b) {
  const x1=Math.max(a[0],b[0]), y1=Math.max(a[1],b[1]);
  const x2=Math.min(a[2],b[2]), y2=Math.min(a[3],b[3]);
  const w=Math.max(0,x2-x1), h=Math.max(0,y2-y1);
  const inter=w*h;
  const union=(a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-inter;
  return union ? inter/union : 0;
}

function nms(dets, threshold=0.35, max=5) {
  const sorted=[...dets].sort((a,b)=>b.score-a.score);
  const out=[];
  while(sorted.length && out.length<max) {
    const best=sorted.shift();
    out.push(best);
    for(let i=sorted.length-1;i>=0;i--) if(iou(best.box,sorted[i].box)>threshold) sorted.splice(i,1);
  }
  return out;
}

function sigmoidIfNeeded(v) {
  return v < 0 || v > 1 ? sigmoid(v) : v;
}

function decodeYuNet(outputs, width, height, threshold=0.60) {
  const strides=[8,16,32];
  const detections=[];
  for(let l=0;l<3;l++){
    const cls=outputs[l].data;
    const obj=outputs[3+l].data;
    const bb=outputs[6+l].data;
    const kp=outputs[9+l].data;
    const fw=Math.floor(SIZE/strides[l]);
    const count=fw*fw;
    for(let i=0;i<count;i++){
      const score=sigmoidIfNeeded(cls[i])*sigmoidIfNeeded(obj[i]);
      if(score<threshold) continue;
      const px=(i%fw)*strides[l];
      const py=Math.floor(i/fw)*strides[l];
      const cx=bb[i*4]*strides[l]+px;
      const cy=bb[i*4+1]*strides[l]+py;
      const w=Math.exp(Math.min(8,bb[i*4+2]))*strides[l];
      const h=Math.exp(Math.min(8,bb[i*4+3]))*strides[l];
      const k=[];
      for(let j=0;j<5;j++){
        k.push([
          kp[i*10+j*2]*strides[l]+px,
          kp[i*10+j*2+1]*strides[l]+py
        ]);
      }
      detections.push({
        score,
        box:[cx-w/2,cy-h/2,cx+w/2,cy+h/2],
        landmarks:k
      });
    }
  }
  const scaleX=width/SIZE, scaleY=height/SIZE;
  return nms(detections).map(d=>({
    ...d,
    box:d.box.map((v,i)=>v*(i%2?scaleY:scaleX)),
    landmarks:d.landmarks.map(p=>[p[0]*scaleX,p[1]*scaleY])
  }));
}

function canvasRGBTensor(canvas, size) {
  const c=document.createElement("canvas");
  c.width=c.height=size;
  const ctx=c.getContext("2d", {willReadFrequently:true});
  ctx.drawImage(canvas,0,0,size,size);
  const d=ctx.getImageData(0,0,size,size).data;
  const out=new Float32Array(3*size*size);
  let p=0;
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){
    const i=(y*size+x)*4;
    out[p]= (d[i]-127.5)/127.5;
    out[size*size+p]=(d[i+1]-127.5)/127.5;
    out[2*size*size+p]=(d[i+2]-127.5)/127.5;
    p++;
  }
  return new ort.Tensor("float32", out, [1,3,size,size]);
}

function solve4x4(A,b){
  const m=A.map((r,i)=>[...r,b[i]]);
  for(let i=0;i<4;i++){
    let pivot=i;
    for(let r=i+1;r<4;r++) if(Math.abs(m[r][i])>Math.abs(m[pivot][i])) pivot=r;
    [m[i],m[pivot]]=[m[pivot],m[i]];
    const q=m[i][i];
    if(Math.abs(q)<1e-10) throw new Error("Alignment transform is singular");
    for(let j=i;j<5;j++) m[i][j]/=q;
    for(let r=0;r<4;r++) if(r!==i){
      const f=m[r][i];
      for(let j=i;j<5;j++) m[r][j]-=f*m[i][j];
    }
  }
  return m.map(r=>r[4]);
}

function similarityTransform(src,dst){
  const A=[], b=[];
  for(let i=0;i<src.length;i++){
    const [x,y]=src[i], [X,Y]=dst[i];
    A.push([x,-y,1,0]); b.push(X);
    A.push([y,x,0,1]); b.push(Y);
  }
  const ata=Array.from({length:4},()=>Array(4).fill(0));
  const atb=Array(4).fill(0);
  for(let i=0;i<A.length;i++){
    for(let j=0;j<4;j++){
      atb[j]+=A[i][j]*b[i];
      for(let k=0;k<4;k++) ata[j][k]+=A[i][j]*A[i][k];
    }
  }
  return solve4x4(ata,atb);
}

function alignFace(sourceCanvas, landmarks){
  const out=document.createElement("canvas");
  out.width=out.height=ARC;
  const ctx=out.getContext("2d");
  const s=similarityTransform(landmarks,TEMPLATE);
  ctx.setTransform(s[0],s[1],-s[1],s[0],s[2],s[3]);
  ctx.drawImage(sourceCanvas,0,0);
  return out;
}

function l2(v){
  let n=0; for(const x of v)n+=x*x;
  n=Math.sqrt(n)||1;
  return Array.from(v,x=>x/n);
}

export async function initFaceEngine(onProgress=()=>{}){
  onProgress("ONNX Runtimeを準備中…");
  ort.env.wasm.wasmPaths="/ort/";
  ort.env.wasm.numThreads=Math.min(4,navigator.hardwareConcurrency||2);

  const options={graphOptimizationLevel:"all"};
  if(navigator.gpu){
    try {
      detector=await ort.InferenceSession.create("/models/yunet.onnx",{...options,executionProviders:["webgpu"]});
      recognizer=await ort.InferenceSession.create("/models/arcface_mbf.onnx",{...options,executionProviders:["webgpu"]});
      provider="webgpu";
      onProgress("WebGPUで顔認証エンジン準備完了");
      return {provider};
    } catch(e) {
      console.warn("WebGPU initialization failed; falling back to WASM",e);
    }
  }
  detector=await ort.InferenceSession.create("/models/yunet.onnx",{...options,executionProviders:["wasm"]});
  recognizer=await ort.InferenceSession.create("/models/arcface_mbf.onnx",{...options,executionProviders:["wasm"]});
  provider="wasm";
  onProgress("WASMで顔認証エンジン準備完了");
  return {provider};
}

export function getProvider(){ return provider; }

export async function detect(canvas, threshold=0.60){
  if(!detector) throw new Error("Face engine is not initialized");
  const input=canvasRGBTensor(canvas,SIZE);
  const out=await detector.run({[detector.inputNames[0]]:input});
  return decodeYuNet(detector.outputNames.map(n=>out[n]),canvas.width,canvas.height,threshold);
}

export async function embeddingFromDetection(canvas, detection){
  if(!recognizer) throw new Error("Face engine is not initialized");
  const aligned=alignFace(canvas,detection.landmarks);
  const input=canvasRGBTensor(aligned,ARC);
  const out=await recognizer.run({[recognizer.inputNames[0]]:input});
  const first=out[recognizer.outputNames[0]].data;
  return l2(first);
}

export function cosine(a,b){
  let s=0; for(let i=0;i<a.length;i++) s+=a[i]*b[i];
  return s;
}

export function poseSignal(d){
  const [re,le,nose]=d.landmarks;
  const eyeMid=[(re[0]+le[0])/2,(re[1]+le[1])/2];
  const eyeDist=Math.hypot(re[0]-le[0],re[1]-le[1])||1;
  const yaw=(nose[0]-eyeMid[0])/eyeDist;
  const roll=Math.atan2(le[1]-re[1],le[0]-re[0])*180/Math.PI;
  return {yaw,roll};
}
