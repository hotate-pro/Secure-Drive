import "./style.css";
import { hasUsers, saveUser, listUsers, sha256, writeLog, deleteUser } from "./storage.js";
import { renderCardQR, scanQR } from "./qr.js";
import { initFaceEngine, detect, embeddingFromDetection, cosine, poseSignal, getProvider } from "./face-engine.js";

const app=document.querySelector("#app");
let engineReady=false;
let stream=null;
let loop=null;
let scratch=document.createElement("canvas");
let authBusy=false;

function shell(body){
  app.innerHTML=`
    <main class="shell">
      <header class="header">
        <div class="brand">🔐 Secure Drive</div>
        <div class="badge">AUTH V0.1 · local</div>
      </header>
      ${body}
    </main>`;
}

function setStatus(text,kind=""){
  const el=document.querySelector("#status");
  if(el){el.textContent=text; el.className="status "+kind;}
}

function cameraHTML(){
  return `
    <div class="camera-wrap">
      <video id="video" autoplay muted playsinline></video>
      <canvas id="overlay" class="overlay"></canvas>
      <div class="camera-guide"></div>
    </div>
    <div class="progress"><div id="progress"></div></div>`;
}

async function startCamera(){
  stopCamera();
  stream=await navigator.mediaDevices.getUserMedia({
    video:{facingMode:"user",width:{ideal:1280},height:{ideal:720}},
    audio:false
  });
  const v=document.querySelector("#video");
  v.srcObject=stream;
  await v.play();
}

function stopCamera(){
  if(loop){cancelAnimationFrame(loop);loop=null;}
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
}

function videoCanvas(){
  const v=document.querySelector("#video");
  scratch.width=v.videoWidth;
  scratch.height=v.videoHeight;
  scratch.getContext("2d").drawImage(v,0,0);
  return scratch;
}

function drawFace(d){
  const c=document.querySelector("#overlay");
  const v=document.querySelector("#video");
  if(!c||!v)return;
  c.width=v.videoWidth;c.height=v.videoHeight;
  const x=c.getContext("2d");
  x.clearRect(0,0,c.width,c.height);
  if(!d)return;
  x.strokeStyle="#60a5fa";x.lineWidth=4;
  x.strokeRect(d.box[0],d.box[1],d.box[2]-d.box[0],d.box[3]-d.box[1]);
  x.fillStyle="#fff";
  for(const p of d.landmarks){x.beginPath();x.arc(p[0],p[1],5,0,Math.PI*2);x.fill();}
}

async function prepareEngine(){
  if(engineReady)return;
  shell(`
    <section class="card"><div class="panel center">
      <div class="title">認証エンジンを準備中</div>
      <div id="status" class="status">モデルを読み込んでいます…</div>
      <div class="notice">モデルはこのサイトにローカル配置します。実行時に外部CDNへ依存しません。</div>
    </div></section>`);
  try{
    await initFaceEngine(t=>setStatus(t));
    engineReady=true;
  }catch(e){
    console.error(e);
    setStatus("モデルを読み込めませんでした。npm run models を実行してから再読み込みしてください。","error");
    throw e;
  }
}

async function home(){
  const users=await listUsers();
  shell(`
    <section class="card"><div class="panel center">
      <div class="title">${users.length?"本人確認":"初回セットアップ"}</div>
      <div class="sub">${users.length
        ?"カードと顔の両方を確認してから認証します。"
        :"最初のユーザーを管理者として登録します。"} </div>
      <div class="actions">
        <button id="primary" class="btn primary">${users.length?"認証する":"管理者を登録する"}</button>
      </div>
      <div id="status" class="status"></div>
    </div></section>
    <div class="grid">
      <div class="notice">🪪 カード: QRは個人情報ではなく暗号学的にランダムなIDだけを持ちます。</div>
      <div class="notice">🙂 顔: 画像そのものではなく、ArcFaceの512次元特徴量を端末内に暗号化保存します。</div>
      <div class="notice">🛡️ 認証: カードだけでは通りません。顔認証とライブネスチャレンジを必須にします。</div>
    </div>`);
  document.querySelector("#primary").onclick=users.length?authenticate:registerAdmin;
}

