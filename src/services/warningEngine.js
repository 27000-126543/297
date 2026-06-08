const db = require('../models');
const { pushNotification } = require('./notificationPush');
const { Op } = require('sequelize');

function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function checkNodeAnomaly(nodeId) {
  const node = await db.PipelineNode.findByPk(nodeId);
  if (!node) return [];

  const newWarnings = [];
  const checks = [
    { value: node.currentLevel, normal: node.normalLevel, type: 'level_anomaly', label: '液位' },
    { value: node.currentFlowRate, normal: node.normalFlowRate, type: 'flow_rate_anomaly', label: '流量' },
  ];

  for (const check of checks) {
    if (!check.normal || !check.value) continue;

    const ratio = check.value / check.normal;
    let warningLevel = null;
    let threshold = null;

    if (ratio > 1.5) {
      warningLevel = 'RED';
      threshold = check.normal * 1.5;
    } else if (ratio > 1.3) {
      warningLevel = 'ORANGE';
      threshold = check.normal * 1.3;
    } else if (ratio > 1.15) {
      warningLevel = 'YELLOW';
      threshold = check.normal * 1.15;
    }

    if (!warningLevel) continue;

    const existingActive = await db.Warning.findOne({
      where: {
        nodeId: node.id,
        type: check.type,
        status: 'active',
      },
      order: [['createdAt', 'DESC']],
    });

    if (existingActive) {
      const existingRatio = existingActive.actualValue / existingActive.threshold;
      if (warningLevel === existingActive.level || isLowerLevel(warningLevel, existingActive.level)) {
        continue;
      }
      await existingActive.update({ status: 'resolved', resolvedAt: new Date() });
    }

    const warning = await db.Warning.create({
      nodeId: node.id,
      level: warningLevel,
      type: check.type,
      description: `${node.name} ${check.label}异常，当前值 ${check.value} 超过阈值 ${threshold}`,
      threshold,
      actualValue: check.value,
      status: 'active',
      historySummary: await buildHistorySummary(node.id, check.type),
    });
    newWarnings.push(warning);
    await assignInspectionOrder(warning);

    if (warningLevel === 'ORANGE' || warningLevel === 'RED') {
      pushNotification('operator', 'pipeline_anomaly', { warning, node });
      pushNotification('supervisor', 'pipeline_anomaly', { warning, node });
    }
  }

  return newWarnings;
}

function isLowerLevel(newLevel, existingLevel) {
  const order = { 'YELLOW': 1, 'ORANGE': 2, 'RED': 3 };
  return (order[newLevel] || 0) <= (order[existingLevel] || 0);
}

async function checkPipelineAnomalies() {
  const nodes = await db.PipelineNode.findAll();
  const allWarnings = [];
  for (const node of nodes) {
    const nodeWarnings = await checkNodeAnomaly(node.id);
    allWarnings.push(...nodeWarnings);
  }
  return allWarnings;
}

async function assignInspectionOrder(warning, options = {}) {
  const node = await db.PipelineNode.findByPk(warning.nodeId);
  if (!node) return null;

  const whereClause = { role: 'inspector', district: node.district };
  if (options.excludeAssigneeIds && options.excludeAssigneeIds.length > 0) {
    whereClause.id = { [Op.notIn]: options.excludeAssigneeIds };
  }

  const inspectors = await db.User.findAll({ where: whereClause });
  if (inspectors.length === 0) return null;

  const nodeLat = node.location?.lat || 0;
  const nodeLng = node.location?.lng || 0;

  const inspectorScores = await Promise.all(
    inspectors.map(async (inspector) => {
      const lat = inspector.location?.lat || 0;
      const lng = inspector.location?.lng || 0;
      const distance = calculateDistance(nodeLat, nodeLng, lat, lng);
      const pendingCount = await db.InspectionOrder.count({
        where: { assigneeId: inspector.id, status: { [Op.in]: ['assigned', 'in_progress'] } },
      });
      return { inspector, distance, pendingCount };
    })
  );

  inspectorScores.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return a.pendingCount - b.pendingCount;
  });

  const chosen = inspectorScores[0].inspector;

  let dueTime;
  const now = new Date();
  switch (warning.level) {
    case 'RED':
      dueTime = new Date(now.getTime() + 30 * 60 * 1000);
      break;
    case 'ORANGE':
      dueTime = new Date(now.getTime() + 60 * 60 * 1000);
      break;
    default:
      dueTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      break;
  }

  const order = await db.InspectionOrder.create({
    warningId: warning.id,
    assigneeId: chosen.id,
    nodeId: node.id,
    title: `${warning.level}预警巡检 - ${node.name}`,
    description: warning.description,
    priority: warning.level,
    status: 'assigned',
    dueTime,
    escalationLevel: 0,
  });

  pushNotification('inspector', 'inspection_assigned', { orderId: order.id, warningId: warning.id, assigneeId: chosen.id, nodeName: node.name });

  return order;
}

