require('dotenv').config();
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const AWS = require('aws-sdk');
const db = require('./db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const logFilename = (() => {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `${date}_${time}.log`;
})();

const logStream = fs.createWriteStream(logFilename, { flags: 'a' });
console.log('Writing logs to', logFilename);

const rooms = new Map();
const clients = new Map(); // ws -> {id, name, roomId}

function getRoom(roomId = 'main') {
  if(!roomId || typeof roomId !== 'string') roomId = 'main';
  let room = rooms.get(roomId);
  if(!room) {
    room = {id: roomId, clients: new Set(), clientTimes: new Map(), hostId: null};
    rooms.set(roomId, room);
    log('Created room', roomId);
  }
  return room;
}

function deleteRoomIfEmpty(room) {
  if(room.clients.size === 0) {
    rooms.delete(room.id);
    log('Deleted empty room', room.id);
  }
}

function roomBroadcast(room, obj, except) {
  const data = JSON.stringify(obj);
  for(const ws of room.clients) {
    if(ws.readyState === WebSocket.OPEN && ws !== except) {
      ws.send(data);
    }
  }
}

function roomPresence(room) {
  return Array.from(room.clients)
    .map(ws => clients.get(ws))
    .filter(Boolean)
    .map(c => ({id: c.id, name: c.name}));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomId = url.searchParams.get('room') || 'main';
  log('HTTP request', req.method, url.pathname, {roomId});

  if(req.method === 'POST' && url.pathname === '/rooms') {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const {roomId: requestedRoomId} = JSON.parse(body || '{}');
      const normalizedRoomId = (requestedRoomId && String(requestedRoomId).trim()) || uuidv4();
      const room = getRoom(normalizedRoomId);
      return resEnd(res, 201, {roomId: room.id});
    } catch(e) {
      return resEnd(res, 500, {error: String(e)});
    }
  }

  if(req.method === 'GET' && url.pathname.startsWith('/rooms/')) {
    const requestedRoomId = url.pathname.slice('/rooms/'.length);
    if(!requestedRoomId) return resEnd(res, 400, {error: 'roomId required'});
    const room = rooms.get(requestedRoomId);
    if(!room) return resEnd(res, 404, {error: 'room not found'});
    return resEnd(res, 200, {
      roomId: room.id,
      participants: roomPresence(room),
      hostId: room.hostId,
      count: room.clients.size,
    });
  }

  if(req.method === 'POST' && url.pathname === '/register'){
    try{
      let body = '';
      for await (const chunk of req) body += chunk;
      const {name, email, password} = JSON.parse(body || '{}');
      log('Register request', {email, name, roomId});
      if(!email || !password) return resEnd(res, 400, {error: 'email and password required'});
      const usersCollection = db.getUsersCollection();
      if(!usersCollection) return resEnd(res, 503, {error: 'database unavailable'});
      const existing = await usersCollection.findOne({email});
      if(existing) return resEnd(res, 409, {error: 'email already exists'});
      const hash = await bcrypt.hash(password, 10);
      const user = {name: name || '', email, passwordHash: hash, createdAt: new Date()};
      const r = await usersCollection.insertOne(user);
      const id = r.insertedId.toString();
      const token = jwt.sign({sub:id, email}, process.env.JWT_SECRET || 'dev-secret', {expiresIn: '7d'});
      return resEnd(res, 201, {id, token});
    }catch(e){ return resEnd(res, 500, {error: String(e)}); }
  }

  if(req.method === 'POST' && url.pathname === '/login'){
    try{
      let body = '';
      for await (const chunk of req) body += chunk;
      const {email, password} = JSON.parse(body || '{}');
      log('Login request', {email, roomId});
      if(!email || !password) return resEnd(res, 400, {error: 'email and password required'});
      const usersCollection = db.getUsersCollection();
      if(!usersCollection) return resEnd(res, 503, {error: 'database unavailable'});
      const user = await usersCollection.findOne({email});
      if(!user) return resEnd(res, 401, {error:'invalid credentials'});
      const ok = await bcrypt.compare(password, user.passwordHash);
      if(!ok) return resEnd(res, 401, {error:'invalid credentials'});
      const token = jwt.sign({sub: user._id.toString(), email}, process.env.JWT_SECRET || 'dev-secret', {expiresIn: '7d'});
      return resEnd(res, 200, {id: user._id.toString(), token, name: user.name});
    }catch(e){ return resEnd(res, 500, {error:String(e)}); }
  }

  if(req.method === 'POST' && url.pathname === '/presign-upload'){
    try{
      const auth = parseAuth(req.headers.authorization);
      if(!auth) return resEnd(res, 401, {error:'unauthorized'});
      const body = await streamToString(req);
      const {key, contentType} = JSON.parse(body || '{}');
      log('Presign upload request', {key, roomId});
      if(!key) return resEnd(res, 400, {error:'missing key'});
      const s3Bucket = process.env.S3_BUCKET;
      if(!s3Bucket) return resEnd(res, 500, {error:'no S3_BUCKET configured'});
      const s3 = new AWS.S3({region: process.env.AWS_REGION});
      const params = {Bucket: s3Bucket, Key: key, Expires: Number(process.env.PRESIGN_EXPIRES || 300), ContentType: contentType || 'application/octet-stream'};
      const signed = await s3.getSignedUrlPromise('putObject', params);
      return resEnd(res, 200, {url: signed});
    }catch(e){ return resEnd(res, 500, {error: String(e)}); }
  }

  if(url.pathname === '/video-url'){
    const key = url.searchParams.get('key');
    log('Video URL request', {key, roomId});
    if(!key){ res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'missing key'})); return; }
    const cdnBase = process.env.CDN_BASE_URL;
    if(cdnBase){
      const cdnUrl = `${cdnBase.replace(/\/$/, '')}/${encodeURIComponent(key)}`;
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({url: cdnUrl, source: 'cdn'}));
      return;
    }
    const s3Bucket = process.env.S3_BUCKET;
    if(!s3Bucket){ res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'no CDN_BASE_URL or S3_BUCKET configured'})); return; }
    const s3 = new AWS.S3({region: process.env.AWS_REGION});
    const params = {Bucket: s3Bucket, Key: key, Expires: Number(process.env.PRESIGN_EXPIRES || 300)};
    s3.getSignedUrl('getObject', params, (err, signedUrl)=>{
      if(err){ res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error: String(err)})); }
      else { res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({url: signedUrl, source: 's3'})); }
    });
    return;
  }

  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Watch With Friends WebSocket server');
});

