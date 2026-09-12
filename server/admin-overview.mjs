import { json } from './http.mjs';
import { requestError } from '../shared/generation-contract.mjs';

export function createAdminOverviewRoute({ styles, credits, adminAuth, readConfig }) {
  return async (req, res, url) => {
    if (url.pathname !== '/api/admin/overview') return false;
    adminAuth.require(req, await readConfig());
    if (req.method !== 'GET') throw requestError('接口不存在', 404);
    const now = Date.now();
    json(res, 200, { ...credits.overview(now), styles: styles.overview(), updatedAt: now });
    return true;
  };
}
