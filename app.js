// Presence and chat integration using WebSocket server
import { initWebOS, requestSystemInfo, MediaService } from './webos.js';

const friends = []; // will be populated from server presence

const friendsListEl = document.getElementById('friendsList');
const chatMessagesEl = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const addFriendBtn = document.getElementById('addFriendBtn');
const removeFriendBtn = document.getElementById('removeFriendBtn');

const video = document.getElementById('videoPlayer');
const playPauseBtn = document.getElementById('playPauseBtn');
const syncBtn = document.getElementById('syncBtn');

let clientId = null;
let clientName = null;

function renderFriends(){
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
  })
}

function addChatMessage(text, who='them', meta){
  const msg = document.createElement('div');
  msg.className = 'chat-msg ' + (who === 'me' ? 'me' : 'them');
  msg.textContent = text;
  if(meta && meta.name){
    const badge = document.createElement('div');
    badge.style.fontSize = '12px';
    badge.style.opacity = '0.8';
    badge.textContent = meta.name + ': ';
    msg.textContent = text;
  }
  chatMessagesEl.appendChild(msg);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

// Connect to WebSocket server (assumes same host + port 3000 or configurable)
const wsUrl = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? `ws://${location.hostname}:3000` : `ws://${location.hostname}:3000`;
let ws;
const claimHostBtn = document.getElementById('claimHostBtn');
const hostDisplay = document.getElementById('hostDisplay');
function connectWS(){
  ws = new WebSocket(wsUrl);
  ws.addEventListener('open', ()=>{
    addChatMessage('Connected to server', 'them');
  });
  ws.addEventListener('message', (ev)=>{
    let msg; try{ msg = JSON.parse(ev.data); }catch(e){return}
    switch(msg.type){
      case 'host-changed':
        // update UI to show current host and toggle claim button
        if(msg && msg.id){
          hostDisplay.textContent = 'Host: ' + (msg.name || msg.id.slice(0,6));
          if(msg.id === clientId){ claimHostBtn.textContent = 'Release Host'; claimHostBtn.dataset.isHost = '1'; }
          else { claimHostBtn.textContent = 'Claim Host'; claimHostBtn.dataset.isHost = '0'; }
        } else {
          hostDisplay.textContent = 'Host: —';
          claimHostBtn.textContent = 'Claim Host'; claimHostBtn.dataset.isHost = '0';
        }
        break;
      case 'welcome':
        clientId = msg.id; clientName = msg.name;
        // populate initial presence
        friends.length = 0;
        msg.presence.forEach(p => friends.push(p));
        renderFriends();
        addChatMessage(`Welcome ${clientName}`, 'them');
        break;
      case 'presence-join':
        friends.push({id: msg.id, name: msg.name});
        renderFriends();
        addChatMessage(`${msg.name} joined`, 'them');
        break;
      case 'presence-leave':
        const idx = friends.findIndex(f=>f.id===msg.id);
        if(idx!==-1) friends.splice(idx,1);
        renderFriends();
        addChatMessage(`${msg.name} left`, 'them');
        break;
      case 'chat':
        addChatMessage(msg.text, msg.id === clientId ? 'me' : 'them', {name: msg.name});
        break;
      case 'control':
        addChatMessage(`${msg.name} performed ${msg.action} at ${msg.time || 0}s`, 'them');
        if(msg.action === 'play') video.currentTime = msg.time || video.currentTime;
        break;
      case 'time-correction':
        // server recommends a target time (seconds)
        const target = Number(msg.time);
        if(!isNaN(target)){
          const local = video.currentTime || 0;
          const diff = target - local;
          // if drift is small, nudge playbackRate briefly; otherwise seek
          if(Math.abs(diff) < 1.0){
            // nudge: increase or decrease playbackRate for smooth correction
            const original = video.playbackRate || 1.0;
            const nudge = diff * 0.2; // small proportional nudge
            video.playbackRate = Math.max(0.5, Math.min(1.5, original + nudge));
            setTimeout(()=> video.playbackRate = original, 1200);
            addChatMessage(`Adjusted playback speed to correct ${diff.toFixed(2)}s`, 'them');
          } else {
            // large drift -> seek to target
            video.currentTime = Math.max(0, target);
            addChatMessage(`Seeked to ${Math.floor(target)}s to resync`, 'them');
          }
        }
        break;
    }
  });
  ws.addEventListener('close', ()=>{
    addChatMessage('Disconnected from server', 'them');
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
  // For real backend presence is automatic; here we can send a control or message
  if(ws && ws.readyState === WebSocket.OPEN){
    ws.send(JSON.stringify({type:'chat', text: 'Pretend friend joined (dev)'}));
  }
});

claimHostBtn.addEventListener('click', ()=>{
  if(!ws || ws.readyState !== WebSocket.OPEN) return;
  const isHost = claimHostBtn.dataset.isHost === '1';
  if(isHost){
    ws.send(JSON.stringify({type:'release-host'}));
    addChatMessage('You released host', 'me');
  } else {
    ws.send(JSON.stringify({type:'claim-host'}));
    addChatMessage('You requested to be host', 'me');
  }
});

removeFriendBtn.addEventListener('click', ()=>{
  if(ws && ws.readyState === WebSocket.OPEN){
    ws.send(JSON.stringify({type:'chat', text: 'Pretend friend left (dev)'}));
  }
});

playPauseBtn.addEventListener('click', ()=>{
  if(video.paused){
    // try system control first
    const used = performMediaAction('play');
    if(!used){ video.play(); }
    playPauseBtn.textContent = 'Pause';
    if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:'control', action:'play', time: Math.floor(video.currentTime)}));
    addChatMessage('You played the video', 'me');
  } else {
    const used = performMediaAction('pause');
    if(!used){ video.pause(); }
    playPauseBtn.textContent = 'Play';
    if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:'control', action:'pause', time: Math.floor(video.currentTime)}));
    addChatMessage('You paused the video', 'me');
  }
});

syncBtn.addEventListener('click', ()=>{
  const t = Math.floor(video.currentTime);
  if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:'control', action:'sync', time: t}));
  addChatMessage(`Synced to ${t}s`, 'me');
});

// webOS integration: handle Back key
// webOS integration: handle Back key and remote keys
const removeWebOSListener = initWebOS((e)=>{
  addChatMessage('Back key pressed (webOS)', 'them');
}, (keyName)=>{
  // map some remote keys to playback actions
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
    // seek backwards 10s
    video.currentTime = Math.max(0, video.currentTime - 10);
    if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:'control', action:'seek', time: Math.floor(video.currentTime)}));
  } else if(k.includes('right')){
    // seek forward 10s
    video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
    if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:'control', action:'seek', time: Math.floor(video.currentTime)}));
  }
});

// Try to use webOS media service for actions when available
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

// initial state
addChatMessage('Welcome to Watch With Friends — connect to the server to chat', 'them');

// subscribe to system media status when available
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
    // keep unsub if needed later
  }catch(e){ console.warn('subscribe failed', e); }
}
// also attempt a single getStatus call to populate debug panel
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
// report local playback time to server periodically for sync
setInterval(()=>{
  if(ws && ws.readyState === WebSocket.OPEN && !isNaN(video.currentTime)){
    ws.send(JSON.stringify({type:'timeUpdate', time: Math.floor(video.currentTime)}));
  }
}, 2000);
