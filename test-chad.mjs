import WebSocket from "ws";

const baseUrl = "http://10.99.0.4:3000";
const authToken = "m2E8phh3dmtOag3UTh84d60YZOQVfa6wjhIWBV01jRr";
const userId = "M3NTzRzjwZfE9FRxi";

const wsUrl = baseUrl.replace(/^http/, "ws") + "/websocket";
console.log("Connecting as Chad to:", wsUrl);

const ws = new WebSocket(wsUrl);
let msgId = 0;

function send(msg) {
  console.log(">>> SEND:", JSON.stringify(msg));
  ws.send(JSON.stringify(msg));
}

ws.on("open", () => {
  console.log("Connected, sending DDP connect...");
  send({ msg: "connect", version: "1", support: ["1"] });
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  console.log("<<< RECV:", JSON.stringify(msg).slice(0, 200));
  
  if (msg.msg === "connected") {
    console.log("DDP connected, logging in as Chad...");
    send({
      msg: "method",
      method: "login",
      id: String(++msgId),
      params: [{ resume: authToken }]
    });
  }
  
  if (msg.msg === "result" && msg.id === "1") {
    if (msg.error) {
      console.error("LOGIN FAILED:", msg.error);
      ws.close();
      return;
    }
    console.log("Logged in as Chad! Subscribing to GENERAL...");
    send({
      msg: "sub",
      id: String(++msgId),
      name: "stream-room-messages",
      params: ["GENERAL", false]
    });
  }
  
  if (msg.msg === "ping") {
    send({ msg: "pong" });
  }
  
  if (msg.msg === "changed") {
    console.log("\n*** MESSAGE RECEIVED ***");
    console.log(JSON.stringify(msg, null, 2));
    console.log("************************\n");
  }
  
  if (msg.msg === "nosub") {
    console.error("SUBSCRIPTION FAILED:", msg);
  }
});

ws.on("error", (err) => {
  console.error("WebSocket Error:", err.message);
});

ws.on("close", (code, reason) => {
  console.log("Connection closed:", code, reason?.toString());
});

console.log("Listening for 60 seconds... Send a message in #general!");
setTimeout(() => {
  console.log("Test complete, closing...");
  ws.close();
}, 60000);
