/* Runs user code in a disposable Worker. CSP blocks direct network access. */
'use strict';
const pending = new Map();
let nextId = 0;
let started = false;
const emit = (type, data) => self.postMessage({ type, ...data });
self.onmessage = async ({ data }) => {
  if (data.type === 'response') {
    const job = pending.get(data.id);
    if (!job) return;
    pending.delete(data.id);
    if (data.error) job.reject(new Error(data.error)); else job.resolve(data.result);
    return;
  }
  if (data.type !== 'run' || started) return;
  started = true;
  let tests = 0;
  const api = Object.freeze({
    request(method, path, body) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        emit('request', { id, method, path, body });
      });
    },
    log(...values) { emit('log', { text: values.map(v => typeof v === 'string' ? v : JSON.stringify(v, null, 2)).join(' ').slice(0, 12000) }); },
    assert(condition, message = 'Assertion') {
      tests++;
      emit('assert', { ok: Boolean(condition), text: String(message).slice(0, 300) });
      if (!condition) throw new Error('Assertion failed: ' + message);
    },
  });
  self.fetch = () => Promise.reject(new Error('Use facepay.request() for sandbox API requests.'));
  self.XMLHttpRequest = undefined;
  self.WebSocket = undefined;
  self.EventSource = undefined;
  self.importScripts = () => { throw new Error('External scripts are disabled.'); };
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction('facepay', '"use strict";\n' + String(data.code))(api);
    emit('done', { tests });
  } catch (e) { emit('failed', { text: e instanceof Error ? e.message : String(e), tests }); }
};