async function checkOverdueOrders() {
  const now = new Date();
  const overdueOrders = await db.InspectionOrder.findAll({
    where: {
      status: { [Op.in]: ['assigned', 'in_progress'] },
      dueTime: { [Op.lt]: now },
    },
  });

  for (const order of overdueOrders) {
    const newEscalationLevel = (order.escalationLevel || 0) + 1;

    if (newEscalationLevel === 1) {
      await order.update({ escalationLevel: newEscalationLevel, status: 'timeout_escalated' });
      const warning = await db.Warning.findByPk(order.warningId);
      if (warning) {
        await assignInspectionOrder(warning, { excludeAssigneeIds: [order.assigneeId] });
      }
    } else if (newEscalationLevel >= 2) {
      await order.update({ escalationLevel: newEscalationLevel, status: 'timeout_escalated' });
      pushNotification('supervisor', 'inspection_timeout_escalated', { orderId: order.id, escalationLevel: newEscalationLevel });
    }
  }

  return overdueOrders.length;
}

async function reportNodeData(nodeId, data) {
  const record = await db.PipelineNodeData.create({
    nodeId,
    level: data.level,
    flowRate: data.flowRate,
    timestamp: new Date(),
  });

  await db.PipelineNode.update(
    {
      currentLevel: data.level,
      currentFlowRate: data.flowRate,
    },
    { where: { id: nodeId } }
  );

  const newWarnings = await checkNodeAnomaly(nodeId);

  return { record, warnings: newWarnings };
}

