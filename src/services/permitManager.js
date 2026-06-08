const db = require('../models');
const { pushNotification } = require('./notificationPush');
const { Op } = require('sequelize');

async function checkPermitExpiry() {
  const now = new Date();
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const permits = await db.DischargePermit.findAll({
    where: {
      status: 'valid',
      expiryDate: { [Op.lte]: thirtyDaysLater },
    },
  });

  for (const permit of permits) {
    if (permit.expiryDate < now) {
      await permit.update({
        status: 'expired',
        isRestricted: true,
        restrictedAt: now,
      });
      pushNotification('supervisor', 'permit_expired', { permitId: permit.id, enterpriseName: permit.enterpriseName });
      pushNotification('enterprise', 'permit_expired', { permitId: permit.id, enterpriseName: permit.enterpriseName });
      continue;
    }

    const daysUntilExpiry = Math.ceil((permit.expiryDate - now) / (24 * 60 * 60 * 1000));
    const milestones = [
      { type: '30d', days: 30 },
      { type: '15d', days: 15 },
      { type: '7d', days: 7 },
      { type: '1d', days: 1 },
    ];

    for (const milestone of milestones) {
      if (daysUntilExpiry <= milestone.days) {
        const existing = await db.PermitReminder.findOne({
          where: { permitId: permit.id, reminderType: milestone.type },
        });

        if (!existing) {
          const reminderDate = new Date(permit.expiryDate.getTime() - milestone.days * 24 * 60 * 60 * 1000);
          await db.PermitReminder.create({
            permitId: permit.id,
            reminderDate,
            reminderType: milestone.type,
            isSent: true,
            sentAt: now,
          });

          pushNotification('supervisor', 'permit_expiry_reminder', {
            permitId: permit.id,
            enterpriseName: permit.enterpriseName,
            daysUntilExpiry,
            reminderType: milestone.type,
          });
          pushNotification('enterprise', 'permit_expiry_reminder', {
            permitId: permit.id,
            enterpriseName: permit.enterpriseName,
            daysUntilExpiry,
            reminderType: milestone.type,
          });
        }
      }
    }
  }

  return permits.length;
}

async function restrictExpiredPermits() {
  const permits = await db.DischargePermit.findAll({
    where: {
      status: 'expired',
      isRestricted: false,
    },
  });

  for (const permit of permits) {
    await permit.update({
      isRestricted: true,
      restrictedAt: new Date(),
    });

    pushNotification('supervisor', 'permit_restricted', { permitId: permit.id, enterpriseName: permit.enterpriseName });
    pushNotification('enterprise', 'permit_restricted', { permitId: permit.id, enterpriseName: permit.enterpriseName });
  }

  return permits.length;
}

async function createPermit(data) {
  const permit = await db.DischargePermit.create({
    enterpriseName: data.enterpriseName,
    enterpriseCode: data.enterpriseCode,
    permitNumber: data.permitNumber,
    permittedVolume: data.permittedVolume,
    permittedPollutants: data.permittedPollutants,
    drainLocation: data.drainLocation,
    issueDate: data.issueDate || new Date(),
    expiryDate: data.expiryDate,
    status: 'valid',
    isRestricted: false,
  });

  return permit;
}

async function renewPermit(permitId, data) {
  const permit = await db.DischargePermit.findByPk(permitId);
  if (!permit) return null;

  await permit.update({
    expiryDate: data.expiryDate,
    status: 'valid',
    isRestricted: false,
    restrictedAt: null,
  });

  return permit;
}

async function listPermits(options = {}) {
  const { page = 1, pageSize = 20, status, enterpriseName, expiringSoon } = options;
  const where = {};
  if (status) where.status = status;
  if (enterpriseName) where.enterpriseName = { [Op.like]: `%${enterpriseName}%` };

  if (expiringSoon) {
    const now = new Date();
    const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    where.expiryDate = { [Op.between]: [now, thirtyDaysLater] };
    where.status = 'valid';
  }

  const { count, rows } = await db.DischargePermit.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return { total: count, page, pageSize, data: rows };
}

async function getPermitDetail(permitId) {
  const permit = await db.DischargePermit.findByPk(permitId, {
    include: [
      { model: db.PermitReminder, as: 'reminders' },
    ],
  });

  return permit;
}

module.exports = {
  checkPermitExpiry,
  restrictExpiredPermits,
  createPermit,
  renewPermit,
  listPermits,
  getPermitDetail,
};
