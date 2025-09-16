const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000');
ws.on('open', ()=>{
  console.log('test-client: connected');
  ws.send(JSON.stringify({type:'chat', text:'Hello from test client'}));
  setTimeout(()=> ws.close(), 1000);
});
ws.on('message', (m)=> console.log('test-client got:', m.toString()));
ws.on('close', ()=> console.log('test-client: closed'));
