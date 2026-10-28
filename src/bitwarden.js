// Envoltorio de la CLI de Bitwarden (`bw`). La clave de sesión vive solo en memoria y se pasa por entorno, no por argumentos.
const { spawn } = require('child_process');

function run(bin, args, env) {
  return new Promise((resolve, reject) => {
    let out = '', err = '';
    const p = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => p.kill(), 60000);
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', code => { clearTimeout(timer); resolve({ code, out, err: err.trim() }); });
  });
}

module.exports = class Bitwarden {
  constructor() {
    this.bin = process.env.BW_PATH || 'bw';
    this.session = null;
  }

  env(extra) {
    return { ...process.env, BW_NOINTERACTION: 'true', ...(this.session ? { BW_SESSION: this.session } : {}), ...extra };
  }

  async exec(args, extra) {
    const r = await run(this.bin, args, this.env(extra));
    if (r.code !== 0) {
      if (/locked|session key|not logged in/i.test(r.err)) this.session = null;
      throw new Error(r.err || `bw salió con código ${r.code}`);
    }
    return r.out;
  }

  async available() {
    try { await this.exec(['--version']); return true; } catch (e) { return e.code !== 'ENOENT' && !/ENOENT/.test(String(e)); }
  }

  // 'unauthenticated' | 'locked' | 'unlocked'
  async status() {
    const s = JSON.parse(await this.exec(['status'])).status;
    return s === 'unlocked' && !this.session ? 'locked' : s;
  }

  async unlock(password) {
    this.session = (await this.exec(['unlock', '--passwordenv', 'LLMB_BW_PW', '--raw'], { LLMB_BW_PW: password })).trim();
  }

  lock() { this.session = null; }

  // Cuentas (tipo login) de la bóveda que casan con la URL.
  async logins(url) {
    const items = JSON.parse(await this.exec(['list', 'items', '--url', url]));
    return items.filter(i => i.login).map(i => ({
      id: i.id, name: i.name, username: i.login.username || '', hasPassword: !!i.login.password, hasTotp: !!i.login.totp,
    }));
  }

  async credentials(id) {
    const { login } = JSON.parse(await this.exec(['get', 'item', id]));
    return { username: login.username || '', password: login.password || '' };
  }

  async totp(id) { return (await this.exec(['get', 'totp', id])).trim(); }
};
