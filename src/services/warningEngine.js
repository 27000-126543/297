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

async function checkPipelineAnomalies() {
  const nodes = await db.PipelineNode.findAll();
  const warnings = [];

  for (const node of nodes) {
    let levelWarning = null;
    let flowWarning = null;

    if (node.normalLevel && node.currentLevel) {
      const ratio = node.currentLevel / node.normalLevel;
      if (ratio > 1.5) {
        levelWarning = { level: 'RED', type: 'level_anomaly', threshold: node.normalLevel * 1.5, actualValue: node.currentLevel };
      } else if (ratio > 1.3) {
        levelWarning = { level: 'ORANGE', type: 'level_anomaly', threshold: node.normalLevel * 1.3, actualValue: node.currentLevel };
      } else if (ratio > 1.15) {
        levelWarning = { level: 'YELLOW', type: 'level_anomaly', threshold: node.normalLevel * 1.15, actualValue: node.currentLevel };
      }
    }

    if (node.normalFlowRate && node.currentFlowRate) {
      const ratio = node.currentFlowRate / node.normalFlowRate;
      if (ratio > 1.5) {
        flowWarning = { level: 'RED', type: 'flow_rate_anomaly', threshold: node.normalFlowRate * 1.5, actualValue: node.currentFlowRate };
      } else if (ratio > 1.3) {
        flowWarning = { level: 'ORANGE', type: 'flow_rate_anomaly', threshold: node.normalFlowRate * 1.3, actualValue: node.currentFlowRate };
      } else if (ratio > 1.15) {
        flowWarning = { level: 'YELLOW', type: 'flow_rate_anomaly', threshold: node.normalFlowRate * 1.15, actualValue: node.currentFlowRate };
      }
    }

    const anomalyWarnings = [levelWarning, flowWarning].filter(Boolean);

    for (const w of anomalyWarnings) {
      const warning = await db.Warning.create({
        nodeId: node.id,
        level: w.level,
        type: w.type,
        description: `${node.name} ${w.type === 'level_anomaly' ? '液位' : '流量'}异常，当前值 ${w.actualValue} 超过阈值 ${w.threshold}`,
        threshold: w.threshold,
        actualValue: w.actualValue,
        status: 'active',
      });
      warnings.push(warning);
      await assignInspectionOrder(warning);

      if (w.level === 'ORANGE' || w.level === 'RED') {
        pushNotification('operator', 'pipeline_anomaly', { warning, node });
        pushNotification('supervisor', 'pipeline_anomaly', { warning, node });
      }
    }
  }

  return warnings;
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

  return record;
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

  const updateFields = { ...updateData };
  if (updateData.status === 'completed') {
    updateFields.completedAt = new Date();
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

module.exports = {
  checkPipelineAnomalies,
  assignInspectionOrder,
  checkOverdueOrders,
  reportNodeData,
  listWarnings,
  listInspectionOrders,
  updateInspectionOrder,
};
