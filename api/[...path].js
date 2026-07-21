module.exports = async function handler(req, res) {
  const BACKEND = 'http://101.34.214.130';
  const path = (req.query.path || []).join('/');
  const qs = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
  const targetUrl = `${BACKEND}/api/${path}${qs}`;
  
  try {
    const headers = {};
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
    if (req.headers.cookie) headers['Cookie'] = req.headers.cookie;

    const fetchOptions = { method: req.method, headers };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);

    const setCookie = response.headers.get('set-cookie');
    if (setCookie) res.setHeader('Set-Cookie', setCookie);
    const ct = response.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);

    const body = await response.text();
    res.status(response.status).send(body);
  } catch (err) {
    res.status(502).json({ error: 'Backend unreachable' });
  }
};
