// FreelaFlow (versão estática): conecta ao Google Agenda direto do navegador de cada pessoa,
// com o login do Google (Google Identity Services). Não há servidor: os dados ficam no aparelho.
(function () {
  const SCOPES = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events';
  const API = 'https://www.googleapis.com/calendar/v3';
  let tok = null, exp = 0, client = null, pending = null;
  const err = (code, message) => Object.assign(new Error(message || code), { code, message });
  const cid = () => String(window.FF_GOOGLE_CLIENT_ID || '').trim();

  function loadGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    return new Promise((ok, no) => {
      const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = () => ok(); s.onerror = () => no(err('gis_load_failed', 'Não foi possível carregar o login do Google. Verifique a internet e se algum bloqueador está ativo.'));
      document.head.appendChild(s);
    });
  }
  async function ensureToken() {
    if (!cid()) throw err('google_not_configured');
    if (tok && Date.now() < exp - 60000) return tok;
    await loadGis();
    if (pending) return pending;
    pending = new Promise((ok, no) => {
      try {
        client = google.accounts.oauth2.initTokenClient({
          client_id: cid(), scope: SCOPES,
          callback: (r) => {
            pending = null;
            if (r && r.access_token) { tok = r.access_token; exp = Date.now() + (+r.expires_in || 3600) * 1000; ok(tok); }
            else no(err(r && r.error === 'access_denied' ? 'not_granted' : 'needs_reauth', r && (r.error_description || r.error)));
          },
          error_callback: (e) => { pending = null; no(err(e && e.type === 'popup_closed' ? 'not_granted' : 'popup_failed', e && e.message)); },
        });
        client.requestAccessToken({ prompt: tok === null ? 'consent' : '' });
      } catch (e) { pending = null; no(err('tool_error', e.message)); }
    });
    return pending;
  }

  const iso = (t, end) => { const s = String(t || ''); return /[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : s + 'Z'; };
  function toGoogleEvent(i) {
    const o = {}; if (i.summary != null) o.summary = String(i.summary).slice(0, 1000);
    if (i.description != null) o.description = String(i.description).slice(0, 8000);
    if (i.location != null) o.location = String(i.location).slice(0, 1000);
    if (i.colorId != null && /^(?:[1-9]|1[01])$/.test(String(i.colorId))) o.colorId = String(i.colorId);
    if (i.startTime) {
      if (i.allDay) { o.start = { date: String(i.startTime).slice(0, 10) }; o.end = { date: String(i.endTime || i.startTime).slice(0, 10) }; }
      else { o.start = { dateTime: iso(i.startTime) }; o.end = { dateTime: iso(i.endTime || i.startTime, true) }; }
    }
    return o;
  }
  const calPath = (id) => { if (!id || typeof id !== 'string') throw err('tool_error', 'calendarId ausente'); return '/calendars/' + encodeURIComponent(id); };
  const TOOLS = {
    async list_calendars(call) { const r = await call('GET', '/users/me/calendarList?minAccessRole=reader&maxResults=250'); return { calendars: (r.items || []).map((x) => ({ id: x.id, summary: x.summary, timeZone: x.timeZone })) }; },
    async list_events(call, i) {
      const q = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', maxResults: String(Math.min(+i.pageSize || 250, 250)) });
      if (i.startTime) q.set('timeMin', iso(i.startTime)); if (i.endTime) q.set('timeMax', iso(i.endTime, true)); if (i.pageToken) q.set('pageToken', String(i.pageToken));
      const r = await call('GET', calPath(i.calendarId) + '/events?' + q); return { events: r.items || [], nextPageToken: r.nextPageToken || '' };
    },
    async create_event(call, i) { const r = await call('POST', calPath(i.calendarId) + '/events', toGoogleEvent(i)); return { id: r.id }; },
    async update_event(call, i) { if (!i.eventId) throw err('tool_error', 'eventId ausente'); const r = await call('PATCH', calPath(i.calendarId) + '/events/' + encodeURIComponent(i.eventId), toGoogleEvent(i)); return { id: r.id }; },
    async delete_event(call, i) { if (!i.eventId) throw err('tool_error', 'eventId ausente'); await call('DELETE', calPath(i.calendarId) + '/events/' + encodeURIComponent(i.eventId)); return { ok: true }; },
  };
  async function run(tool, input) {
    if (!TOOLS[tool]) throw err('tool_error', 'ferramenta desconhecida');
    const t = await ensureToken();
    const call = async (method, p, body) => {
      const r = await fetch(API + p, { method, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      if (r.status === 204) return {};
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) { tok = null; throw err('needs_reauth'); }
      if (r.status === 429 || (r.status === 403 && /rate|quota/i.test(JSON.stringify(j)))) throw err('rate_limited');
      if (!r.ok) throw err('tool_error', (j.error && j.error.message) || 'erro ' + r.status);
      return j;
    };
    return TOOLS[tool](call, input || {});
  }
  const caps = {
    user: async () => null, db: async () => null, downloads: async () => null,
    permissions: async () => ({ request: async (names) => { await ensureToken(); return Object.fromEntries(names.map((n) => [n, 'granted'])); } }),
    mcp: async () => ({ callTool: async (server, tool, input) => { const payload = await run(tool, input); return { payload }; } }),
  };
  window.claude = { use: async (n) => (caps[n] ? caps[n]() : null) };
  window.__ffWeb = { toGoogleEvent };
})();
