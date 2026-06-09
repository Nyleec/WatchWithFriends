// Presence and chat integration using WebSocket server
import { initWebOS, MediaService } from './webos.js';

const friends = [];

const friendsListEl = document.getElementById('friendsList');
const chatMessagesEl = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const addFriendBtn = document.getElementById('addFriendBtn');
const removeFriendBtn = document.getElementById('removeFriendBtn');
const roomLabelEl = document.getElementById('roomLabel');

const video = document.getElementById('videoPlayer');
const videoFileInput = document.getElementById('videoFileInput');
const uploadBtn = document.getElementById('uploadBtn');
const uploadProgress = document.getElementById('uploadProgress');
const uploadedKeyDisplay = document.getElementById('uploadedKeyDisplay');
const playPauseBtn = document.getElementById('playPauseBtn');
const syncBtn = document.getElementById('syncBtn');
const videoKeyInput = document.getElementById('videoKeyInput');
const loadVideoBtn = document.getElementById('loadVideoBtn');
const authModal = document.getElementById('authModal');
const authTitle = document.getElementById('authTitle');
const authName = document.getElementById('authName');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authToggleBtn = document.getElementById('authToggleBtn');
const authSubmitBtn = document.getElementById('authSubmitBtn');

function getRoomId(){
  const params = new URLSearchParams(location.search);
  return params.get('room') || 'main';
}

const ROOM_ID = getRoomId();
const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = new URL(`${wsProtocol}//${location.hostname}:3000`);
wsUrl.searchParams.set('room', ROOM_ID);

let ws;
let clientId = null;
let clientName = null;

const UI = {
  setRoomLabel(){
    if(roomLabelEl) roomLabelEl.textContent = `Room: ${ROOM_ID}`;
  },
  renderFriends(){
    friendsListEl.innerHTML = '';
    friends.forEach(f => {
      const li = document.createElement('li');
      li.className = 'friend-item';

      const av = document.createElement('div');
      av.className = 'friend-avatar';
      av.textContent = (f.name||'?')[0];

      const name = document.createElement('div');
      name.className = 'friend-name';
      name.textContent = f.name || 'Guest';

      const status = document.createElement('div');
      status.className = 'friend-status';
      status.textContent = f.id === clientId ? 'You' : 'Watching';

      li.appendChild(av);
      li.appendChild(name);
      li.appendChild(status);
      friendsListEl.appendChild(li);
    });
  },
  addChatMessage(text, who='them', meta){
    const msg = document.createElement('div');
    msg.className = 'chat-msg ' + (who === 'me' ? 'me' : 'them');
    if(meta && meta.name){
      const badge = document.createElement('span');
      badge.style.fontSize = '12px';
      badge.style.opacity = '0.8';
      badge.textContent = `${meta.name}: `;
      msg.appendChild(badge);
    }
    msg.appendChild(document.createTextNode(text));
    chatMessagesEl.appendChild(msg);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }
};

UI.setRoomLabel();

let authMode = 'login';
function showAuth(){ authModal.hidden = false; }
function hideAuth(){ authModal.hidden = true; }
function updateAuthUI(){
  authTitle.textContent = authMode === 'login' ? 'Sign In' : 'Register';
  authToggleBtn.textContent = authMode === 'login' ? 'Switch to Register' : 'Switch to Login';
}
updateAuthUI();
authToggleBtn.addEventListener('click', ()=>{ authMode = authMode === 'login' ? 'register' : 'login'; updateAuthUI(); });
authSubmitBtn.addEventListener('click', async ()=>{
  const name = authName.value.trim();
  const email = authEmail.value.trim();
  const password = authPassword.value;
  try{
    const url = authMode === 'login' ? '/login' : '/register';
    const resp = await fetch(url, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({name,email,password})
    });
    const body = await resp.json();
    if(resp.ok){
      localStorage.setItem('authToken', body.token);
      UI.addChatMessage('Signed in as ' + (body.name || email), 'me');
      hideAuth();
    } else {
      UI.addChatMessage('Auth error: ' + (body.error || resp.statusText), 'them');
    }
  }catch(e){ UI.addChatMessage('Auth request failed: '+String(e), 'them'); }
});

