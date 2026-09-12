import { json, readJson } from './http.mjs';
import { requestError } from '../shared/generation-contract.mjs';

export function createCreditRoutes({ credits, adminAuth, readConfig, revokeAccessCode }) {
  return async (req, res, url) => {
    if (!/^\/api\/admin\/(access-codes|credit-prices|credit-operations)(\/|$)/.test(url.pathname)) return false;
    adminAuth.require(req, await readConfig());
    const body = async () => {
      const input = await readJson(req, 16384);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw requestError('管理请求必须是 JSON 对象');
      return input;
    };
    if (url.pathname === '/api/admin/access-codes') {
      if (req.method === 'GET') { json(res, 200, credits.list({ search: url.searchParams.get('search') || '', status: url.searchParams.get('status') || 'all', cursor: Number(url.searchParams.get('cursor') || 0) })); return true; }
      if (req.method === 'POST') { json(res, 201, credits.create(await body())); return true; }
    }
    if (url.pathname === '/api/admin/credit-prices') {
      if (req.method === 'GET') { json(res, 200, { prices: credits.prices() }); return true; }
      if (req.method === 'PUT') { json(res, 200, credits.setPrices(await body())); return true; }
    }
    const match = url.pathname.match(/^\/api\/admin\/access-codes\/([A-Za-z0-9_-]+)(?:\/(points|reset|ledger|unresolved))?$/);
    if (match) {
      const [, id, action] = match;
      if (req.method === 'GET' && !action) { json(res, 200, { accessCode: credits.getCode(id) }); return true; }
      if (req.method === 'GET' && action === 'ledger') { json(res, 200, credits.ledger(id, { cursor: Number(url.searchParams.get('cursor') || Number.MAX_SAFE_INTEGER) })); return true; }
      if (req.method === 'GET' && action === 'unresolved') { json(res, 200, credits.unresolved(id, { cursor: Number(url.searchParams.get('cursor') || Number.MAX_SAFE_INTEGER) })); return true; }
      let result;
      if (req.method === 'PATCH' && !action) result = credits.update(id, await body());
      if (req.method === 'DELETE' && !action) result = credits.remove(id, await body());
      if (req.method === 'POST' && action === 'points') result = credits.adjust(id, await body());
      if (req.method === 'POST' && action === 'reset') result = credits.reset(id, await body());
      if (result) {
        if (result.revoked) revokeAccessCode(id);
        json(res, 200, result); return true;
      }
    }
    const resolve = url.pathname.match(/^\/api\/admin\/credit-operations\/([A-Za-z0-9_-]+)\/resolve$/);
    if (resolve && req.method === 'POST') { json(res, 200, credits.resolve(resolve[1], await body())); return true; }
    throw requestError('接口不存在', 404);
  };
}
