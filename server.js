
/*
  Dissiphoz Note Coven - collaborative notes server
  - Simple username+password auth (creates account if unknown)
  - Rooms support: clients join a room string
  - Documents saved per-room in ./data/<room>.txt
  - Users saved in ./data/users.json (passwords stored in plaintext for simplicity;
    for production, use hashing and proper auth)
  Run: npm install ws mime fs-extra
       node server.js
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const mime = require('mime');

const PORT = process.env.PORT || 3000;
const STATIC_DIR = path.join(__dirname, 'static');
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// Load or init users
let users = {};
try {
  users = JSON.parse(fs.readFileSync(USERS_FILE,'utf8') || '{}');
} catch(e){ users = {}; }

function saveUsers(){ fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8'); }

// Documents in memory per room (loaded from disk if exists)
const docs = {}; // room -> {content, version}

// load document helper
function loadRoom(room){
  const file = path.join(DATA_DIR, room + '.txt');
  if(docs[room]) return docs[room];
  let content = '# ' + room + '\\n\\nEscreva aqui...';
  if(fs.existsSync(file)){
    content = fs.readFileSync(file, 'utf8');
  }
  docs[room] = { content, version: 1 };
  return docs[room];
}
function saveRoom(room){
  const file = path.join(DATA_DIR, room + '.txt');
  fs.writeFileSync(file, docs[room].content, 'utf8');
}

// Simple HTTP server for static files
const server = http.createServer((req, res) => {
  let url = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(STATIC_DIR, url.split('?')[0]);
  fs.readFile(filePath, (err, data) => {
    if(err){
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, {'Content-Type': mime.getType(filePath) + '; charset=utf-8'});
    res.end(data);
  });
});

const wss = new WebSocket.Server({ noServer: true });

// Map of ws -> meta {user, room}
const clients = new Map();

wss.on('connection', (ws) => {
  clients.set(ws, { user: null, room: null });
  ws.on('message', (raw) => {
    let msg;
    try{ msg = JSON.parse(raw); } catch(e){ return; }
    const meta = clients.get(ws) || {};
    if(msg.type === 'auth'){
      // {type:'auth', user, pass, room}
      const user = String(msg.user || '').trim();
      const pass = String(msg.pass || '');
      const room = String(msg.room || 'main').trim() || 'main';
      if(!user){ ws.send(JSON.stringify({type:'auth-fail', reason:'Nome vazio'})); return; }
      // create account if not exists
      if(!users[user]){
        users[user] = { pass };
        saveUsers();
      }
      if(users[user].pass !== pass){
        ws.send(JSON.stringify({type:'auth-fail', reason:'Senha incorreta'}));
        return;
      }
      // success: attach meta
      meta.user = user; meta.room = room;
      clients.set(ws, meta);
      // load or create room doc
      const doc = loadRoom(room);
      // send init state
      ws.send(JSON.stringify({type:'auth-ok', user, room, content:doc.content, version:doc.version}));
      broadcastPresence(room);
      return;
    } else if(msg.type === 'edit'){
      // {type:'edit', content, version?}
      if(!meta.room) return;
      const room = meta.room;
      const doc = loadRoom(room);
      doc.content = String(msg.content || '');
      doc.version = (doc.version || 0) + 1;
      saveRoom(room);
      // broadcast update to clients in same room
      broadcastToRoom(room, JSON.stringify({type:'update', content:doc.content, version:doc.version, user: meta.user}));
      return;
    } else if(msg.type === 'rename'){
      if(!meta.user) return;
      const newName = String(msg.newName || '').trim();
      if(newName && !users[newName]){
        // transfer password entry (simple)
        users[newName] = users[meta.user];
        delete users[meta.user];
        saveUsers();
        meta.user = newName;
        clients.set(ws, meta);
        ws.send(JSON.stringify({type:'rename-ok', user:newName}));
        broadcastPresence(meta.room);
      } else {
        ws.send(JSON.stringify({type:'rename-fail', reason:'Nome ocupado ou inválido'}));
      }
      return;
    }
  });

  ws.on('close', ()=>{
    const meta = clients.get(ws) || {};
    clients.delete(ws);
    if(meta.room) broadcastPresence(meta.room);
  });
});

function broadcastToRoom(room, data){
  for(const [ws, meta] of clients.entries()){
    if(meta.room === room && ws.readyState === WebSocket.OPEN){
      ws.send(data);
    }
  }
}

function broadcastPresence(room){
  const users = [];
  for(const meta of clients.values()){
    if(meta.room === room && meta.user) users.push(meta.user);
  }
  broadcastToRoom(room, JSON.stringify({type:'presence', users}));
}

server.on('upgrade', (req, socket, head) => {
  if(req.url.startsWith('/ws')){
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, ()=> console.log('Server listening on http://localhost:' + PORT));
