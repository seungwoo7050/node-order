import { io } from "socket.io-client";

const res = await fetch("http://localhost:4000/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: "kim", password: "1234" }),
});
const { accessToken } = await res.json();

const socket = io("http://localhost:4000", { auth: { token: accessToken } });
socket.on("connect", () => console.log("연결됨"));
socket.on("disconnect", () => console.log("연결 끊김"));
socket.on("connect_error", (err) => console.log(":", err.message));
socket.on("order.created", (o) => console.log("알림:", o));