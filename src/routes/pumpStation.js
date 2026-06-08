const express = require('express');
const router = express.Router();
const pumpService = require('../services/pumpControl');

router.post('/pump-stations/:id/data', async (req, res) => {
  try {
    const result = await pumpService.reportPumpData(req.params.id, req.body);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.get('/pump-stations', async (req, res) => {
  try {
    const result = await pumpService.listPumpStations(req.query);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.get('/pump-stations/:id', async (req, res) => {
  try {
    const result = await pumpService.getPumpStationStatus(req.params.id);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.get('/pump-stations/:id/logs', async (req, res) => {
  try {
    const result = await pumpService.getControlLogs(req.params.id, req.query);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.post('/pump-stations/:id/control', async (req, res) => {
  try {
    const result = await pumpService.manualControl(req.params.id, req.body.action, req.body.operator);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

module.exports = router;
