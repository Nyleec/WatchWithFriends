const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Watch With Friends WebSocket server');
});

const wss = new WebSocket.Server({ server });

const clients = new Map(); // ws -> {id, name}

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
