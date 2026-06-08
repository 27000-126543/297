const db = require('../models');
const { pushNotification } = require('./notificationPush');
const { Op } = require('sequelize');

async function reportIllegalDischarge(reporterId, data) {
  const discharge = await db.IllegalDischarge.create({
    reporterId,
    location: data.location,
    address: data.address,
    description: data.description,
    photoUrls: data.photoUrls,
    coordinates: data.coordinates,
    status: 'reported',
  });

  await db.EvidenceTask.create({
    illegalDischargeId: discharge.id,
    coordinates: data.coordinates,
    photoUrls: data.photoUrls,
  });

  await generatePenaltySuggestion(discharge.id);

  return discharge;
}

async function generatePenaltySuggestion(illegalDischargeId) {
  const evidenceTask = await db.EvidenceTask.findOne({
    where: { illegalDischargeId },
  });

  if (!evidenceTask) return null;

  const discharge = await db.IllegalDischarge.findByPk(illegalDischargeId);
  if (!discharge) return null;

  const multiple = evidenceTask.exceedanceMultiple || 0;
  let penaltyClause;
  let penaltyAmount;

  if (multiple < 1) {
    penaltyClause = '《水污染防治法》第八十三条';
    penaltyAmount = 200000;
  } else if (multiple < 3) {
    penaltyClause = '《水污染防治法》第八十三条第一款';
    penaltyAmount = 500000;
  } else {
    penaltyClause = '《水污染防治法》第八十三条第二款';
    penaltyAmount = 1000000;
  }

  const penaltyCase = await db.PenaltyCase.create({
    illegalDischargeId,
    evidenceTaskId: evidenceTask.id,
    enterpriseName: discharge.description,
    violationType: 'illegal_discharge',
    exceedanceMultiple: multiple,
    penaltyClause,
    penaltyAmount,
    status: 'proposed',
  });

  pushNotification('enforcement_captain', 'penalty_proposed', { caseId: penaltyCase.id, illegalDischargeId });

  return penaltyCase;
}

async function approvePenaltyCase(caseId, approverId, approved) {
  const penaltyCase = await db.PenaltyCase.findByPk(caseId);
  if (!penaltyCase) return null;

  if (approved) {
    const now = new Date();
    const dateStr = now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0');
    const prefix = `CF-${dateStr}-`;

    const todayCases = await db.PenaltyCase.findAll({
      where: { ticketNumber: { [Op.like]: `${prefix}%` } },
      order: [['ticketNumber', 'DESC']],
    });

    let seq = 1;
    if (todayCases.length > 0) {
      const lastSeq = parseInt(todayCases[0].ticketNumber.split('-').pop(), 10);
      seq = lastSeq + 1;
    }

    const ticketNumber = `${prefix}${String(seq).padStart(4, '0')}`;

    await penaltyCase.update({
      status: 'approved',
      approverId,
      approvedAt: now,
      ticketNumber,
    });

    pushNotification('enterprise', 'penalty_approved', { caseId, ticketNumber, enterpriseName: penaltyCase.enterpriseName });

    await penaltyCase.update({ status: 'issued' });

    pushNotification('enterprise', 'penalty_issued', { caseId, ticketNumber, enterpriseName: penaltyCase.enterpriseName });
    pushNotification('supervisor', 'penalty_issued', { caseId, ticketNumber, enterpriseName: penaltyCase.enterpriseName });
  } else {
    await penaltyCase.update({
      status: 'rejected',
      approverId,
      approvedAt: new Date(),
    });

    const discharge = await db.IllegalDischarge.findByPk(penaltyCase.illegalDischargeId);
    if (discharge) {
      pushNotification('inspector', 'penalty_rejected', { caseId, reporterId: discharge.reporterId });
    }
  }

  return penaltyCase;
}

async function listIllegalDischarges(options = {}) {
  const { page = 1, pageSize = 20, status, district } = options;
  const where = {};
  if (status) where.status = status;

  const include = [];
  if (district) {
    include.push({
      model: db.User,
      as: 'reporter',
      where: { district },
      required: true,
    });
  }

  const { count, rows } = await db.IllegalDischarge.findAndCountAll({
    where,
    include,
    order: [['createdAt', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return { total: count, page, pageSize, data: rows };
}

async function listPenaltyCases(options = {}) {
  const { page = 1, pageSize = 20, status, enterpriseName } = options;
  const where = {};
  if (status) where.status = status;
  if (enterpriseName) where.enterpriseName = { [Op.like]: `%${enterpriseName}%` };

  const { count, rows } = await db.PenaltyCase.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return { total: count, page, pageSize, data: rows };
}

async function getPenaltyCaseDetail(caseId) {
  const penaltyCase = await db.PenaltyCase.findByPk(caseId, {
    include: [
      { model: db.IllegalDischarge, as: 'illegalDischarge' },
      { model: db.EvidenceTask, as: 'evidenceTask' },
    ],
  });

  return penaltyCase;
}

module.exports = {
  reportIllegalDischarge,
  generatePenaltySuggestion,
  approvePenaltyCase,
  listIllegalDischarges,
  listPenaltyCases,
  getPenaltyCaseDetail,
};
