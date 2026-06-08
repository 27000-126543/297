const db = require('../models');
const { pushNotification } = require('./notificationPush');
const { v4: uuidv4 } = require('uuid');

const POLLUTANT_FIELDS = ['cod', 'ammoniaNitrogen', 'totalPhosphorus', 'suspendedSolids', 'ph'];

function checkExceedance(data, standard) {
  if (!standard) return false;
  for (const field of POLLUTANT_FIELDS) {
    if (standard[field] !== undefined && data[field] !== undefined && data[field] > standard[field]) {
      return true;
    }
  }
  return false;
}

async function reportInfluentData(plantId, data) {
  const record = await db.PlantInfluentData.create({
    plantId,
    cod: data.cod,
    ammoniaNitrogen: data.ammoniaNitrogen,
    totalPhosphorus: data.totalPhosphorus,
    suspendedSolids: data.suspendedSolids,
    waterVolume: data.waterVolume,
    ph: data.ph,
    timestamp: new Date(),
  });

  const plant = await db.TreatmentPlant.findByPk(plantId);
  if (!plant) return record;

  const pollutantExceeded = checkExceedance(data, plant.effluentStandard);

  const projectedLoad = plant.currentLoad + (data.waterVolume || 0);
  const capacityOverloaded = projectedLoad > plant.designCapacity;

  const highRiskPollutant = pollutantExceeded && projectedLoad > plant.designCapacity * 0.7;

  if (capacityOverloaded || highRiskPollutant || pollutantExceeded) {
    let reason;
    if (capacityOverloaded) {
      reason = `capacity_overload:当前负荷${plant.currentLoad}+进水量${data.waterVolume || 0}=${projectedLoad}超过设计能力${plant.designCapacity}`;
    } else if (highRiskPollutant) {
      reason = 'high_risk_pollutant:进水超标且负荷超过70%设计能力';
    } else {
      reason = 'influent_exceedance:进水水质超标';
    }
    await redistributeLoad(plantId, reason, data.waterVolume || 0);
  }

  return record;
}

async function reportEffluentData(plantId, data) {
  const plant = await db.TreatmentPlant.findByPk(plantId);
  if (!plant) return null;

  const isCompliant = !checkExceedance(data, plant.effluentStandard);

  const record = await db.PlantEffluentData.create({
    plantId,
    cod: data.cod,
    ammoniaNitrogen: data.ammoniaNitrogen,
    totalPhosphorus: data.totalPhosphorus,
    suspendedSolids: data.suspendedSolids,
    waterVolume: data.waterVolume,
    ph: data.ph,
    isCompliant,
    timestamp: new Date(),
  });

  if (!isCompliant) {
    await redistributeLoad(plantId, 'effluent_non_compliant', 0);
    pushNotification('supervisor', 'effluent_non_compliant', {
      plantId,
      plantName: plant.name,
      data,
    });
    pushNotification('operator', 'effluent_non_compliant', {
      plantId,
      plantName: plant.name,
      data,
    });
  }

  return record;
}

