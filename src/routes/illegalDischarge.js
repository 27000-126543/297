const express = require('express');
const router = express.Router();
const enforcementService = require('../services/enforcement');

router.post('/illegal-discharges', async (req, res) => {
  try {
    const result = await enforcementService.reportIllegalDischarge(req.user?.id || req.body.reporterId, req.body);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.get('/illegal-discharges', async (req, res) => {
  try {
    const result = await enforcementService.listIllegalDischarges(req.query);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.get('/penalty-cases', async (req, res) => {
  try {
    const result = await enforcementService.listPenaltyCases(req.query);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.get('/penalty-cases/:id', async (req, res) => {
  try {
    const result = await enforcementService.getPenaltyCaseDetail(req.params.id);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.post('/penalty-cases/:id/approve', async (req, res) => {
  try {
    const result = await enforcementService.approvePenaltyCase(req.params.id, req.body.approverId, req.body.approved);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

module.exports = router;
