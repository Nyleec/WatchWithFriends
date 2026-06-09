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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  log('HTTP request', req.method, url.pathname);

  // Simple user registration endpoint: POST /register {name, email, password}
  if(req.method === 'POST' && url.pathname === '/register'){
    try{
      let body = '';
      for await (const chunk of req) body += chunk;
      const {name, email, password} = JSON.parse(body || '{}');
  log('Register request', {email, name});
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

  // Login endpoint: POST /login {email, password}
  if(req.method === 'POST' && url.pathname === '/login'){
    try{
      let body = '';
      for await (const chunk of req) body += chunk;
      const {email, password} = JSON.parse(body || '{}');
  log('Login request', {email});
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

  // Generate a presigned upload URL for client-side uploads: POST /presign-upload {key}
  if(req.method === 'POST' && url.pathname === '/presign-upload'){
    try{
      const auth = parseAuth(req.headers.authorization);
  if(!auth) return resEnd(res, 401, {error:'unauthorized'});
      const body = await streamToString(req);
      const {key, contentType} = JSON.parse(body || '{}');
  log('Presign upload request', {key});
  if(!key) return resEnd(res, 400, {error:'missing key'});
  const s3Bucket = process.env.S3_BUCKET;
  if(!s3Bucket) return resEnd(res, 500, {error:'no S3_BUCKET configured'});
      const s3 = new AWS.S3({region: process.env.AWS_REGION});
      const params = {Bucket: s3Bucket, Key: key, Expires: Number(process.env.PRESIGN_EXPIRES || 300), ContentType: contentType || 'application/octet-stream'};
      const signed = await s3.getSignedUrlPromise('putObject', params);
      return resEnd(res, 200, {url: signed});
    }catch(e){ return resEnd(res, 500, {error: String(e)}); }
    
  }

  // Return video URL (CDN or presigned S3). Require auth in production if JWT_SECRET set
  if(url.pathname === '/video-url'){
    const key = url.searchParams.get('key');
  log('Video URL request', {key});
  if(!key){ res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'missing key'})); return; }
    const cdnBase = process.env.CDN_BASE_URL; // e.g. https://dxxxxx.cloudfront.net
    if(cdnBase){
      const cdnUrl = `${cdnBase.replace(/\/$/, '')}/${encodeURIComponent(key)}`;
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({url: cdnUrl, source: 'cdn'}));
      return;
    }

    // Fallback: generate presigned S3 URL
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

// helper: parse Authorization header (Bearer <token>)
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

// Start server and initialize MongoDB if configured
const port = process.env.PORT || 3000;
(async function init(){
  await db.initDb();

  server.listen(port, ()=> console.log('WebSocket server listening on', port));
})();

const wss = new WebSocket.Server({ server });

const clients = new Map(); // ws -> {id, name}
const clientTimes = new Map(); // id -> lastReportedTime (seconds)
let hostId = null; // leader client id

function broadcast(obj, except){
  const data = JSON.stringify(obj);
  for(const [ws] of clients){
    if(ws.readyState === WebSocket.OPEN && ws !== except) ws.send(data);
  }
}

wss.on('connection', (ws) => {
  const id = uuidv4();
  const name = 'Guest-' + id.slice(0,4);
  clients.set(ws, {id, name});
  log('WebSocket connected', {id, name, clientCount: clients.size});

  // send welcome with current presence
  const presence = Array.from(clients.values()).map(c => ({id: c.id, name: c.name}));
  ws.send(JSON.stringify({type: 'welcome', id, name, presence}));

  broadcast({type: 'presence-join', id, name}, ws);

  ws.on('message', (raw)=>{
    let msg;
    try{ msg = JSON.parse(raw); }catch(e){return}
    switch(msg.type){
      case 'chat':
        log('WebSocket message', {type: 'chat', id: clients.get(ws).id, text: msg.text});
        // broadcast chat
        broadcast({type:'chat', id: clients.get(ws).id, name: clients.get(ws).name, text: msg.text});
        break;
      case 'timeUpdate':
        log('WebSocket message', {type: 'timeUpdate', id: clients.get(ws).id, time: msg.time});
        // clients periodically send their current playback time
        try{
          const t = Number(msg.time) || 0;
          clientTimes.set(clients.get(ws).id, t);
        }catch(e){}
        break;
      case 'claim-host':
        log('WebSocket message', {type: 'claim-host', id: clients.get(ws).id});
        // client requests to become host
        try{
          const id = clients.get(ws).id;
          hostId = id;
          broadcast({type:'host-changed', id: hostId, name: clients.get(ws).name});
        }catch(e){}
        break;
      case 'release-host':
        log('WebSocket message', {type: 'release-host', id: clients.get(ws).id});
        try{
          const id = clients.get(ws).id;
          if(hostId === id){ hostId = null; broadcast({type:'host-changed', id: null}); }
        }catch(e){}
        break;
      case 'presence-update':
        // ignore for now
        break;
      case 'control':
        log('WebSocket message', {type: 'control', id: clients.get(ws).id, action: msg.action, time: msg.time});
        // broadcast media control actions like play/pause/sync
        broadcast({type:'control', id: clients.get(ws).id, action: msg.action, time: msg.time});
        break;
    }
  });

  ws.on('close', ()=>{
    const info = clients.get(ws) || {id: 'unknown', name: 'unknown'};
    clients.delete(ws);
    log('WebSocket closed', {id: info.id, name: info.name, clientCount: clients.size});
    broadcast({type:'presence-leave', id: info.id, name: info.name});
  })
});

// removed duplicate listen; server is started in init()

// Periodically compute an average reported time and broadcast correction
setInterval(()=>{
  if(clientTimes.size === 0) return;
  const entries = Array.from(clientTimes.entries()); // [id, time]
  if(entries.length === 0) return;

  // If host is present and reporting time, prefer the host's time
  if(hostId && clientTimes.has(hostId)){
    const hostTime = clientTimes.get(hostId);
    broadcast({type:'time-correction', time: Math.floor(hostTime), source: 'host'});
    return;
  }

  // Otherwise compute weighted median: more recent reports get higher weight
  // For simplicity weight = 1 for all; compute median to reduce outlier impact
  const values = entries.map(e=>e[1]).filter(v=>typeof v === 'number' && !isNaN(v)).sort((a,b)=>a-b);
  if(values.length === 0) return;
  let median;
  const mid = Math.floor(values.length/2);
  if(values.length % 2 === 1) median = values[mid];
  else median = Math.floor((values[mid-1] + values[mid]) / 2);

  broadcast({type:'time-correction', time: Math.floor(median), source: 'median'});
}, 5000);