async function redistributeLoad(plantId, reason, incomingWaterVolume = 0) {
  const overloadedPlant = await db.TreatmentPlant.findByPk(plantId);
  if (!overloadedPlant) return;

  const overloadAmount = (overloadedPlant.currentLoad + incomingWaterVolume) - overloadedPlant.designCapacity * 0.85;
  if (overloadAmount <= 0) return;

  let districtPlants = await db.TreatmentPlant.findAll({
    where: {
      district: overloadedPlant.district,
      id: { [db.Sequelize.Op.ne]: plantId },
    },
  });

  let availablePlants = districtPlants.filter(
    (p) => p.currentLoad < p.designCapacity * 0.85
  );

  if (availablePlants.length === 0) {
    districtPlants = await db.TreatmentPlant.findAll({
      where: {
        id: { [db.Sequelize.Op.ne]: plantId },
      },
    });
    availablePlants = districtPlants.filter(
      (p) => p.currentLoad < p.designCapacity * 0.85
    );
  }

  if (availablePlants.length === 0) return;

  const totalAvailable = availablePlants.reduce(
    (sum, p) => sum + (p.designCapacity * 0.85 - p.currentLoad),
    0
  );
  if (totalAvailable <= 0) return;

  const actualTransfer = Math.min(overloadAmount, totalAvailable);

  const groupId = uuidv4();

  for (const plant of availablePlants) {
    const available = plant.designCapacity * 0.85 - plant.currentLoad;
    const share = (available / totalAvailable) * actualTransfer;

    await db.LoadDistribution.create({
      plantId: plant.id,
      fromPlantId: plantId,
      transferredLoad: share,
      reason,
      status: 'pending',
      distributionGroupId: groupId,
    });

    await db.ScheduleInstruction.create({
      plantId: plant.id,
      instructionType: 'load_transfer',
      parameters: { transferredLoad: share, fromPlantId: plantId, fromPlantName: overloadedPlant.name, toPlantName: plant.name, distributionGroupId: groupId },
      reason,
      status: 'pending',
      distributionGroupId: groupId,
    });

    await db.ScheduleInstruction.create({
      pumpStationId: null,
      plantId: overloadedPlant.id,
      instructionType: 'load_transfer',
      parameters: { transferredLoad: share, toPlantId: plant.id, toPlantName: plant.name, distributionGroupId: groupId },
      reason,
      status: 'pending',
      distributionGroupId: groupId,
    });

    await plant.update({ currentLoad: plant.currentLoad + share });
  }

  await overloadedPlant.update({
    currentLoad: Math.max(0, overloadedPlant.currentLoad - actualTransfer + incomingWaterVolume),
  });

  pushNotification('supervisor', 'load_redistribution', {
    plantId,
    plantName: overloadedPlant.name,
    reason,
    transferredLoad: actualTransfer,
    fromPlant: { id: overloadedPlant.id, name: overloadedPlant.name },
    toPlants: availablePlants.map((p) => ({ id: p.id, name: p.name, transferredLoad: (p.designCapacity * 0.85 - p.currentLoad) / totalAvailable * actualTransfer })),
  });
  pushNotification('operator', 'load_redistribution', {
    plantId,
    plantName: overloadedPlant.name,
    reason,
    transferredLoad: actualTransfer,
    fromPlant: { id: overloadedPlant.id, name: overloadedPlant.name },
    toPlants: availablePlants.map((p) => ({ id: p.id, name: p.name, transferredLoad: (p.designCapacity * 0.85 - p.currentLoad) / totalAvailable * actualTransfer })),
  });
}

async function getPlantStatus(plantId) {
  const plant = await db.TreatmentPlant.findByPk(plantId);
  if (!plant) return null;

  const latestInfluent = await db.PlantInfluentData.findOne({
    where: { plantId },
    order: [['timestamp', 'DESC']],
  });
  const latestEffluent = await db.PlantEffluentData.findOne({
    where: { plantId },
    order: [['timestamp', 'DESC']],
  });

  return { plant, latestInfluent, latestEffluent };
}

async function listTreatmentPlants(options = {}) {
  const where = {};
  if (options.district) where.district = options.district;
  return db.TreatmentPlant.findAll({ where });
}

