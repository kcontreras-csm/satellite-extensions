// A client for Satella, the online service Bellwood connects to (github.com/KiritoDv/Bellwood,
// src/port/net/SatellaClient.cpp). It proves an ed25519 player key and sends and receives on relay
// channels. Only web-platform APIs, so content.js and remote.js (Node) share it. The extension and the
// client folder each have their own copy (satella.js, client/satella.js); keep the two the same.

const SatellaClient = (() => {
  const HOST = 'wss://sa-695a7ab59cca49a99418ac589afaded0.ecs.us-east-1.on.aws';
  const VERSION = '1.0.0'; // Bellwood's version; Satella keeps relay channels apart by it
  const FRAME_JSON = 0x02;
  const FRAME_RAW = 0x03;
  const FRAME_PUSH = 0x04;
  const PUSH_RELAY = 1;
  const AUTH_TAG = 'satella-player-auth-v1:';
  const REPLY_TIMEOUT = 10000;
  const CHANNEL_ID = /^[A-Za-z0-9._-]{1,128}$/;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const toHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  const fromHex = hex => Uint8Array.from(hex.match(/../g) || [], h => parseInt(h, 16));
  const fromBase64Url = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  // "HM64", the frame type, the route with its u32 length, then the body.
  function frame(type, route, body = new Uint8Array(0)) {
    const routeBytes = encoder.encode(route);
    const out = new Uint8Array(9 + routeBytes.length + body.length);
    out.set([0x48, 0x4d, 0x36, 0x34, type]);
    new DataView(out.buffer).setUint32(5, routeBytes.length, true);
    out.set(routeBytes, 9);
    out.set(body, 9 + routeBytes.length);
    return out;
  }

  // Replies are "HM", the type and an i16 status. A push adds kind | u16 name length | name | 32-byte sender.
  function parse(bytes) {
    if (bytes.length < 5 || bytes[0] !== 0x48 || bytes[1] !== 0x4d) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const type = bytes[2];
    const status = view.getInt16(3, true);
    const rest = bytes.subarray(5);
    if (type !== FRAME_PUSH) return { type, status, body: type === 0x01 ? '' : decoder.decode(rest) };
    if (rest.length < 3) return null;
    const nameLength = rest[1] | (rest[2] << 8);
    if (rest.length < 3 + nameLength + 32) return null;
    const sender = rest.subarray(3 + nameLength, 3 + nameLength + 32);
    return {
      type,
      kind: rest[0],
      name: decoder.decode(rest.subarray(3, 3 + nameLength)),
      sender: sender.every(b => b === 0) ? '' : toHex(sender),
      payload: decoder.decode(rest.subarray(3 + nameLength + 32)),
    };
  }

  // A channel as Bellwood puts it on the wire when the mod gives no mod_version: "mymod.chat@1.0.0".
  const wireId = channel => `${channel}@${VERSION}`;

  // A new player key as a JWK, to keep and pass to loadIdentity later.
  async function createIdentity() {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    return crypto.subtle.exportKey('jwk', pair.privateKey);
  }

  async function loadIdentity(jwk) {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign']);
    return {
      publicKey: toHex(fromBase64Url(jwk.x)),
      sign: async bytes => new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, bytes)),
    };
  }

  class Client {
    // onRelay({ channel, sender, text }) gets every relay message; onState(state, detail) gets
    // 'connecting', 'online' (detail: whether Satella accepted the key) and 'offline' (detail: why).
    constructor({ identity, channels = [], onRelay = () => {}, onState = () => {}, host = HOST, reconnect = true }) {
      for (const channel of channels) {
        if (!CHANNEL_ID.test(channel)) throw new Error(`Invalid Satella channel "${channel}"`);
      }
      Object.assign(this, { identity, channels: [...channels], onRelay, onState, host, reconnect });
      this.ws = null;
      this.pending = null;
      this.queue = Promise.resolve();
      this.stopped = true;
      this.retryDelay = 2000;
      this.verified = false;
    }

    start() {
      if (!this.stopped) return;
      this.stopped = false;
      this.connect();
    }

    stop() {
      this.stopped = true;
      clearTimeout(this.retryTimer);
      this.ws?.close();
      this.ws = null;
    }

    get online() {
      return this.ws?.readyState === 1 && this.ready === true;
    }

    // Sends text on a channel; nothing comes back. False when not connected.
    send(channel, text) {
      if (!this.online) return false;
      this.ws.send(frame(FRAME_RAW, `/v1/relay/${wireId(channel)}/send`, encoder.encode(text)));
      return true;
    }

    // Listens on one more channel, now and after reconnecting. False when Satella refuses it.
    async subscribe(channel) {
      if (!CHANNEL_ID.test(channel)) throw new Error(`Invalid Satella channel "${channel}"`);
      if (!this.channels.includes(channel)) this.channels.push(channel);
      if (!this.online) return true; // the next handshake subscribes it
      const reply = await this.request(FRAME_JSON, `/v1/relay/${wireId(channel)}/subscribe`).catch(() => null);
      return reply?.status === 200;
    }

    // Stops passing on a channel's messages. Satella has no unsubscribe, so it stays subscribed until
    // the next reconnect.
    unsubscribe(channel) {
      this.channels = this.channels.filter(c => c !== channel);
    }

    connect() {
      this.ready = false;
      this.onState('connecting');
      const ws = new WebSocket(`${this.host}/ws?v=${VERSION}`);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onopen = () => this.handshake(ws).catch(error => this.drop(ws, error.message));
      ws.onmessage = event => this.receive(event.data);
      ws.onerror = () => {}; // followed by close, which says more
      ws.onclose = event => {
        if (this.ws !== ws) return;
        this.ws = null;
        this.ready = false;
        this.pending?.resolve(null);
        this.onState('offline', event.reason || `connection closed (${event.code})`);
        if (this.stopped || !this.reconnect) return;
        this.retryTimer = setTimeout(() => this.connect(), this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, 60000);
      };
    }

    drop(ws, why) {
      if (this.ws === ws) ws.close(4000, why);
    }

    async handshake(ws) {
      const key = this.identity.publicKey;
      await this.request(FRAME_JSON, `/v1/player/${key}/register`);
      // Prove the key so every message we send says it came from us.
      const challenge = await this.request(FRAME_JSON, '/v1/player/challenge');
      let nonce = '';
      try { nonce = JSON.parse(challenge?.body || '{}').nonce || ''; } catch (e) { /* no challenge */ }
      this.verified = false;
      if (challenge?.status === 200 && /^[0-9a-f]{64}$/i.test(nonce)) {
        const message = new Uint8Array([...encoder.encode(AUTH_TAG), ...fromHex(nonce)]);
        const reply = await this.request(FRAME_RAW, `/v1/player/${key}/verify`, await this.identity.sign(message));
        this.verified = reply?.status === 200;
      }
      for (const channel of this.channels) {
        const reply = await this.request(FRAME_JSON, `/v1/relay/${wireId(channel)}/subscribe`);
        if (reply?.status !== 200) throw new Error(`subscribing to ${channel} returned ${reply?.status ?? 'nothing'}`);
      }
      if (this.ws !== ws) return;
      this.ready = true;
      this.retryDelay = 2000;
      this.onState('online', this.verified);
    }

    // Satella answers requests in order, so one waits for the next frame that isn't a push.
    request(type, route, body) {
      const run = async () => {
        const ws = this.ws;
        if (!ws || ws.readyState !== 1) throw new Error('not connected');
        const reply = new Promise(resolve => { this.pending = { resolve }; });
        ws.send(frame(type, route, body));
        const timer = sleep(REPLY_TIMEOUT).then(() => 'timeout');
        const result = await Promise.race([reply, timer]);
        this.pending = null;
        if (result === 'timeout') {
          // A late reply would be taken for the next request's, so start over.
          this.drop(ws, `no reply to ${route}`);
          throw new Error(`no reply to ${route}`);
        }
        if (!result) throw new Error('connection closed');
        return result;
      };
      const next = this.queue.then(run, run);
      this.queue = next.catch(() => {});
      return next;
    }

    receive(data) {
      const bytes = typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data);
      const message = parse(bytes);
      if (!message) return;
      if (message.type === FRAME_PUSH) {
        if (message.kind !== PUSH_RELAY) return;
        const channel = this.channels.find(c => wireId(c) === message.name);
        if (channel) this.onRelay({ channel, sender: message.sender, text: message.payload });
        return;
      }
      this.pending?.resolve(message);
    }
  }

  // Linking a device to an OrgCS page with a one-time 8-digit code; content.js and remote.js both use it.
  // The device asks on a lobby channel named after the code's first two digits, which anyone can listen
  // to, so each side also sends a proof: an HMAC keyed by the whole code over the keys Satella proved.
  const LINK_TAG = 'orgcs-remote-link-v1';
  const link = {
    newCode() {
      let n;
      do n = crypto.getRandomValues(new Uint32Array(1))[0]; while (n >= 4200000000); // no modulo bias
      return String(n % 100000000).padStart(8, '0');
    },
    parseCode(text) {
      const code = String(text || '').replace(/[\s-]/g, '');
      return /^\d{8}$/.test(code) ? code : '';
    },
    format: code => `${code.slice(0, 4)} ${code.slice(4)}`,
    lobby: code => `orgcs-remote.link.${code.slice(0, 2)}`,
    async proof(code, ...parts) {
      const key = await crypto.subtle.importKey('raw', encoder.encode(code), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode([LINK_TAG, ...parts].join('|')))));
    },
  };

  return { Client, createIdentity, loadIdentity, isChannelId: id => CHANNEL_ID.test(id), link, HOST, VERSION };
})();

if (typeof module === 'object' && module && module.exports) module.exports = SatellaClient;
