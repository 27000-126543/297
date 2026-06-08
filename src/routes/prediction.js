const express = require('express');
const router = express.Router();
const predictionService = require('../services/flowPrediction');

router.post('/predictions/:district', async (req, res) => {
  try {
    const result = await predictionService.predictFlow(req.params.district);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.get('/predictions', async (req, res) => {
  try {
    const result = await predictionService.getPredictions(req.query);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.get('/schedule-instructions', async (req, res) => {
  try {
    const result = await predictionService.getScheduleInstructions(req.query);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.put('/schedule-instructions/:id/execute', async (req, res) => {
  try {
    const result = await predictionService.executeScheduleInstruction(req.params.id);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

module.exports = router;