async function getLoadDistributionHistory(plantId, options = {}) {
  const { page = 1, pageSize = 20, startDate, endDate } = options;
  const conditions = [
    { [db.Sequelize.Op.or]: [{ plantId }, { fromPlantId: plantId }] },
  ];
  if (startDate || endDate) {
    const dateWhere = {};
    if (startDate) dateWhere[db.Sequelize.Op.gte] = new Date(startDate);
    if (endDate) dateWhere[db.Sequelize.Op.lte] = new Date(endDate);
    conditions.push({ createdAt: dateWhere });
  }
  const where = { [db.Sequelize.Op.and]: conditions };
  const { count, rows } = await db.LoadDistribution.findAndCountAll({
    where,
    include: [
      { model: db.TreatmentPlant, as: 'plant', attributes: ['id', 'name', 'district'] },
      { model: db.TreatmentPlant, as: 'fromPlant', attributes: ['id', 'name', 'district'] },
    ],
    order: [['createdAt', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  const enriched = rows.map((r) => {
    const item = r.toJSON();
    item.fromPlantName = item.fromPlant?.name || null;
    item.toPlantName = item.plant?.name || null;
    item.direction = r.fromPlantId === Number(plantId) ? 'outgoing' : 'incoming';
    item.distributionGroupId = r.distributionGroupId;
    item.parentDistributionId = r.parentDistributionId;
    item.finalTransferredLoad = r.finalTransferredLoad;
    item.confirmedAt = r.confirmedAt;
    item.rejectReason = r.rejectReason;
    return item;
  });

  return { total: count, page, pageSize, data: enriched };
}

async function confirmInstruction(instructionId) {
  const instruction = await db.ScheduleInstruction.findByPk(instructionId);
  if (!instruction) return null;
  if (instruction.status !== 'pending' && instruction.status !== 'retried') return null;

  await instruction.update({
    status: 'confirmed',
    confirmedAt: new Date(),
  });

  if (instruction.instructionType === 'load_transfer' && instruction.plantId && instruction.distributionGroupId) {
    const distribution = await db.LoadDistribution.findOne({
      where: {
        plantId: instruction.plantId,
        distributionGroupId: instruction.distributionGroupId,
        status: { [db.Sequelize.Op.in]: ['pending', 'retried'] },
      },
    });
    if (distribution) {
      await distribution.update({
        status: 'confirmed',
        confirmedAt: new Date(),
        finalTransferredLoad: distribution.transferredLoad,
      });
    }
  }

  pushNotification('supervisor', 'instruction_confirmed', {
    instructionId,
    plantId: instruction.plantId,
    instructionType: instruction.instructionType,
    distributionGroupId: instruction.distributionGroupId,
  });

  return instruction;
}

async function rejectInstruction(instructionId, rejectReason) {
  const instruction = await db.ScheduleInstruction.findByPk(instructionId);
  if (!instruction) return null;
  if (instruction.status !== 'pending' && instruction.status !== 'retried') return null;

  await instruction.update({
    status: 'rejected',
    rejectReason: rejectReason || '未说明原因',
  });

  const rejectedPlantId = instruction.plantId;
  const rejectedLoad = instruction.parameters?.transferredLoad || 0;
  const fromPlantId = instruction.parameters?.fromPlantId;
  const groupId = instruction.distributionGroupId;
  let rejectedDistributionId = null;

  if (groupId) {
    const distribution = await db.LoadDistribution.findOne({
      where: { plantId: rejectedPlantId, distributionGroupId: groupId, status: { [db.Sequelize.Op.in]: ['pending', 'retried'] } },
    });
    if (distribution) {
      rejectedDistributionId = distribution.id;
      await distribution.update({
        status: 'rejected',
        rejectReason: rejectReason || '未说明原因',
      });
    }
  } else {
    const relatedDistributions = await db.LoadDistribution.findAll({
      where: { plantId: rejectedPlantId, fromPlantId, status: { [db.Sequelize.Op.in]: ['pending', 'retried'] } },
    });
    for (const dist of relatedDistributions) {
      if (!rejectedDistributionId) rejectedDistributionId = dist.id;
      await dist.update({
        status: 'rejected',
        rejectReason: rejectReason || '未说明原因',
      });
    }
  }

  const rejectedPlant = await db.TreatmentPlant.findByPk(rejectedPlantId);
  if (rejectedPlant && rejectedLoad > 0) {
    rejectedPlant.currentLoad = Math.max(0, rejectedPlant.currentLoad - rejectedLoad);
    await rejectedPlant.save();
  }

  if (fromPlantId) {
    await retryLoadRedistribution(fromPlantId, rejectedLoad, rejectedPlantId, rejectReason, groupId, rejectedDistributionId);
  }

  pushNotification('supervisor', 'instruction_rejected', {
    instructionId,
    plantId: rejectedPlantId,
    rejectReason,
    retryAttempted: !!fromPlantId,
    distributionGroupId: groupId,
    rejectedDistributionId,
  });

  return instruction;
}

async function retryLoadRedistribution(fromPlantId, rejectedLoad, excludePlantId, originalReason, parentGroupId, rejectedDistributionId) {
  const overloadedPlant = await db.TreatmentPlant.findByPk(fromPlantId);
  if (!overloadedPlant) return;

  let allPlants = await db.TreatmentPlant.findAll({
    where: {
      id: {
        [db.Sequelize.Op.ne]: fromPlantId,
        [db.Sequelize.Op.notIn]: [excludePlantId],
      },
    },
  });

  let availablePlants = allPlants.filter(
    (p) => p.currentLoad < p.designCapacity * 0.85
  );

  let districtPlants = availablePlants.filter((p) => p.district === overloadedPlant.district);
  if (districtPlants.length > 0) {
    availablePlants = districtPlants;
  }

  if (availablePlants.length === 0) return;

  const totalAvailable = availablePlants.reduce(
    (sum, p) => sum + (p.designCapacity * 0.85 - p.currentLoad),
    0
  );
  if (totalAvailable <= 0) return;

  const actualTransfer = Math.min(rejectedLoad, totalAvailable);
  const retryGroupId = uuidv4();

  for (const plant of availablePlants) {
    const available = plant.designCapacity * 0.85 - plant.currentLoad;
    const share = (available / totalAvailable) * actualTransfer;

    await db.LoadDistribution.create({
      plantId: plant.id,
      fromPlantId,
      transferredLoad: share,
      reason: `retry_after_rejection: ${originalReason || '原接受方拒绝'}`,
      status: 'retried',
      distributionGroupId: retryGroupId,
      parentDistributionId: rejectedDistributionId || null,
    });

    await db.ScheduleInstruction.create({
      plantId: plant.id,
      instructionType: 'load_transfer',
      parameters: { transferredLoad: share, fromPlantId, fromPlantName: overloadedPlant.name, toPlantName: plant.name, isRetry: true, parentGroupId, rejectedDistributionId: rejectedDistributionId || null, distributionGroupId: retryGroupId },
      reason: `retry_after_rejection: ${originalReason || '原接受方拒绝'}`,
      status: 'retried',
      distributionGroupId: retryGroupId,
    });

    await plant.update({ currentLoad: plant.currentLoad + share });
  }

  pushNotification('operator', 'load_redistribution_retry', {
    fromPlantId,
    fromPlantName: overloadedPlant.name,
    transferredLoad: actualTransfer,
    toPlants: availablePlants.map((p) => ({ id: p.id, name: p.name })),
    reason: originalReason,
    retryGroupId,
    parentGroupId,
    rejectedDistributionId,
  });
}

async function getTransferRetrospective(options = {}) {
  const { date, fromPlantId, district } = options;
  const queryDate = date ? new Date(date) : new Date();
  const dayStart = new Date(queryDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(queryDate);
  dayEnd.setHours(23, 59, 59, 999);

  const distWhere = {
    createdAt: { [db.Sequelize.Op.gte]: dayStart, [db.Sequelize.Op.lte]: dayEnd },
  };
  if (fromPlantId) distWhere.fromPlantId = fromPlantId;

  const distributions = await db.LoadDistribution.findAll({
    where: distWhere,
    include: [
      { model: db.TreatmentPlant, as: 'plant', attributes: ['id', 'name', 'district'] },
      { model: db.TreatmentPlant, as: 'fromPlant', attributes: ['id', 'name', 'district'] },
    ],
    order: [['createdAt', 'ASC']],
  });

  if (district) {
    const filtered = distributions.filter(
      (d) => (d.plant?.district === district) || (d.fromPlant?.district === district)
    );
    return buildRetrospective(filtered, queryDate);
  }

  return buildRetrospective(distributions, queryDate);
}

function buildRetrospective(distributions, queryDate) {
  const byOverloadEvent = {};
  for (const d of distributions) {
    const key = `${d.fromPlantId}_${new Date(d.createdAt).toISOString().split('T')[0]}`;
    if (!byOverloadEvent[key]) {
      byOverloadEvent[key] = {
        fromPlantId: d.fromPlantId,
        fromPlantName: d.fromPlant?.name || null,
        fromPlantDistrict: d.fromPlant?.district || null,
        date: new Date(d.createdAt).toISOString().split('T')[0],
        reason: d.reason,
        receivers: [],
        totalTransferred: 0,
        totalConfirmed: 0,
        totalRejected: 0,
        totalRetried: 0,
        retryCount: 0,
        unclosedLoad: 0,
      };
    }
    const event = byOverloadEvent[key];
    event.totalTransferred += d.transferredLoad || 0;
    if (d.status === 'confirmed') {
      event.totalConfirmed += d.finalTransferredLoad || d.transferredLoad || 0;
    } else if (d.status === 'rejected') {
      event.totalRejected += d.transferredLoad || 0;
    } else if (d.status === 'retried') {
      event.totalRetried += d.transferredLoad || 0;
      event.retryCount++;
    } else if (d.status === 'pending') {
      event.unclosedLoad += d.transferredLoad || 0;
    }

    event.receivers.push({
      distributionId: d.id,
      toPlantId: d.plantId,
      toPlantName: d.plant?.name || null,
      toPlantDistrict: d.plant?.district || null,
      transferredLoad: d.transferredLoad,
      finalTransferredLoad: d.finalTransferredLoad || null,
      status: d.status,
      rejectReason: d.rejectReason || null,
      confirmedAt: d.confirmedAt || null,
      distributionGroupId: d.distributionGroupId,
      parentDistributionId: d.parentDistributionId || null,
    });
  }

  const events = Object.values(byOverloadEvent);

  const dailySummary = {
    date: queryDate.toISOString().split('T')[0],
    totalEvents: events.length,
    totalTransferred: events.reduce((s, e) => s + e.totalTransferred, 0),
    totalConfirmed: events.reduce((s, e) => s + e.totalConfirmed, 0),
    totalRejected: events.reduce((s, e) => s + e.totalRejected, 0),
    totalRetried: events.reduce((s, e) => s + e.totalRetried, 0),
    totalRetryCount: events.reduce((s, e) => s + e.retryCount, 0),
    totalUnclosedLoad: events.reduce((s, e) => s + e.unclosedLoad, 0),
  };

  return { dailySummary, events };
}

module.exports = {
  reportInfluentData,
  reportEffluentData,
  redistributeLoad,
  getPlantStatus,
  listTreatmentPlants,
  getLoadDistributionHistory,
  confirmInstruction,
  rejectInstruction,
  getDispatchDashboard,
  getTransferRetrospective,
};

async function getDispatchDashboard(options = {}) {
  const { plantId, district } = options;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const plantWhere = {};
  if (plantId) plantWhere.id = plantId;
  if (district) plantWhere.district = district;

  const plants = await db.TreatmentPlant.findAll({ where: plantWhere });
  const plantIds = plants.map((p) => p.id);

  const instrWhere = {
    instructionType: 'load_transfer',
    createdAt: { [db.Sequelize.Op.gte]: todayStart },
  };

  if (plantId) {
    instrWhere.plantId = Number(plantId);
  } else if (district) {
    instrWhere.plantId = { [db.Sequelize.Op.in]: plantIds };
  }

  const instructions = await db.ScheduleInstruction.findAll({
    where: instrWhere,
    include: district && !plantId ? [
      { model: db.TreatmentPlant, as: 'plant', where: { district }, attributes: ['id', 'name', 'district'] },
    ] : [
      { model: db.TreatmentPlant, as: 'plant', attributes: ['id', 'name', 'district'] },
    ],
    order: [['createdAt', 'DESC']],
  });

  const distWhere = {
    createdAt: { [db.Sequelize.Op.gte]: todayStart },
  };
  if (plantId) {
    distWhere[db.Sequelize.Op.or] = [{ plantId: Number(plantId) }, { fromPlantId: Number(plantId) }];
  } else if (district) {
    distWhere[db.Sequelize.Op.or] = [{ plantId: { [db.Sequelize.Op.in]: plantIds } }, { fromPlantId: { [db.Sequelize.Op.in]: plantIds } }];
  }

  const distributions = await db.LoadDistribution.findAll({
    where: distWhere,
    include: [
      { model: db.TreatmentPlant, as: 'plant', attributes: ['id', 'name', 'district'] },
      { model: db.TreatmentPlant, as: 'fromPlant', attributes: ['id', 'name', 'district'] },
    ],
    order: [['createdAt', 'DESC']],
  });

  const plantSummaries = plants.map((plant) => {
    const isReceiver = (d) => d.plantId === plant.id;
    const isSource = (d) => d.fromPlantId === plant.id;
    const recvDists = distributions.filter(isReceiver);
    const srcDists = distributions.filter(isSource);

    const pendingLoad = recvDists.filter((d) => d.status === 'pending').reduce((s, d) => s + (d.transferredLoad || 0), 0);
    const confirmedLoad = recvDists.filter((d) => d.status === 'confirmed').reduce((s, d) => s + (d.finalTransferredLoad || d.transferredLoad || 0), 0);
    const rejectedLoad = recvDists.filter((d) => d.status === 'rejected').reduce((s, d) => s + (d.transferredLoad || 0), 0);
    const retriedLoad = recvDists.filter((d) => d.status === 'retried').reduce((s, d) => s + (d.transferredLoad || 0), 0);

    return {
      id: plant.id,
      name: plant.name,
      district: plant.district,
      designCapacity: plant.designCapacity,
      currentLoad: plant.currentLoad,
      pendingTransferLoad: pendingLoad,
      confirmedTransferLoad: confirmedLoad,
      rejectedTransferLoad: rejectedLoad,
      retriedTransferLoad: retriedLoad,
      availableCapacity: plant.designCapacity * 0.85 - plant.currentLoad,
      totalCapacity85: plant.designCapacity * 0.85,
      totalOutgoing: srcDists.reduce((s, d) => s + (d.transferredLoad || 0), 0),
    };
  });

  const statusSummary = {
    pending: instructions.filter((i) => i.status === 'pending').length,
    confirmed: instructions.filter((i) => i.status === 'confirmed').length,
    rejected: instructions.filter((i) => i.status === 'rejected').length,
    retried: instructions.filter((i) => i.status === 'retried').length,
  };

  const transferChain = await buildTransferChains(distributions);

  return {
    statusSummary,
    plantSummaries,
    transferChain,
    totalInstructions: instructions.length,
  };
}

async function buildTransferChains(distributions) {
  const chains = [];
  const rootDistributions = distributions.filter((d) => !d.parentDistributionId);

  for (const root of rootDistributions) {
    const chain = {
      rootDistributionId: root.id,
      distributionGroupId: root.distributionGroupId,
      fromPlantId: root.fromPlantId,
      fromPlantName: root.fromPlant?.name || null,
      reason: root.reason,
      path: [formatChainNode(root)],
    };

    let currentId = root.id;
    let depth = 0;
    while (currentId && depth < 10) {
      const child = distributions.find((d) => d.parentDistributionId === currentId);
      if (!child) break;
      chain.path.push(formatChainNode(child));
      currentId = child.id;
      depth++;
    }

    chains.push(chain);
  }

  return chains;
}

function formatChainNode(dist) {
  return {
    distributionId: dist.id,
    plantId: dist.plantId,
    toPlantName: dist.plant?.name || null,
    toPlantDistrict: dist.plant?.district || null,
    transferredLoad: dist.transferredLoad,
    finalTransferredLoad: dist.finalTransferredLoad,
    status: dist.status,
    rejectReason: dist.rejectReason || null,
    confirmedAt: dist.confirmedAt || null,
    distributionGroupId: dist.distributionGroupId,
    parentDistributionId: dist.parentDistributionId || null,
  };
}
