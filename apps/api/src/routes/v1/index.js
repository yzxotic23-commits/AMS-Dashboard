import { Router } from 'express';
import authRoutes from '../../modules/auth/routes.js';
import dashboardRoutes from '../../modules/dashboard/routes.js';
import accountsRoutes from '../../modules/accounts/routes.js';
import devicesRoutes from '../../modules/devices/routes.js';
import simsRoutes from '../../modules/sims/routes.js';
import ipsRoutes from '../../modules/ips/routes.js';
import auditRoutes from '../../modules/audit/routes.js';
import bridgeRoutes from '../../modules/bridge/routes.js';
import registrationsRoutes from '../../modules/registrations/routes.js';
import bansRoutes from '../../modules/bans/routes.js';
import recoveryRoutes from '../../modules/recovery/routes.js';
import ticketsRoutes from '../../modules/tickets/routes.js';
import ipGateRoutes from '../../modules/ip-gate/routes.js';
import usersRoutes from '../../modules/users/routes.js';
import operatorsRoutes from '../../modules/operators/routes.js';
import supplyRoutes from '../../modules/supply/routes.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'ams-api',
    version: '1.0.0',
    phase: 1,
    buildTag: 'operators-roster-v1',
  });
});

router.use('/auth', authRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/accounts', accountsRoutes);
router.use('/devices', devicesRoutes);
router.use('/sims', simsRoutes);
router.use('/ips', ipsRoutes);
router.use('/audit', auditRoutes);
router.use('/bridge', bridgeRoutes);
router.use('/registrations', registrationsRoutes);
router.use('/bans', bansRoutes);
router.use('/recovery', recoveryRoutes);
router.use('/tickets', ticketsRoutes);
router.use('/ip-gate', ipGateRoutes);
router.use('/operators', operatorsRoutes);
router.use('/supply', supplyRoutes);
router.use('/users', usersRoutes);

export default router;
