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
  const preview = JSON.stringify(msg).slice(0, 300);
  console.log("<<< RECV:", preview);
  
  if (msg.msg === "connected") {
    console.log("\n=== DDP connected, logging in as Chad... ===\n");
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
    console.log("\n=== Logged in! Trying multiple subscription formats... ===\n");
    
    // Try format 1: just roomId and boolean
    send({
      msg: "sub",
      id: String(++msgId),
      name: "stream-room-messages",
      params: ["GENERAL", false]
    });
    
    // Try format 2: with event name
    send({
      msg: "sub", 
      id: String(++msgId),
      name: "stream-room-messages",
      params: ["GENERAL", { useCollection: false, args: [{ visitorToken: null }] }]
    });
    
    // Try format 3: stream-notify-user for notifications
    send({
      msg: "sub",
      id: String(++msgId),
      name: "stream-notify-user",
      params: [`${userId}/notification`, false]
    });
    
    // Try format 4: stream-notify-room
    send({
      msg: "sub",
      id: String(++msgId),
      name: "stream-notify-room",
      params: ["GENERAL/deleteMessage", false]
    });
  }
  
  if (msg.msg === "ping") {
    send({ msg: "pong" });
  }
  
  if (msg.msg === "changed") {
    console.log("\n**************************************************");
    console.log("*** MESSAGE/EVENT RECEIVED ***");
    console.log(JSON.stringify(msg, null, 2));
    console.log("**************************************************\n");
  }
  
  if (msg.msg === "nosub") {
    console.error("SUBSCRIPTION FAILED:", JSON.stringify(msg));
  }
  
  if (msg.msg === "ready") {
    console.log("=== Subscription ready:", msg.subs, "===");
  }
});

ws.on("error", (err) => {
  console.error("WebSocket Error:", err.message);
});

ws.on("close", (code, reason) => {
  console.log("Connection closed:", code, reason?.toString());
});

console.log("Listening for 45 seconds... Send a message in #general!");
setTimeout(() => {
  console.log("Test complete, closing...");
  ws.close();
}, 45000);