async function listWarnings(options = {}) {
  const { page = 1, pageSize = 20, level, status, district, nodeId } = options;
  const where = {};
  if (level) where.level = level;
  if (status) where.status = status;
  if (nodeId) where.nodeId = nodeId;

  const include = [];
  if (district) {
    include.push({
      model: db.PipelineNode,
      as: 'node',
      where: { district },
      required: true,
    });
  }

  const { count, rows } = await db.Warning.findAndCountAll({
    where,
    include,
    order: [['createdAt', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return { total: count, page, pageSize, data: rows };
}

async function listInspectionOrders(options = {}) {
  const { page = 1, pageSize = 20, status, assigneeId, nodeId } = options;
  const where = {};
  if (status) where.status = status;
  if (assigneeId) where.assigneeId = assigneeId;
  if (nodeId) where.nodeId = nodeId;

  const { count, rows } = await db.InspectionOrder.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return { total: count, page, pageSize, data: rows };
}

async function updateInspectionOrder(orderId, updateData) {
  const order = await db.InspectionOrder.findByPk(orderId);
  if (!order) return null;

  const updateFields = {};
  if (updateData.status) updateFields.status = updateData.status;
  if (updateData.fieldCondition) updateFields.fieldCondition = updateData.fieldCondition;
  if (updateData.handlingResult) updateFields.handlingResult = updateData.handlingResult;
  if (updateData.handlingPhotos) updateFields.handlingPhotos = updateData.handlingPhotos;

  if (updateData.status === 'completed') {
    updateFields.completedAt = new Date();
    if (updateData.fieldCondition) updateFields.fieldCondition = updateData.fieldCondition;
    if (updateData.handlingResult) updateFields.handlingResult = updateData.handlingResult;
    if (updateData.handlingPhotos) updateFields.handlingPhotos = updateData.handlingPhotos;
  }

  if (updateData.status === 'in_progress') {
    updateFields.status = 'in_progress';
  }

  await order.update(updateFields);

  if (updateData.status === 'completed' && order.warningId) {
    await db.Warning.update(
      { status: 'resolved', resolvedAt: new Date() },
      { where: { id: order.warningId } }
    );
  }

  return order;
}

async function buildHistorySummary(nodeId, type) {
  const recentWarnings = await db.Warning.findAll({
    where: { nodeId, type, status: 'resolved' },
    order: [['createdAt', 'DESC']],
    limit: 5,
  });

  if (recentWarnings.length === 0) return null;

  const warningIds = recentWarnings.map((w) => w.id);
  const completedOrders = await db.InspectionOrder.findAll({
    where: {
      warningId: { [Op.in]: warningIds },
      status: 'completed',
    },
  });

  const summaries = completedOrders.map((order) => ({
    warningId: order.warningId,
    completedAt: order.completedAt,
    fieldCondition: order.fieldCondition,
    handlingResult: order.handlingResult,
    handlingPhotos: order.handlingPhotos,
  }));

  const handlingResults = completedOrders
    .map((o) => o.handlingResult)
    .filter(Boolean);

  const resultCounts = {};
  for (const r of handlingResults) {
    resultCounts[r] = (resultCounts[r] || 0) + 1;
  }

  return {
    previousWarningCount: recentWarnings.length,
    previousCompletedOrders: completedOrders.length,
    recentHandlingResults: summaries,
    commonResults: Object.entries(resultCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([result, count]) => ({ result, count })),
    lastOccurredAt: recentWarnings[0]?.createdAt,
    lastResolvedAt: recentWarnings[0]?.resolvedAt,
  };
}

async function getNodeWarningStats(nodeId) {
  const node = await db.PipelineNode.findByPk(nodeId);
  if (!node) return null;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const warnings = await db.Warning.findAll({
    where: {
      nodeId,
      createdAt: { [Op.gte]: thirtyDaysAgo },
    },
    order: [['createdAt', 'DESC']],
  });

  const warningIds = warnings.map((w) => w.id);
  const orders = await db.InspectionOrder.findAll({
    where: { warningId: { [Op.in]: warningIds } },
    order: [['createdAt', 'DESC']],
  });

  const completedOrders = orders.filter((o) => o.status === 'completed' && o.completedAt);
  const totalResponseTime = completedOrders.reduce((sum, order) => {
    const warning = warnings.find((w) => w.id === order.warningId);
    if (warning && order.completedAt) {
      return sum + (new Date(order.completedAt) - new Date(warning.createdAt));
    }
    return sum;
  }, 0);
  const avgResponseTimeMs = completedOrders.length > 0 ? totalResponseTime / completedOrders.length : 0;

  const handlingResults = completedOrders.map((o) => o.handlingResult).filter(Boolean);
  const resultCounts = {};
  for (const r of handlingResults) {
    resultCounts[r] = (resultCounts[r] || 0) + 1;
  }

  const allPhotos = completedOrders.flatMap((o) => o.handlingPhotos || []);

  return {
    nodeId,
    nodeName: node.name,
    district: node.district,
    period: '30days',
    totalWarnings: warnings.length,
    activeWarnings: warnings.filter((w) => w.status === 'active').length,
    resolvedWarnings: warnings.filter((w) => w.status === 'resolved').length,
    levelDistribution: {
      RED: warnings.filter((w) => w.level === 'RED').length,
      ORANGE: warnings.filter((w) => w.level === 'ORANGE').length,
      YELLOW: warnings.filter((w) => w.level === 'YELLOW').length,
    },
    typeDistribution: {
      level_anomaly: warnings.filter((w) => w.type === 'level_anomaly').length,
      flow_rate_anomaly: warnings.filter((w) => w.type === 'flow_rate_anomaly').length,
    },
    inspectionStats: {
      totalOrders: orders.length,
      completedOrders: completedOrders.length,
      pendingOrders: orders.filter((o) => o.status === 'assigned' || o.status === 'in_progress').length,
      avgResponseTimeMinutes: avgResponseTimeMs / (1000 * 60),
    },
    commonHandlingResults: Object.entries(resultCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([result, count]) => ({ result, count })),
    recentPhotos: allPhotos.slice(0, 10),
    recentCompletedOrders: completedOrders.slice(0, 5).map((o) => ({
      id: o.id,
      warningId: o.warningId,
      completedAt: o.completedAt,
      fieldCondition: o.fieldCondition,
      handlingResult: o.handlingResult,
      handlingPhotos: o.handlingPhotos,
    })),
  };
}

module.exports = {
  checkPipelineAnomalies,
  checkNodeAnomaly,
  assignInspectionOrder,
  checkOverdueOrders,
  reportNodeData,
  listWarnings,
  listInspectionOrders,
  updateInspectionOrder,
  getNodeWarningStats,
};
