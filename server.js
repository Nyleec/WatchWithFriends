const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Watch With Friends WebSocket server');
});

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

  // send welcome with current presence
  const presence = Array.from(clients.values()).map(c => ({id: c.id, name: c.name}));
  ws.send(JSON.stringify({type: 'welcome', id, name, presence}));

  broadcast({type: 'presence-join', id, name}, ws);

  ws.on('message', (raw)=>{
    let msg;
    try{ msg = JSON.parse(raw); }catch(e){return}
    switch(msg.type){
      case 'chat':
        // broadcast chat
        broadcast({type:'chat', id: clients.get(ws).id, name: clients.get(ws).name, text: msg.text});
        break;
      case 'timeUpdate':
        // clients periodically send their current playback time
        try{
          const t = Number(msg.time) || 0;
          clientTimes.set(clients.get(ws).id, t);
        }catch(e){}
        break;
      case 'claim-host':
        // client requests to become host
        try{
          const id = clients.get(ws).id;
          hostId = id;
          broadcast({type:'host-changed', id: hostId, name: clients.get(ws).name});
        }catch(e){}
        break;
      case 'release-host':
        try{
          const id = clients.get(ws).id;
          if(hostId === id){ hostId = null; broadcast({type:'host-changed', id: null}); }
        }catch(e){}
        break;
      case 'presence-update':
        // ignore for now
        break;
      case 'control':
        // broadcast media control actions like play/pause/sync
        broadcast({type:'control', id: clients.get(ws).id, action: msg.action, time: msg.time});
        break;
    }
  });

  ws.on('close', ()=>{
    const info = clients.get(ws);
    clients.delete(ws);
    broadcast({type:'presence-leave', id: info.id, name: info.name});
  })
});

const port = process.env.PORT || 3000;
server.listen(port, ()=> console.log('WebSocket server listening on', port));

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
