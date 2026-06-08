const express = require('express');
const router = express.Router();
const loadService = require('../services/loadDistribution');

router.post('/treatment-plants/:id/influent', async (req, res) => {
  try {
    const result = await loadService.reportInfluentData(req.params.id, req.body);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.post('/treatment-plants/:id/effluent', async (req, res) => {
  try {
    const result = await loadService.reportEffluentData(req.params.id, req.body);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.get('/treatment-plants', async (req, res) => {
  try {
    const result = await loadService.listTreatmentPlants(req.query);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.get('/treatment-plants/:id', async (req, res) => {
  try {
    const result = await loadService.getPlantStatus(req.params.id);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.get('/treatment-plants/:id/distributions', async (req, res) => {
  try {
    const result = await loadService.getLoadDistributionHistory(req.params.id, req.query);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.put('/schedule-instructions/:id/confirm', async (req, res) => {
  try {
    const result = await loadService.confirmInstruction(req.params.id);
    if (!result) return res.status(404).json({ code: -1, message: '指令不存在或状态不允许确认', data: null });
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.put('/schedule-instructions/:id/reject', async (req, res) => {
  try {
    const result = await loadService.rejectInstruction(req.params.id, req.body.rejectReason);
    if (!result) return res.status(404).json({ code: -1, message: '指令不存在或状态不允许拒绝', data: null });
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.get('/dispatch-dashboard', async (req, res) => {
  try {
    const result = await loadService.getDispatchDashboard(req.query);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.get('/transfer-retrospective', async (req, res) => {
  try {
    const result = await loadService.getTransferRetrospective(req.query);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

module.exports = router;
