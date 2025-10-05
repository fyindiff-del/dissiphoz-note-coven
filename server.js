import express from "express";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

let users = {};
const usersFile = path.join(dataDir, "users.json");
if (fs.existsSync(usersFile)) users = JSON.parse(fs.readFileSync(usersFile, "utf8"));

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send("Invalid input");

  if (users[username] && users[username] !== password)
    return res.status(403).send("Wrong password");

  if (!users[username]) users[username] = password;
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
  res.send("ok");
});

const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const wss = new WebSocketServer({ server });
const rooms = {};

wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    const data = JSON.parse(msg);
    if (data.type === "join") {
      ws.room = data.room;
      if (!rooms[ws.room]) {
        rooms[ws.room] = { clients: [], text: "" };
        const file = path.join(dataDir, `${ws.room}.txt`);
        if (fs.existsSync(file)) rooms[ws.room].text = fs.readFileSync(file, "utf8");
      }
      rooms[ws.room].clients.push(ws);
      ws.send(JSON.stringify({ type: "init", text: rooms[ws.room].text }));
    } else if (data.type === "edit" && ws.room) {
      rooms[ws.room].text = data.text;
      fs.writeFileSync(path.join(dataDir, `${ws.room}.txt`), data.text);
      rooms[ws.room].clients.forEach((client) => {
        if (client !== ws && client.readyState === 1)
          client.send(JSON.stringify({ type: "update", text: data.text }));
      });
    }
  });

  ws.on("close", () => {
    if (ws.room && rooms[ws.room])
      rooms[ws.room].clients = rooms[ws.room].clients.filter((c) => c !== ws);
  });
});

// ✅ Serve o index.html para QUALQUER rota desconhecida
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

