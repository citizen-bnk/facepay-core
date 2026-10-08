import { OPERATIONS } from './openapi';

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

export function docsHtml(): string {
  const rows = OPERATIONS.map((o) => `<tr><td><span class="m ${o.m}">${o.m.toUpperCase()}</span></td><td><code>${esc(o.path)}</code></td><td>${esc(o.summary)}${o.perm ? ` <small>(${esc(o.perm)})</small>` : ''}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FacePay Core API</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap" rel="stylesheet">
<style>
body{margin:0;background:#081020;color:#fff;font-family:Montserrat,system-ui,sans-serif;line-height:1.5}
main{max-width:920px;margin:0 auto;padding:40px 20px}
h1{font-size:2rem;margin:0 0 4px}.face{color:#fff}.pay{background:linear-gradient(90deg,#F2CE6B,#D4A53A,#B8862B);-webkit-background-clip:text;color:transparent}
.tag{color:#D4A53A;letter-spacing:.2em;font-size:.75rem;font-weight:600}
p,li{color:#c9ced8}a{color:#D4A53A}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:.9rem}td{padding:8px 10px;border-bottom:1px solid #1b2740;vertical-align:top}
code{color:#F2CE6B;word-break:break-all}small{color:#6B7280}
.m{font-size:.7rem;font-weight:700;padding:2px 6px;border-radius:4px;background:#1b2740}.m.post{background:#D4A53A;color:#050810}
pre{background:#050810;padding:12px;border-radius:8px;overflow:auto;color:#F2CE6B}
</style></head><body><main>
<h1><span class="face">FACE</span><span class="pay">PAY</span> Core API</h1>
<div class="tag">FACE YOUR MONEY</div>
<p>Base path <code>/v1</code>. JSON in and out. Errors are <code>{"error":{"code","message"}}</code>. Amounts are integers in minor units (ZAR cents). Wallet balances are sourced from the payment provider. A payment is never captured or paid until the provider confirms it. No raw biometrics are stored or exposed.</p>
<p>OpenAPI: <a href="/v1/openapi.json">/v1/openapi.json</a> &middot; Typed client: <code>@facepay/sdk</code></p>
<pre>curl -s -X POST $BASE/v1/auth/login -H 'content-type: application/json' \\
  -d '{"email":"thabo@facepay.demo","password":"facepay-demo"}'
curl -s $BASE/v1/wallet -H "authorization: Bearer $TOKEN"</pre>
<table>${rows}</table>
</main></body></html>`;
}