if(!localStorage.getItem('authToken')) showAuth();

const claimHostBtn = document.getElementById('claimHostBtn');
const hostDisplay = document.getElementById('hostDisplay');

function connectWS(){
  ws = new WebSocket(wsUrl.toString());
  ws.addEventListener('open', ()=>{
    UI.addChatMessage(`Connected to server in room ${ROOM_ID}`, 'them');
  });
  ws.addEventListener('message', (ev)=>{
    let msg;
    try{ msg = JSON.parse(ev.data); }catch(e){ return; }
    switch(msg.type){
      case 'host-changed':
        if(msg && msg.id){
          hostDisplay.textContent = 'Host: ' + (msg.name || msg.id.slice(0,6));
          if(msg.id === clientId){
            claimHostBtn.textContent = 'Release Host';
            claimHostBtn.dataset.isHost = '1';
          } else {
            claimHostBtn.textContent = 'Claim Host';
            claimHostBtn.dataset.isHost = '0';
          }
        } else {
          hostDisplay.textContent = 'Host: —';
          claimHostBtn.textContent = 'Claim Host';
          claimHostBtn.dataset.isHost = '0';
        }
        break;
      case 'welcome':
        clientId = msg.id;
        clientName = msg.name;
        friends.length = 0;
        msg.presence.forEach(p => friends.push(p));
        UI.renderFriends();
        UI.addChatMessage(`Welcome ${clientName}`, 'them');
        break;
      case 'presence-join':
        friends.push({id: msg.id, name: msg.name});
        UI.renderFriends();
        UI.addChatMessage(`${msg.name} joined`, 'them');
        break;
      case 'presence-leave':
        const idx = friends.findIndex(f=>f.id===msg.id);
        if(idx !== -1) friends.splice(idx,1);
        UI.renderFriends();
        UI.addChatMessage(`${msg.name} left`, 'them');
        break;
      case 'chat':
        UI.addChatMessage(msg.text, msg.id === clientId ? 'me' : 'them', {name: msg.name});
        break;
      case 'control':
        UI.addChatMessage(`${msg.name} performed ${msg.action} at ${msg.time || 0}s`, 'them');
        if(msg.action === 'play') video.currentTime = msg.time || video.currentTime;
        break;
      case 'time-correction':
        const target = Number(msg.time);
        if(!isNaN(target)){
          const local = video.currentTime || 0;
          const diff = target - local;
          if(Math.abs(diff) < 1.0){
            const original = video.playbackRate || 1.0;
            const nudge = diff * 0.2;
            video.playbackRate = Math.max(0.5, Math.min(1.5, original + nudge));
            setTimeout(()=> video.playbackRate = original, 1200);
            UI.addChatMessage(`Adjusted playback speed to correct ${diff.toFixed(2)}s`, 'them');
          } else {
            video.currentTime = Math.max(0, target);
            UI.addChatMessage(`Seeked to ${Math.floor(target)}s to resync`, 'them');
          }
        }
        break;
    }
  });
  ws.addEventListener('close', ()=>{
    UI.addChatMessage('Disconnected from server', 'them');
    setTimeout(connectWS, 1500);
  });
}

connectWS();

chatForm.addEventListener('submit', (e)=>{
  e.preventDefault();
  const value = chatInput.value.trim();
  if(!value || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({type:'chat', text: value}));
  chatInput.value = '';
});

addFriendBtn.addEventListener('click', ()=>{
  if(ws && ws.readyState === WebSocket.OPEN){
    ws.send(JSON.stringify({type:'chat', text: 'Pretend friend joined (dev)'}));
  }
});

