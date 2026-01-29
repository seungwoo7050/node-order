const PROM = process.env.PROM ?? "http://localhost:9090";
const only = process.argv[2];
const last = {};

setInterval(async () => {
  const body = await fetch(`${PROM}/api/v1/rules?type=alert`).then((r) => r.json(), () => null);
  if (!body) return;
  for (const group of body.data.groups) {
    for (const rule of group.rules) {
      if (only && rule.name !== only) continue;
      if (last[rule.name] !== undefined && last[rule.name] !== rule.state) {
        console.log(`${new Date().toTimeString().slice(0, 8)} ${rule.name}: ${rule.state}`);
      }
      last[rule.name] = rule.state;
    }
  }
}, 1000);

console.log(`경보 상태 감시: ${PROM}/alerts`);
