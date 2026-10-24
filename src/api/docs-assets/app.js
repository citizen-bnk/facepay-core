'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const spec = JSON.parse($('api-contract').textContent);
  const operations = Object.entries(spec.paths).flatMap(([path, methods]) => Object.entries(methods).map(([method, op]) => ({ path, method: method.toUpperCase(), ...op })));
  let selected = operations.find(o => o.path === '/v1/health');
  let token = '';
  let responseText = '';
  let worker = null;
  let runTimer;
  let runGeneration = 0;
  const activeRequests = new Set();
  const format = x => JSON.stringify(x, null, 2);
  const decodeSchema = s => s?.$ref ? spec.components.schemas[s.$ref.split('/').pop()] : s;
  const group = path => ({ auth: 'Authentication', me: 'Authentication', wallet: 'Wallet & activity', transactions: 'Wallet & activity', 'payment-intents': 'Payments', 'verification-sessions': 'Payments', refunds: 'Refunds', settlements: 'Settlements', devices: 'Devices', merchants: 'Merchants & customers', customers: 'Merchants & customers', consents: 'Consent & identity', admin: 'Administration', roles: 'Administration', approvals: 'Administration', 'audit-events': 'Administration', integrations: 'Integrations', webhooks: 'Integrations', merchant: 'Merchant dashboard', leads: 'Public endpoints', health: 'Public endpoints', 'openapi.json': 'Public endpoints' })[path.split('/')[2]] || 'Other';
  const node = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  function toast(text) { $('toast').textContent = text; setTimeout(() => { $('toast').textContent = ''; }, 2500); }
  function renderNav() {
    const term = $('search').value.trim().toLowerCase();
    const list = operations.filter(o => (o.method + ' ' + o.path + ' ' + o.summary + ' ' + (o.description || '')).toLowerCase().includes(term));
    $('endpoint-count').textContent = list.length + '/' + operations.length;
    $('endpoint-nav').replaceChildren();
    const groups = [...new Set(list.map(o => group(o.path)))];
    for (const g of groups) {
      $('endpoint-nav').append(node('h3', g));
      for (const op of list.filter(o => group(o.path) === g)) {
        const button = node('button', undefined, 'endpoint-link' + (op === selected ? ' active' : ''));
        button.type = 'button'; button.title = op.summary; button.setAttribute('aria-label', op.method + ' ' + op.path);
        if (op === selected) button.setAttribute('aria-current', 'true');
        button.append(node('span', op.method, 'method ' + op.method.toLowerCase()), node('span', op.path.replace('/v1/', '/')));
        button.onclick = () => { choose(op); $('reference').scrollIntoView({ behavior: 'smooth' }); };
        $('endpoint-nav').append(button);
      }
    }
    if (!list.length) $('endpoint-nav').append(node('p', 'No endpoints found. Try a path, scope or resource name.', 'empty'));
  }
  const samples = {
    LoginRequest: { email: 'thabo@facepay.demo', password: 'facepay-demo' },
    CreatePaymentIntent: { merchantId: 'tenant_abc', amountMinor: 12500, currency: 'ZAR', channel: 'qr' },
    ConfirmPaymentIntent: { verificationSessionId: 'vs_replace_with_your_session_id' },
    CreateVerificationSession: { purpose: 'checkout', paymentIntentId: 'pi_replace_with_your_intent_id', modality: 'face', subjectId: 'usr_thabo' },
    CreateRefund: { transactionId: 'tx_replace_with_your_transaction_id', amountMinor: 1000, reason: 'Customer request' },
    EnrolDevice: { model: 'FacePay Handheld', serial: 'FP-DEMO-001', merchantId: 'tenant_abc' },
    WebhookSubscription: { url: 'https://example.com/webhooks/facepay', events: ['payment.captured'] },
    Lead: { name: 'Developer Example', email: 'developer@example.com', company: 'Example Company', kind: 'partner', message: 'API integration enquiry' },
  };
  function schemaRows(schema, parent, depth = 0) {
    const s = decodeSchema(schema);
    if (!s) { parent.append(node('p', 'No request body.', 'empty')); return; }
    if (!s.properties) { const pre = node('pre', format(s)); parent.append(pre); return; }
    const table = node('table', undefined, 'schema-table'); table.setAttribute('aria-label', 'Schema fields');
    for (const [name, definition] of Object.entries(s.properties)) {
      const d = decodeSchema(definition); const row = node('tr'); const left = node('td'); const right = node('td');
      left.append(node('code', name)); left.append(node('small', (s.required || []).includes(name) ? 'required' : 'optional'));
      right.append(node('span', Array.isArray(d.type) ? d.type.join(' | ') : d.type || 'object'));
      if (d.format) right.append(node('p', d.format));
      if (d.description) right.append(node('p', d.description));
      if (d.enum) right.append(node('p', 'Values: ' + d.enum.join(', ')));
      if (d.minimum !== undefined) right.append(node('p', 'Minimum: ' + d.minimum));
      if (d.example !== undefined) right.append(node('p', 'Example: ' + JSON.stringify(d.example)));
      if (depth < 3 && (d.properties || d.items)) {
        const detail = node('details'); detail.append(node('summary', d.items ? 'Array item schema' : 'Nested fields'));
        schemaRows(d.items || d, detail, depth + 1); right.append(detail);
      }
      row.append(left, right); table.append(row);
    }
    parent.append(table);
  }
  function choose(op) {
    selected = op;
    history.replaceState(null, '', '#endpoint=' + encodeURIComponent(op.method + ' ' + op.path));
    $('method').textContent = op.method; $('method').className = 'method ' + op.method.toLowerCase();
    $('path').textContent = op.path; $('summary').textContent = op.summary;
    $('description').textContent = (op.description || 'JSON endpoint. See the request and response schemas below.') + (op.path.includes('biometric-media') ? ' This route intentionally denies every role.' : '');
    $('requirements').replaceChildren(node('span', op.security?.length ? 'Bearer token required' : 'Public endpoint'));
    const idem = op.parameters?.find(p => p.name === 'Idempotency-Key');
    if (idem) $('requirements').append(node('span', 'Idempotency key ' + (idem.required ? 'required' : 'optional')));
    $('params').replaceChildren();
    if (!op.parameters?.length) $('params').append(node('p', 'No parameters.', 'empty'));
    else {
      const table = node('table', undefined, 'schema-table');
      for (const p of op.parameters) { const tr = node('tr'); const td = node('td'); td.append(node('code', p.name), node('small', p.in + (p.required ? ' · required' : ' · optional'))); tr.append(td, node('td', p.description || (decodeSchema(p.schema)?.type || 'string'))); table.append(tr); }
      $('params').append(table);
    }
    const requestSchema = op.requestBody?.content?.['application/json']?.schema;
    $('request-schema').replaceChildren(); schemaRows(requestSchema, $('request-schema'));
    $('response-schema').replaceChildren();
    for (const [status, response] of Object.entries(op.responses || {})) { const d = node('details'); d.append(node('summary', status + ' · ' + response.description)); schemaRows(response.content?.['application/json']?.schema, d); $('response-schema').append(d); }
    $('request-path').value = op.path.replace(/\{id\}/g, 'replace_with_id');
    $('query').value = op.parameters?.some(p => p.in === 'query' && p.name === 'limit') ? 'limit=5' : '';
    $('query').disabled = !op.parameters?.some(p => p.in === 'query');
    $('idem').value = idem ? crypto.randomUUID() : ''; $('idem').disabled = !idem; $('new-idem').disabled = !idem;
    $('request-body').disabled = op.method === 'GET';
    $('request-body').value = op.method === 'GET' ? '' : format(samples[requestSchema?.$ref?.split('/').pop()] || {});
    validateBody(); renderNav(); generateCode();
  }
  function problems(value, schema, path = 'body', issues = []) {
    const s = decodeSchema(schema); if (!s) return issues;
    if (s.type === 'object' && (value === null || Array.isArray(value) || typeof value !== 'object')) issues.push(path + ' must be an object');
    else if (s.type === 'object') {
      for (const key of s.required || []) if (value[key] === undefined) issues.push(path + '.' + key + ' is required');
      for (const [key, v] of Object.entries(value)) if (s.properties?.[key]) problems(v, s.properties[key], path + '.' + key, issues);
    } else if (s.type === 'integer' && !Number.isInteger(value)) issues.push(path + ' must be an integer');
    else if (s.type === 'string' && typeof value !== 'string') issues.push(path + ' must be a string');
    else if (s.type === 'boolean' && typeof value !== 'boolean') issues.push(path + ' must be a boolean');
    else if (s.type === 'array') { if (!Array.isArray(value)) issues.push(path + ' must be an array'); else value.slice(0,100).forEach((v,i) => problems(v, s.items, path + '[' + i + ']', issues)); }
    if (s.enum && !s.enum.includes(value)) issues.push(path + ': expected ' + s.enum.join(' / '));
    if (s.minimum !== undefined && typeof value === 'number' && value < s.minimum) issues.push(path + ' must be ≥ ' + s.minimum);
    return issues;
  }
  function bodyValue() { return selected.method === 'GET' ? undefined : JSON.parse($('request-body').value || '{}'); }
  function validateBody() {
    const label = $('body-validation'); if (selected.method === 'GET') { label.textContent = 'GET requests do not send a body.'; label.className = ''; return true; }
    try { const issues = problems(bodyValue(), selected.requestBody?.content?.['application/json']?.schema); label.textContent = issues.length ? issues.join('; ') : 'Valid JSON · basic schema checks passed'; label.className = issues.length ? 'fail' : 'pass'; return !issues.length; }
    catch (e) { label.textContent = 'Invalid JSON: ' + e.message; label.className = 'fail'; return false; }
  }
  function requestPath() { return $('request-path').value + ($('query').value.trim() ? '?' + $('query').value.trim().replace(/^\?/, '') : ''); }
  function allowedOperation(method, path) {
    if (typeof path !== 'string' || path.length > 1800 || (!path.startsWith('/v1/') && !path.startsWith('/mobile/')) || /[\\#\r\n]/.test(path)) throw new Error('Use a documented API-relative /v1/ or /mobile/ path.');
    const url = new URL(path, location.origin);
    if (url.origin !== location.origin || url.pathname !== path.split('?')[0]) throw new Error('Cross-origin and normalized paths are not allowed.');
    const op = operations.find(o => o.method === method && new RegExp('^' + o.path.split('/').map(segment => segment === '{id}' ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/') + '$').test(url.pathname));
    if (!op) throw new Error('This method/path is not in the API contract.');
    return op;
  }
  async function apiRequest(method, path, body, idempotencyKey, fromLab = false) {
    const op = allowedOperation(method, path);
    if (fromLab && (op.path === '/v1/auth/login' || op.path.startsWith('/mobile/otp/'))) throw new Error('Connect an identity in the authentication panel. Tokens are not exposed to code.');
    if (op.security?.length && !token) throw new Error('Connect a demo account or paste a valid bearer token first.');
    if (body !== undefined && JSON.stringify(body).length > 20000) throw new Error('Request body is limited to 20 KB in this console.');
    const headers = { Accept: 'application/json' };
    if (token && op.security?.length) headers.Authorization = 'Bearer ' + token;
    if (method === 'POST') headers['Content-Type'] = 'application/json';
    if (idempotencyKey || op.parameters?.some(p => p.name === 'Idempotency-Key' && p.required)) headers['Idempotency-Key'] = idempotencyKey || crypto.randomUUID();
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20000); activeRequests.add(controller);
    const start = performance.now();
    try {
      const response = await fetch(path, { method, headers, body: method === 'POST' ? JSON.stringify(body || {}) : undefined, signal: controller.signal, credentials: 'omit', redirect: 'error' });
      const raw = await response.text(); if (raw.length > 2000000) throw new Error('Response exceeds console limit.');
      let json; try { json = JSON.parse(raw); } catch { json = { text: raw.slice(0, 10000) }; }
      return { status: response.status, body: json, headers: Object.fromEntries(response.headers), ms: Math.round(performance.now() - start) };
    } finally { clearTimeout(timer); activeRequests.delete(controller); }
  }
  function redact(data) {
    if (Array.isArray(data)) return data.map(redact);
    if (!data || typeof data !== 'object') return data;
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, /^(token|password|secret)$/i.test(key) ? '[redacted — kept out of logs]' : redact(value)]));
  }
  function showResponse(result, op) {
    responseText = format(redact(result.body)); $('response-body').textContent = responseText;
    $('response-meta').textContent = 'HTTP ' + result.status + ' · ' + result.ms + ' ms'; $('response-meta').className = result.status < 400 ? 'pass' : 'fail';
    $('response-headers').textContent = format(result.headers);
    const contract = op.responses?.[String(result.status)] || op.responses?.default;
    const issues = problems(result.body, contract?.content?.['application/json']?.schema);
    $('response-validation').textContent = issues.length ? 'Basic response validation: ' + issues.join('; ') : 'Response received · basic schema checks passed. The server enforces the full contract.';
    $('response-validation').className = issues.length ? 'fail' : 'pass';
  }
  function generateCode() {
    let body; try { body = bodyValue(); } catch { body = {}; }
    const path = requestPath(); const url = location.origin + path;
    const headers = { Accept: 'application/json', ...(selected.security?.length ? { Authorization: 'Bearer YOUR_TOKEN' } : {}), ...(selected.method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...(!$('idem').disabled && $('idem').value ? { 'Idempotency-Key': $('idem').value } : {}) };
    let code;
    if ($('language').value === 'javascript') code = 'const response = await fetch(' + JSON.stringify(url) + ', {\n  method: ' + JSON.stringify(selected.method) + ',\n  headers: ' + format(headers).replace(/\n/g, '\n  ') + (body !== undefined ? ',\n  body: JSON.stringify(' + format(body).replace(/\n/g, '\n  ') + ')' : '') + '\n});\nconst data = await response.json();\nif (!response.ok) throw new Error(data.error?.message || "Request failed");\nconsole.log(data);';
    else if ($('language').value === 'python') code = 'import json\nimport requests\n\nresponse = requests.request(\n    ' + JSON.stringify(selected.method) + ',\n    ' + JSON.stringify(url) + ',\n    headers=' + format(headers) + (body !== undefined ? ',\n    json=json.loads(' + JSON.stringify(JSON.stringify(body)) + ')' : '') + ',\n    timeout=20,\n)\nresponse.raise_for_status()\nprint(response.json())';
    else {
      const quote = str => "'" + str.replace(/'/g, "'\\''") + "'";
      code = 'curl --request ' + selected.method + ' ' + quote(url) + Object.entries(headers).map(([k,v]) => ' \\\n  --header ' + quote(k + ': ' + v)).join('') + (body !== undefined ? ' \\\n  --data ' + quote(JSON.stringify(body)) : '');
    }
    $('code-example').textContent = code;
  }
  const recipes = {
    health: 'const result = await facepay.request("GET", "/v1/health");\nfacepay.assert(result.status === 200, "Health endpoint returns 200");\nfacepay.assert(result.body.status === "ok", "Service is healthy");\nfacepay.log(result.body);',
    wallet: '// Connect the Customer demo identity first.\nconst result = await facepay.request("GET", "/v1/wallet");\nfacepay.assert(result.status === 200, "Wallet is accessible");\nfacepay.assert(result.body.currency === "ZAR", "Currency is ZAR");\nfacepay.assert(Number.isInteger(result.body.availableBalanceMinor), "Balance uses integer minor units");\nfacepay.log(result.body);',
    payment: '// Connect Merchant owner or Merchant cashier first.\n// A new idempotency key is generated for this create request.\nconst created = await facepay.request("POST", "/v1/payment-intents", {\n  merchantId: "tenant_abc", amountMinor: 12500, currency: "ZAR", channel: "qr"\n});\nfacepay.assert(created.status === 201, "Intent created");\nfacepay.assert(created.body.paid === false, "An intent alone is not paid");\nconst fetched = await facepay.request("GET", "/v1/payment-intents/" + created.body.id);\nfacepay.assert(fetched.body.id === created.body.id, "Intent can be retrieved");\nfacepay.log(fetched.body);',
    developer: '// Paste your developer API key in the authentication panel.\n// Replace these IDs with the identifiers in your developer console.\nconst merchantId = "YOUR_MERCHANT_ID";\nconst subjectId = "YOUR_TEST_CUSTOMER_ID";\nconst intent = await facepay.request("POST", "/v1/payment-intents", {merchantId, amountMinor:12500, currency:"ZAR", channel:"qr"});\nfacepay.assert(intent.status === 201, "Intent created in your merchant");\nconst verification = await facepay.request("POST", "/v1/verification-sessions", {purpose:"checkout", paymentIntentId:intent.body.id, subjectId, modality:"pin"});\nfacepay.assert(verification.status === 201, "Simulated PIN step-up verified");\nconst payment = await facepay.request("POST", "/v1/payment-intents/" + intent.body.id + "/confirm", {verificationSessionId:verification.body.id});\nfacepay.assert(payment.status === 200, "Confirmation response received");\nfacepay.assert(payment.body.paid === (payment.body.status === "captured" && payment.body.providerConfirmed === true), "Only confirmed capture means paid");\nfacepay.log(payment.body);',
    errors: '// No identity is needed: this checks a public validation error.\nconst result = await facepay.request("POST", "/v1/leads", {name:""});\nfacepay.assert(result.status === 422, "Invalid fields return 422");\nfacepay.assert(result.body.error.code === "validation_error", "Stable error code");\nfacepay.log(result.body);',
  };
  function resetRecipe() { $('editor').value = recipes[$('recipe').value]; }
  function stopRun(message) { if (worker) worker.terminate(); worker = null; clearTimeout(runTimer); runGeneration++; for (const c of activeRequests) c.abort(); $('run-code').disabled = false; if (message) $('lab-status').textContent = message; }
  function labLine(text) { const output = $('lab-output'); if (output.textContent.length < 40000) output.textContent += String(text).slice(0, 12000) + '\n'; }
  function runCode() {
    stopRun(); const generation = runGeneration;
    if ($('editor').value.length > 20000) return toast('Code is limited to 20 KB.');
    $('lab-output').textContent = ''; $('lab-status').textContent = 'Running…'; $('lab-status').className = ''; $('run-code').disabled = true;
    worker = new Worker('/docs/runner.js', { name: 'facepay-coding-lab' }); const currentWorker = worker; let requests = 0; let messages = 0;
    runTimer = setTimeout(() => { labLine('Stopped: execution exceeded 8 seconds.'); $('lab-status').className = 'fail'; stopRun('Execution timed out'); }, 8000);
    currentWorker.onerror = e => { labLine('Runtime error: ' + e.message); $('lab-status').className = 'fail'; stopRun('Runtime error'); };
    currentWorker.onmessage = async ({ data }) => {
      if (generation !== runGeneration || currentWorker !== worker) return;
      if (++messages > 100) return stopRun('Stopped: output/message limit reached');
      if (data.type === 'request') {
        try {
          if (++requests > 10) throw new Error('A run is limited to 10 API requests.');
          const method = String(data.method).toUpperCase();
          const result = await apiRequest(method, data.path, data.body, undefined, true);
          if (generation === runGeneration) currentWorker.postMessage({ type: 'response', id: data.id, result: { ...result, body: redact(result.body) } });
        } catch (e) { if (generation === runGeneration) currentWorker.postMessage({ type: 'response', id: data.id, error: e.message }); }
      } else if (data.type === 'log') labLine(data.text);
      else if (data.type === 'assert') labLine((data.ok ? 'PASS  ' : 'FAIL  ') + data.text);
      else if (data.type === 'done') { labLine('\nCompleted: ' + data.tests + ' assertion(s), ' + requests + ' request(s).'); $('lab-status').className = 'pass'; stopRun('Tests completed'); }
      else if (data.type === 'failed') { labLine('ERROR  ' + data.text); $('lab-status').className = 'fail'; stopRun('Test run failed'); }
    };
    currentWorker.postMessage({ type: 'run', code: $('editor').value });
  }
  $('search').oninput = renderNav;
  $('base-url').textContent = location.origin + '/v1';
  $('health-check').onclick = () => { choose(operations.find(o => o.path === '/v1/health')); $('reference').scrollIntoView(); $('request-form').requestSubmit(); };
  $('new-idem').onclick = () => { $('idem').value = crypto.randomUUID(); generateCode(); };
  for (const id of ['request-path','query','idem','request-body']) $(id).addEventListener('input', () => { validateBody(); generateCode(); });
  $('language').onchange = generateCode;
  $('bearer').oninput = () => { token = $('bearer').value.trim().replace(/^Bearer\s+/i, ''); $('auth-status').textContent = token ? 'Token loaded in memory. The server validates it on each request.' : 'Not connected'; };
  $('disconnect').onclick = () => { stopRun(); token = ''; $('bearer').value = ''; $('auth-status').textContent = 'Disconnected · token cleared'; };
  $('login').onclick = async () => {
    $('login').disabled = true; $('auth-status').textContent = 'Connecting…';
    try { const r = await apiRequest('POST', '/v1/auth/login', { email: $('demo-role').value, password: 'facepay-demo' }); if (r.status !== 200 || !r.body.token) throw new Error(r.body.error?.message || 'Sign-in failed'); token = r.body.token; $('bearer').value = ''; $('auth-status').textContent = 'Connected: ' + r.body.user.name + ' · ' + r.body.user.role + ' · JWT expires in ' + r.body.expiresIn + ' seconds'; $('auth-status').className = 'pass'; }
    catch (e) { token = ''; $('auth-status').textContent = e.message; $('auth-status').className = 'fail'; }
    finally { $('login').disabled = false; }
  };
  $('request-form').onsubmit = async event => {
    event.preventDefault(); if (!validateBody()) return; const op = selected;
    try {
      if (op.path !== allowedOperation(op.method, requestPath()).path) { toast('Select the endpoint matching this request path.'); return; }
    } catch (e) { $('response-meta').textContent = 'Invalid request path'; $('response-meta').className = 'fail'; $('response-body').textContent = e.message; return; }
    if (op.parameters?.some(p => p.name === 'Idempotency-Key' && p.required) && !$('idem').value.trim()) { toast('An Idempotency-Key is required.'); return; }
    $('send').disabled = true; $('response-meta').textContent = 'Sending…';
    try { const r = await apiRequest(op.method, requestPath(), bodyValue(), $('idem').value.trim()); showResponse(r, op); if (op.path === '/v1/auth/login' && r.status === 200 && r.body.token) { token = r.body.token; $('auth-status').textContent = 'Connected · token loaded from successful login'; } }
    catch (e) { $('response-meta').textContent = 'Request failed'; $('response-body').textContent = e.message; $('response-meta').className = 'fail'; }
    finally { $('send').disabled = false; }
  };
  async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Clipboard unavailable. Select and copy the code manually.'); } }
  $('copy-code').onclick = () => copy($('code-example').textContent); $('copy-response').onclick = () => copy(responseText);
  $('recipe').onchange = resetRecipe; $('reset-code').onclick = resetRecipe; $('run-code').onclick = runCode; $('stop-code').onclick = () => stopRun('Stopped');
  $('send-to-lab').onclick = () => { let body; try { body = bodyValue(); } catch { return toast('Fix the JSON request body first.'); } $('editor').value = 'const result = await facepay.request(' + JSON.stringify(selected.method) + ', ' + JSON.stringify(requestPath()) + (body !== undefined ? ', ' + format(body) : '') + ');\nfacepay.assert(result.status >= 200 && result.status < 300, "Request succeeds");\nfacepay.log(result.body);'; $('lab').scrollIntoView(); };
  $('download-code').onclick = () => { const blob = new Blob(['// Run with the FacePay documentation coding lab API.\n' + $('editor').value], { type: 'text/javascript' }); const url = URL.createObjectURL(blob); const a = node('a'); a.href = url; a.download = 'facepay-sandbox-test.js'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const hash = decodeURIComponent(location.hash.replace('#endpoint=', '')); const initial = operations.find(o => o.method + ' ' + o.path === hash);
  choose(initial || selected); resetRecipe();
})();
