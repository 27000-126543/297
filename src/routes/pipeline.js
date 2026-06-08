const express = require('express');
const router = express.Router();
const warningService = require('../services/warningEngine');

router.post('/pipeline-nodes/:id/data', async (req, res) => {
  try {
    const result = await warningService.reportNodeData(req.params.id, req.body);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.get('/warnings', async (req, res) => {
  try {
    const result = await warningService.listWarnings(req.query);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.get('/inspection-orders', async (req, res) => {
  try {
    const result = await warningService.listInspectionOrders(req.query);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.put('/inspection-orders/:id', async (req, res) => {
  try {
    const result = await warningService.updateInspectionOrder(req.params.id, req.body);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.post('/pipeline/check-anomalies', async (req, res) => {
  try {
    const result = await warningService.checkPipelineAnomalies();
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.post('/pipeline/check-overdue', async (req, res) => {
  try {
    const result = await warningService.checkOverdueOrders();
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

module.exports = router;
