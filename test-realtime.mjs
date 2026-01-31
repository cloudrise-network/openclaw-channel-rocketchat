import WebSocket from "ws";

const baseUrl = "http://10.99.0.4:3000";
const authToken = "tZATKtqCY9b4q7X9RbY0_d6v5uZg7rDTvW7mqDKPHjF";
const userId = "j4CZSpAFxRoSk6ieH";

const wsUrl = baseUrl.replace(/^http/, "ws") + "/websocket";
console.log("Connecting to:", wsUrl);

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
  console.log("<<< RECV:", JSON.stringify(msg));
  
  if (msg.msg === "connected") {
    console.log("DDP connected, logging in...");
    send({
      msg: "method",
      method: "login",
      id: String(++msgId),
      params: [{ resume: authToken }]
    });
  }
  
  if (msg.msg === "result" && msg.id === "1") {
    console.log("Logged in! Subscribing to GENERAL...");
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
    console.log("*** MESSAGE RECEIVED ***", msg);
  }
});

ws.on("error", (err) => {
  console.error("Error:", err);
});

ws.on("close", (code, reason) => {
  console.log("Closed:", code, reason?.toString());
});

// Keep alive
setTimeout(() => {
  console.log("Test complete, closing...");
  ws.close();
}, 60000);
