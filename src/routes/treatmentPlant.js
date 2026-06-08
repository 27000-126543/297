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

module.exports = router;