async function registerAdmin(){
  await prepareEngine();
  await registerUser(true);
}

async function registerUser(isAdmin=false){
  shell(`
    <section class="card"><div class="panel center">
      <div class="title">${isAdmin?"管理者を登録":"ユーザーを登録"}</div>
      <div class="sub">名前を入力してから、顔を正面に向けてください。</div>
      <input id="name" placeholder="表示名" maxlength="40" style="margin-top:16px;width:min(420px,100%);padding:13px;border-radius:12px;border:1px solid #334155;background:#020617;color:white">
      ${cameraHTML()}
      <div id="status" class="status">カメラを起動しています…</div>
      <div class="actions"><button id="capture" class="btn primary">顔を登録</button><button id="cancel" class="btn">戻る</button></div>
    </div></section>`);
  await startCamera();
  document.querySelector("#cancel").onclick=()=>{stopCamera();home();};
  document.querySelector("#capture").onclick=async()=>{
    const name=document.querySelector("#name").value.trim();
    if(!name){setStatus("表示名を入力してください","error");return;}
    try{
      setStatus("顔を検出しています…");
      const samples=[];
      for(let i=0;i<5;i++){
        const c=videoCanvas();
        const ds=await detect(c,0.70);
        if(ds.length!==1){setStatus("顔は1人だけ、正面から写してください","error");return;}
        drawFace(ds[0]);
        samples.push(await embeddingFromDetection(c,ds[0]));
        document.querySelector("#progress").style.width=`${(i+1)*20}%`;
        await new Promise(r=>setTimeout(r,180));
      }
      const avg=Array.from({length:512},(_,i)=>samples.reduce((s,e)=>s+e[i],0)/samples.length);
      const n=Math.hypot(...avg)||1;
      const embedding=avg.map(x=>x/n);
      const token=crypto.randomUUID()+crypto.randomUUID().replaceAll("-","");
      const cardHash=await sha256(token);
      const id=crypto.randomUUID();
      await saveUser({id,name,role:isAdmin?"admin":"user",disabled:false,createdAt:new Date().toISOString(),embedding,cardHash});
      await writeLog("user-created",{id,role:isAdmin?"admin":"user"});
      stopCamera();
      await showIssuedCard({id,name,token,role:isAdmin?"admin":"user"});
    }catch(e){
      console.error(e);setStatus(e.message||"登録に失敗しました","error");
    }
  };
}

async function showIssuedCard(user){
  shell(`
    <section class="card"><div class="panel center">
      <div class="title">カードを発行しました</div>
      <div class="sub">${escapeHtml(user.name)} / ${user.role==="admin"?"管理者":"ユーザー"}</div>
      <canvas id="qr" class="qr"></canvas>
      <div class="token">${escapeHtml(user.token)}</div>
      <div class="notice" style="margin-top:16px">このQR文字列はカードそのものです。スクリーンショットやコピーだけでは顔認証を通過できません。</div>
      <div class="actions"><button id="done" class="btn primary">認証画面へ</button></div>
    </div></section>`);
  await renderCardQR(document.querySelector("#qr"),user.token);
  document.querySelector("#done").onclick=home;
}

async function authenticate(){
  await prepareEngine();
  const users=(await listUsers()).filter(u=>!u.disabled&&!u.corrupt);
  if(!users.length){home();return;}

  shell(`
    <section class="card"><div class="panel center">
      <div class="title">カード認証</div>
      <div class="sub">カードのQRをカメラに映してください。</div>
      ${cameraHTML()}
      <div id="status" class="status">QRコードを探しています…</div>
      <div class="actions"><button id="cancel" class="btn">戻る</button></div>
    </div></section>`);
  await startCamera();
  document.querySelector("#cancel").onclick=()=>{stopCamera();home();};

  let token=null;
  while(!token){
    if(!stream)return;
    token=await scanQR(document.querySelector("#video"),scratch);
    await new Promise(r=>setTimeout(r,120));
  }
  stopCamera();

  const cardHash=await sha256(token);
  const user=users.find(u=>u.cardHash===cardHash);
  if(!user){
    await writeLog("auth-failed",{reason:"unknown-card"});
    setStatus("このカードは登録されていません","error");
    setTimeout(home,1600);return;
  }
  await faceVerify(user);
}

