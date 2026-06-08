const notifications = [];
let nextId = 1;

async function pushNotification(targetRole, event, data) {
  const notification = {
    id: nextId++,
    targetRole,
    event,
    data,
    timestamp: new Date(),
    isRead: false,
  };
  notifications.push(notification);

  try {
    const { getIO } = require('../app');
    const io = getIO();
    if (io) {
      io.to(targetRole).emit(event, data);
    }
  } catch (e) {}

  return notification;
}

async function getNotifications(targetRole, options = {}) {
  const { page = 1, pageSize = 20, event } = options;
  let filtered = notifications.filter((n) => n.targetRole === targetRole);
  if (event) {
    filtered = filtered.filter((n) => n.event === event);
  }
  filtered.sort((a, b) => b.timestamp - a.timestamp);
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const data = filtered.slice(start, start + pageSize);
  return { total, page, pageSize, data };
}

async function markAsRead(notificationId) {
  const notification = notifications.find((n) => n.id === notificationId);
  if (!notification) return null;
  notification.isRead = true;
  return notification;
}

async function getUnreadCount(targetRole) {
  return notifications.filter(
    (n) => n.targetRole === targetRole && !n.isRead
  ).length;
}

module.exports = {
  pushNotification,
  getNotifications,
  markAsRead,
  getUnreadCount,
};
