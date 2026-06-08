const db = require('../models');
const { pushNotification } = require('./notificationPush');

async function reportPumpData(stationId, data) {
  const record = await db.PumpStationData.create({
    pumpStationId: stationId,
    level: data.level,
    flow: data.flow,
    current: data.current,
    pumpStatus: data.pumpStatus,
    timestamp: new Date(),
  });

  await db.PumpStation.update(
    {
      currentLevel: data.level,
      currentFlow: data.flow,
      currentCurrent: data.current,
    },
    { where: { id: stationId } }
  );

  await evaluateAndControl(stationId);
  return record;
}

async function evaluateAndControl(stationId) {
  const station = await db.PumpStation.findByPk(stationId);
  if (!station) return;

  const levelPercent = (station.currentLevel / station.capacity) * 100;
  let action = null;
  let previousValue = null;
  let newValue = null;
  let reason = null;
  let newActivePumps = station.activePumps;
  let newCurrent = station.currentCurrent;
  let newStatus = station.status;

  if (levelPercent > 85) {
    if (station.activePumps < station.pumpCount) {
      previousValue = station.activePumps;
      newActivePumps = station.pumpCount;
      newValue = newActivePumps;
      action = 'start_pump';
      reason = 'high_level_auto_start';
    }
    newStatus = 'critical';
  } else if (levelPercent > 70) {
    previousValue = station.currentCurrent;
    newCurrent = station.currentCurrent * 1.1;
    newValue = newCurrent;
    action = 'frequency_up';
    reason = 'medium_level_frequency_up';
    newStatus = 'warning';
  } else if (levelPercent < 15) {
    if (station.activePumps > 1) {
      previousValue = station.activePumps;
      newActivePumps = 1;
      newValue = newActivePumps;
      action = 'stop_pump';
      reason = 'very_low_level_auto_stop';
    }
    newStatus = 'low';
  } else if (levelPercent < 30) {
    previousValue = station.currentCurrent;
    newCurrent = station.currentCurrent * 0.9;
    newValue = newCurrent;
    action = 'frequency_down';
    reason = 'low_level_frequency_down';
    newStatus = 'normal';
  } else {
    newStatus = 'normal';
  }

  if (action) {
    await db.ControlLog.create({
      pumpStationId: stationId,
      action,
      previousValue,
      newValue,
      reason,
      operator: 'auto',
    });
    pushNotification('operator', reason, {
      stationId,
      stationName: station.name,
      levelPercent,
    });
  }

  await db.PumpStation.update(
    {
      activePumps: newActivePumps,
      currentCurrent: newCurrent,
      status: newStatus,
    },
    { where: { id: stationId } }
  );
}

async function getControlLogs(stationId, options = {}) {
  const { page = 1, pageSize = 20, startDate, endDate } = options;
  const where = { pumpStationId: stationId };
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt[db.Sequelize.Op.gte] = new Date(startDate);
    if (endDate) where.createdAt[db.Sequelize.Op.lte] = new Date(endDate);
  }
  const { count, rows } = await db.ControlLog.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  return { total: count, page, pageSize, data: rows };
}

async function getPumpStationStatus(stationId) {
  const station = await db.PumpStation.findByPk(stationId);
  if (!station) return null;
  const latestData = await db.PumpStationData.findOne({
    where: { pumpStationId: stationId },
    order: [['timestamp', 'DESC']],
  });
  return { station, latestData };
}

async function listPumpStations(options = {}) {
  const where = {};
  if (options.district) where.district = options.district;
  return db.PumpStation.findAll({ where });
}

async function manualControl(stationId, action, operator) {
  const station = await db.PumpStation.findByPk(stationId);
  if (!station) return null;

  let previousValue = null;
  let newValue = null;
  let controlAction = null;
  let newActivePumps = station.activePumps;
  let newCurrent = station.currentCurrent;

  switch (action) {
    case 'start':
      previousValue = station.activePumps;
      newActivePumps = Math.min(station.activePumps + 1, station.pumpCount);
      newValue = newActivePumps;
      controlAction = 'start_pump';
      break;
    case 'stop':
      previousValue = station.activePumps;
      newActivePumps = Math.max(station.activePumps - 1, 1);
      newValue = newActivePumps;
      controlAction = 'stop_pump';
      break;
    case 'adjust':
      previousValue = station.currentCurrent;
      newCurrent = station.currentCurrent * 1.1;
      newValue = newCurrent;
      controlAction = 'frequency_adjust';
      break;
    default:
      return null;
  }

  await db.ControlLog.create({
    pumpStationId: stationId,
    action: controlAction,
    previousValue,
    newValue,
    reason: 'manual_control',
    operator: 'manual',
  });

  await db.PumpStation.update(
    {
      activePumps: newActivePumps,
      currentCurrent: newCurrent,
    },
    { where: { id: stationId } }
  );

  pushNotification('operator', 'manual_control', {
    stationId,
    stationName: station.name,
    action,
    operator,
  });
}

module.exports = {
  reportPumpData,
  evaluateAndControl,
  getControlLogs,
  getPumpStationStatus,
  listPumpStations,
  manualControl,
};