claimHostBtn.addEventListener('click', ()=>{
  if(!ws || ws.readyState !== WebSocket.OPEN) return;
  const isHost = claimHostBtn.dataset.isHost === '1';
  if(isHost){
    ws.send(JSON.stringify({type:'release-host'}));
    UI.addChatMessage('You released host', 'me');
  } else {
    ws.send(JSON.stringify({type:'claim-host'}));
    UI.addChatMessage('You requested to be host', 'me');
  }
});

removeFriendBtn.addEventListener('click', ()=>{
  if(ws && ws.readyState === WebSocket.OPEN){
    ws.send(JSON.stringify({type:'chat', text: 'Pretend friend left (dev)'}));
  }
});

playPauseBtn.addEventListener('click', ()=>{
  if(video.paused){
    const used = performMediaAction('play');
    if(!used){ video.play(); }
    playPauseBtn.textContent = 'Pause';
    if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:'control', action:'play', time: Math.floor(video.currentTime)}));
    UI.addChatMessage('You played the video', 'me');
  } else {
    const used = performMediaAction('pause');
    if(!used){ video.pause(); }
    playPauseBtn.textContent = 'Play';
    if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:'control', action:'pause', time: Math.floor(video.currentTime)}));
    UI.addChatMessage('You paused the video', 'me');
  }
});

syncBtn.addEventListener('click', ()=>{
  const t = Math.floor(video.currentTime);
  if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:'control', action:'sync', time: t}));
  UI.addChatMessage(`Synced to ${t}s`, 'me');
});

loadVideoBtn.addEventListener('click', async ()=>{
  const key = (videoKeyInput.value || '').trim();
  if(!key) return UI.addChatMessage('Enter a video key/path to load', 'me');
  try{
    const headers = {};
    const token = localStorage.getItem('authToken');
    if(token) headers['Authorization'] = 'Bearer ' + token;
    const resp = await fetch(`/video-url?key=${encodeURIComponent(key)}`, {headers});
    const body = await resp.json();
    if(body && body.url){
      video.src = body.url;
      video.load();
      UI.addChatMessage(`Loaded video from ${body.source}`, 'me');
    } else {
      UI.addChatMessage('Failed to get video URL: ' + (body.error || 'unknown'), 'me');
    }
  }catch(e){ UI.addChatMessage('Error fetching video URL: '+String(e), 'me'); }
});

uploadBtn.addEventListener('click', async ()=>{
  const file = videoFileInput.files && videoFileInput.files[0];
  if(!file) return UI.addChatMessage('Select a file to upload', 'me');
  const key = 'uploads/' + Date.now() + '-' + file.name;
  const token = localStorage.getItem('authToken');
  if(!token) return UI.addChatMessage('You must sign in to upload', 'me');
  try{
    const resp = await fetch('/presign-upload', {method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token}, body: JSON.stringify({key, contentType: file.type})});
    const body = await resp.json();
    if(!resp.ok) return UI.addChatMessage('Presign failed: '+(body.error||resp.statusText), 'me');
    const presignedUrl = body.url;
    await new Promise((resolve, reject)=>{
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', presignedUrl, true);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = (e)=>{
        if(e.lengthComputable) uploadProgress.value = Math.round((e.loaded / e.total) * 100);
      };
      xhr.onload = ()=>{
        if(xhr.status >= 200 && xhr.status < 300){ resolve(); }
        else reject(new Error('Upload failed with status '+xhr.status));
      };
      xhr.onerror = ()=> reject(new Error('Upload error'));
      xhr.send(file);
    });
    uploadProgress.value = 100;
    uploadedKeyDisplay.textContent = key;
    UI.addChatMessage('Upload complete: ' + key, 'me');
    videoKeyInput.value = key;
    loadVideoBtn.click();
  }catch(e){ UI.addChatMessage('Upload error: '+String(e), 'them'); }
});

