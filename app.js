// Presence and chat integration using WebSocket server
import { initWebOS, requestSystemInfo } from './webos.js';

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
function connectWS(){
  ws = new WebSocket(wsUrl);
  ws.addEventListener('open', ()=>{
    addChatMessage('Connected to server', 'them');
  });
  ws.addEventListener('message', (ev)=>{
    let msg; try{ msg = JSON.parse(ev.data); }catch(e){return}
    switch(msg.type){
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

removeFriendBtn.addEventListener('click', ()=>{
  if(ws && ws.readyState === WebSocket.OPEN){
    ws.send(JSON.stringify({type:'chat', text: 'Pretend friend left (dev)'}));
  }
});

playPauseBtn.addEventListener('click', ()=>{
  if(video.paused){
    video.play();
    playPauseBtn.textContent = 'Pause';
    if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:'control', action:'play', time: Math.floor(video.currentTime)}));
    addChatMessage('You played the video', 'me');
  } else {
    video.pause();
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
initWebOS(()=>{
  addChatMessage('Back key pressed (webOS)', 'them');
});

// initial state
addChatMessage('Welcome to Watch With Friends — connect to the server to chat', 'them');
