import http from "http";
import fs from "fs";

const FILE = "./data.json";
let db = {};
try { db = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch {}

http.createServer((req, res) => {
  const m = req.url.match(/^\/api\/kv\/([\w-]+)$/);
  if (!m) { res.writeHead(404); return res.end(); }
  const key = m[1];

  if (req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ value: db[key] ?? null }));
  }
  if (req.method === "PUT") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        db[key] = JSON.parse(body).value;
        fs.writeFileSync(FILE + ".tmp", JSON.stringify(db));
        fs.renameSync(FILE + ".tmp", FILE);
        res.writeHead(200);
        res.end("{}");
      } catch {
        res.writeHead(400);
        res.end();
      }
    });
    return;
  }
  res.writeHead(405);
  res.end();
}).listen(3001, () => console.log("Server: http://localhost:3001"));