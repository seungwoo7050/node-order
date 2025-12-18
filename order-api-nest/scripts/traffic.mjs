const API = process.env.API ?? "http://localhost:4000";
const RPS = Number(process.argv[2] ?? 10);
const paths = ["/products", "/trpc/products.list", "/orders/1", "/categories/tree"];
let counts = {};

setInterval(async () => {
  const path = paths[Math.floor(Math.random() * paths.length)];
  const key = await fetch(API + path).then((r) => String(r.status), () => "연결 실패");
  counts[key] = (counts[key] ?? 0) + 1;
}, 1000 / RPS);

setInterval(() => {
  console.log(new Date().toTimeString().slice(0, 8), JSON.stringify(counts));
  counts = {};
}, 5000);