async function faceVerify(user){
  shell(`
    <section class="card"><div class="panel center">
      <div class="title">顔を確認中</div>
      <div class="sub">${escapeHtml(user.name)} さん。画面の指示に従ってください。</div>
      ${cameraHTML()}
      <div id="challenge" class="title" style="font-size:22px">準備しています…</div>
      <div id="status" class="status">カメラを起動しています…</div>
      <div class="actions"><button id="cancel" class="btn">キャンセル</button></div>
    </div></section>`);
  await startCamera();
  document.querySelector("#cancel").onclick=()=>{stopCamera();home();};

  const challenges=Math.random()<.5?["center","left","right"]:["center","right","left"];
  let passed=0, best=-1, bestScore=-1;
  const deadline=Date.now()+25000;

  while(Date.now()<deadline && passed<challenges.length){
    const c=videoCanvas();
    const ds=await detect(c,0.72);
    const d=ds[0];
    drawFace(d);
    if(!d||ds.length!==1){
      setStatus("顔を1人だけ、枠の中に入れてください");
      await sleep(120);continue;
    }
    const p=poseSignal(d);
    const challenge=challenges[passed];
    document.querySelector("#challenge").textContent=
      challenge==="center"?"正面を向いてください":challenge==="left"?"画面の左を向いてください":"画面の右を向いてください";

    // The preview is mirrored for the user. The raw camera frame is not.
    const ok=challenge==="center"?Math.abs(p.yaw)<0.12:challenge==="left"?p.yaw>0.16:p.yaw<-0.16;
    if(ok){
      passed++;
      document.querySelector("#progress").style.width=`${passed/challenges.length*100}%`;
      if(passed<challenges.length) await sleep(300);
    }
    await sleep(100);
  }

  if(passed<challenges.length){
    await writeLog("auth-failed",{reason:"liveness-timeout",userId:user.id});
    stopCamera();setStatus("ライブネス確認に失敗しました","error");setTimeout(home,1600);return;
  }

  setStatus("顔特徴量を照合しています…");
  const c=videoCanvas();
  const ds=await detect(c,0.75);
  if(ds.length!==1){stopCamera();setStatus("顔を取得できませんでした","error");setTimeout(home,1600);return;}
  const emb=await embeddingFromDetection(c,ds[0]);
  const score=cosine(emb,user.embedding);
  const threshold=0.49;
  best=score;

  if(score>=threshold){
    await writeLog("auth-success",{userId:user.id,score:Number(score.toFixed(5)),provider:getProvider()});
    stopCamera();
    shell(`
      <section class="card"><div class="panel center">
        <div style="font-size:64px">✅</div>
        <div class="title">認証成功</div>
        <div class="sub">${escapeHtml(user.name)} さんとして認証しました。</div>
        <div class="notice">顔一致度: ${score.toFixed(3)} / 推奨初期閾値: ${threshold}<br>推論: ${getProvider()}</div>
        <div class="actions"><button id="back" class="btn primary">閉じる</button></div>
      </div></section>`);
    document.querySelector("#back").onclick=home;
  }else{
    await writeLog("auth-failed",{reason:"face-mismatch",userId:user.id,score:Number(score.toFixed(5))});
    stopCamera();setStatus(`顔が一致しませんでした（${score.toFixed(3)}）`,"error");setTimeout(home,1800);
  }
}

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

window.addEventListener("beforeunload",stopCamera);
home();
