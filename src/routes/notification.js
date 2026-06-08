const express = require('express');
const router = express.Router();
const notificationService = require('../services/notificationPush');

router.get('/notifications', async (req, res) => {
  try {
    const result = await notificationService.getNotifications(req.query.role, req.query);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.put('/notifications/:id/read', async (req, res) => {
  try {
    const result = await notificationService.markAsRead(req.params.id);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

router.get('/notifications/unread-count', async (req, res) => {
  try {
    const result = await notificationService.getUnreadCount(req.query.role);
    res.json({ code: 0, message: 'success', data: result });
  } catch (error) {
    res.status(500).json({ code: -1, message: error.message, data: null });
  }
});

module.exports = router;
