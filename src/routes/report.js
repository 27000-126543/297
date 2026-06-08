const express = require('express');
const router = express.Router();
const reportService = require('../services/reportGenerator');

router.post('/reports/generate', async (req, res) => {
  try {
    const result = await reportService.generateDailyReport(req.body.reportDate, req.body.district);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.post('/reports/generate-all', async (req, res) => {
  try {
    const result = await reportService.generateAllDailyReports();
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.get('/reports', async (req, res) => {
  try {
    const result = await reportService.listReports(req.query);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.get('/reports/:id/export', async (req, res) => {
  try {
    const filePath = await reportService.exportReportToExcel(req.params.id);
    res.download(filePath);
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.post('/reports/export-batch', async (req, res) => {
  try {
    const filePath = await reportService.exportReportsBatch(req.body);
    res.download(filePath);
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

module.exports = router;
