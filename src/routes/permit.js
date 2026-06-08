const express = require('express');
const router = express.Router();
const permitService = require('../services/permitManager');

router.get('/permits', async (req, res) => {
  try {
    const result = await permitService.listPermits(req.query);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.get('/permits/:id', async (req, res) => {
  try {
    const result = await permitService.getPermitDetail(req.params.id);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.post('/permits', async (req, res) => {
  try {
    const result = await permitService.createPermit(req.body);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.put('/permits/:id/renew', async (req, res) => {
  try {
    const result = await permitService.renewPermit(req.params.id, req.body);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.post('/permits/check-expiry', async (req, res) => {
  try {
    const result = await permitService.checkPermitExpiry();
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.post('/permits/restrict-expired', async (req, res) => {
  try {
    const result = await permitService.restrictExpiredPermits();
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

module.exports = router;
