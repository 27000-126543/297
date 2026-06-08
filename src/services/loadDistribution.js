const db = require('../models');
const { pushNotification } = require('./notificationPush');

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

  for (const plant of availablePlants) {
    const available = plant.designCapacity * 0.85 - plant.currentLoad;
    const share = (available / totalAvailable) * actualTransfer;

    await db.LoadDistribution.create({
      plantId: plant.id,
      fromPlantId: plantId,
      transferredLoad: share,
      reason,
      status: 'active',
    });

    await db.ScheduleInstruction.create({
      plantId: plant.id,
      instructionType: 'load_transfer',
      parameters: { transferredLoad: share, fromPlantId: plantId, fromPlantName: overloadedPlant.name, toPlantName: plant.name },
      reason,
      status: 'pending',
    });

    await db.ScheduleInstruction.create({
      pumpStationId: null,
      plantId: overloadedPlant.id,
      instructionType: 'load_transfer',
      parameters: { transferredLoad: share, toPlantId: plant.id, toPlantName: plant.name },
      reason,
      status: 'pending',
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
    return item;
  });

  return { total: count, page, pageSize, data: enriched };
}

module.exports = {
  reportInfluentData,
  reportEffluentData,
  redistributeLoad,
  getPlantStatus,
  listTreatmentPlants,
  getLoadDistributionHistory,
};