function parseAuth(header){
  if(!header) return null;
  const m = String(header).match(/^Bearer\s+(.+)$/i);
  if(!m) return null;
  try{ const payload = jwt.verify(m[1], process.env.JWT_SECRET || 'dev-secret'); return payload; }catch(e){ return null; }
}

function streamToString(stream){
  return new Promise((resolve, reject)=>{
    let data = '';
    stream.on('data', chunk=> data += chunk);
    stream.on('end', ()=> resolve(data));
    stream.on('error', reject);
  });
}

function resEnd(res, status, obj){
  const code = status;
  const body = JSON.stringify(obj || {});
  log('HTTP response', code, obj);
  res.writeHead(code, {'Content-Type':'application/json'});
  res.end(body);
}

function log(...args){
  const timestamp = new Date().toISOString();
  const line = [timestamp, ...args].map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
  console.log(line);
  logStream.write(line + '\n');
}

const port = process.env.PORT || 3000;
(async function init(){
  await db.initDb();
  server.listen(port, ()=> console.log('WebSocket server listening on', port));
})();

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomId = url.searchParams.get('room') || 'main';
  const room = getRoom(roomId);
  const id = uuidv4();
  const name = 'Guest-' + id.slice(0,4);
  clients.set(ws, {id, name, roomId});
  room.clients.add(ws);

  log('WebSocket connected', {id, name, roomId, clientCount: room.clients.size});

  ws.send(JSON.stringify({type: 'welcome', id, name, roomId, presence: roomPresence(room), hostId: room.hostId}));
  roomBroadcast(room, {type: 'presence-join', id, name}, ws);

  ws.on('message', (raw)=>{
    let msg;
    try{ msg = JSON.parse(raw); }catch(e){return}
    const client = clients.get(ws);
    const currentRoom = getRoom(client?.roomId);
    switch(msg.type){
      case 'chat':
        log('WebSocket message', {type: 'chat', id: client.id, text: msg.text, roomId: client.roomId});
        roomBroadcast(currentRoom, {type:'chat', id: client.id, name: client.name, text: msg.text});
        break;
      case 'timeUpdate':
        log('WebSocket message', {type: 'timeUpdate', id: client.id, time: msg.time, roomId: client.roomId});
        try{
          const t = Number(msg.time) || 0;
          currentRoom.clientTimes.set(client.id, t);
        }catch(e){}
        break;
      case 'claim-host':
        log('WebSocket message', {type: 'claim-host', id: client.id, roomId: client.roomId});
        currentRoom.hostId = client.id;
        roomBroadcast(currentRoom, {type:'host-changed', id: currentRoom.hostId, name: client.name});
        break;
      case 'release-host':
        log('WebSocket message', {type: 'release-host', id: client.id, roomId: client.roomId});
        if(currentRoom.hostId === client.id){
          currentRoom.hostId = null;
          roomBroadcast(currentRoom, {type:'host-changed', id: null});
        }
        break;
      case 'presence-update':
        break;
      case 'control':
        log('WebSocket message', {type: 'control', id: client.id, action: msg.action, time: msg.time, roomId: client.roomId});
        roomBroadcast(currentRoom, {type:'control', id: client.id, name: client.name, action: msg.action, time: msg.time});
        break;
    }
  });

  ws.on('close', ()=>{
    const info = clients.get(ws) || {id: 'unknown', name: 'unknown', roomId: roomId};
    room.clients.delete(ws);
    clients.delete(ws);
    if(room.hostId === info.id){
      room.hostId = null;
      roomBroadcast(room, {type:'host-changed', id: null});
    }
    log('WebSocket closed', {id: info.id, name: info.name, roomId: info.roomId, clientCount: room.clients.size});
    roomBroadcast(room, {type:'presence-leave', id: info.id, name: info.name});
    deleteRoomIfEmpty(room);
  });
});

setInterval(()=>{
  for(const room of rooms.values()){
    if(room.clientTimes.size === 0) continue;
    const entries = Array.from(room.clientTimes.entries());
    if(entries.length === 0) continue;

    if(room.hostId && room.clientTimes.has(room.hostId)){
      const hostTime = room.clientTimes.get(room.hostId);
      roomBroadcast(room, {type:'time-correction', time: Math.floor(hostTime), source: 'host'});
      continue;
    }

    const values = entries.map(e=>e[1]).filter(v=>typeof v === 'number' && !isNaN(v)).sort((a,b)=>a-b);
    if(values.length === 0) continue;
    let median;
    const mid = Math.floor(values.length/2);
    if(values.length % 2 === 1) median = values[mid];
    else median = Math.floor((values[mid-1] + values[mid]) / 2);
    roomBroadcast(room, {type:'time-correction', time: Math.floor(median), source: 'median'});
  }
}, 5000);