const removeWebOSListener = initWebOS((e)=>{
  UI.addChatMessage('Back key pressed (webOS)', 'them');
}, (keyName)=>{
  if(!keyName) return;
  const k = String(keyName).toLowerCase();
  if(k.includes('play') || k === 'media-play'){
    const used = performMediaAction('play');
    if(!used && video.paused){ video.play(); }
  } else if(k.includes('pause') || k === 'media-pause'){
    const used = performMediaAction('pause');
    if(!used && !video.paused){ video.pause(); playPauseBtn.textContent = 'Play'; }
  } else if(k.includes('stop')){
    video.pause(); video.currentTime = 0; playPauseBtn.textContent = 'Play';
  } else if(k.includes('left')){
    video.currentTime = Math.max(0, video.currentTime - 10);
    if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:'control', action:'seek', time: Math.floor(video.currentTime)}));
  } else if(k.includes('right')){
    video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
    if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:'control', action:'seek', time: Math.floor(video.currentTime)}));
  }
});

function performMediaAction(action){
  const statusEl = document.getElementById('controlStatus');
  if(action === 'play'){
    MediaService.play().then(res=>{
      if(res.ok){ statusEl.textContent = 'System'; statusEl.classList.add('system'); statusEl.classList.remove('error'); }
      else { statusEl.textContent = 'Page'; statusEl.classList.remove('system'); statusEl.classList.remove('error'); }
    }).catch(e=>{ statusEl.textContent = 'Error'; statusEl.classList.add('error'); });
    return true;
  }
  if(action === 'pause'){
    MediaService.pause().then(res=>{
      if(res.ok){ statusEl.textContent = 'System'; statusEl.classList.add('system'); statusEl.classList.remove('error'); }
      else { statusEl.textContent = 'Page'; statusEl.classList.remove('system'); statusEl.classList.remove('error'); }
    }).catch(e=>{ statusEl.textContent = 'Error'; statusEl.classList.add('error'); });
    return true;
  }
  if(action === 'seek'){
    MediaService.seek(Math.floor(video.currentTime)).then(res=>{
      if(res.ok){ statusEl.textContent = 'System'; statusEl.classList.add('system'); statusEl.classList.remove('error'); }
      else { statusEl.textContent = 'Page'; statusEl.classList.remove('system'); statusEl.classList.remove('error'); }
    }).catch(e=>{ statusEl.textContent = 'Error'; statusEl.classList.add('error'); });
    return true;
  }
  return false;
}

UI.addChatMessage('Welcome to Watch With Friends — connect to the server to chat', 'them');

if(typeof MediaService !== 'undefined' && MediaService.subscribeToStatus){
  try{
    const mediaDebugEl = document.getElementById('mediaDebug');
    const unsub = MediaService.subscribeToStatus((res)=>{
      const statusEl = document.getElementById('controlStatus');
      try{
        mediaDebugEl.textContent = JSON.stringify(res, null, 2);
      }catch(e){ mediaDebugEl.textContent = String(res); }
      if(res && (res.playerState || (res.status && res.status.playerState))){
        statusEl.textContent = 'System'; statusEl.classList.add('system'); statusEl.classList.remove('error');
      }
    });
  }catch(e){ console.warn('subscribe failed', e); }
}

if(typeof MediaService !== 'undefined' && MediaService.getStatus){
  MediaService.getStatus().then(r=>{
    const mediaDebugEl = document.getElementById('mediaDebug');
    if(r && r.ok && r.status){
      mediaDebugEl.textContent = JSON.stringify(r.status, null, 2);
      const statusEl = document.getElementById('controlStatus');
      statusEl.textContent = 'System'; statusEl.classList.add('system');
    }
    if(r && !r.ok){
      const mediaDebugEl = document.getElementById('mediaDebug');
      mediaDebugEl.textContent = 'getStatus error: ' + (r.error && r.error.message ? r.error.message : String(r.error));
      const statusEl = document.getElementById('controlStatus');
      statusEl.textContent = 'Page'; statusEl.classList.remove('system');
    }
  }).catch(e=> console.warn('getStatus call failed', e));
}

setInterval(()=>{
  if(ws && ws.readyState === WebSocket.OPEN && !isNaN(video.currentTime)){
    ws.send(JSON.stringify({type:'timeUpdate', time: Math.floor(video.currentTime)}));
  }
}, 2000);
