const db = require('../models');
const { pushNotification } = require('./notificationPush');

async function getRainfallForecast(district) {
  const totalMM = Math.random() * 80;
  let intensity = 'light';
  if (totalMM > 50) intensity = 'heavy';
  else if (totalMM > 25) intensity = 'moderate';
  return { totalMM, intensity, period: 'next_72h', district };
}

async function predictFlow(district) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const stations = await db.PumpStation.findAll({ where: { district } });
  const stationIds = stations.map((s) => s.id);

  if (stationIds.length === 0) {
    const rainfallForecast = await getRainfallForecast(district);
    const prediction = await db.FlowPrediction.create({
      district,
      predictedPeakFlow: 0,
      predictedPeakTime: null,
      rainfallForecast,
      confidence: 0,
      modelVersion: 'v1.0',
    });
    return { ...prediction.toJSON(), sampleSize: 0, confidenceNote: '该片区无泵站数据，无法进行有效预测' };
  }

  const stationData = await db.PumpStationData.findAll({
    where: {
      pumpStationId: { [db.Sequelize.Op.in]: stationIds },
      timestamp: { [db.Sequelize.Op.gte]: thirtyDaysAgo },
    },
  });

  const sampleSize = stationData.length;
  const rainfallForecast = await getRainfallForecast(district);
  const totalMM = rainfallForecast.totalMM;

  if (sampleSize === 0) {
    const totalCapacity = stations.reduce((sum, s) => sum + (s.capacity || 0), 0);
    const estimatedFlow = totalCapacity * 0.5;
    const prediction = await db.FlowPrediction.create({
      district,
      predictedPeakFlow: estimatedFlow,
      predictedPeakTime: null,
      rainfallForecast,
      confidence: 0.1,
      modelVersion: 'v1.0',
    });
    return { ...prediction.toJSON(), sampleSize: 0, confidenceNote: '该片区无历史流量数据，预测值基于站点总容量的50%估算，置信度极低' };
  }

  const hourlyFlow = {};
  for (const record of stationData) {
    const hour = new Date(record.timestamp).getHours();
    if (!hourlyFlow[hour]) hourlyFlow[hour] = [];
    hourlyFlow[hour].push(record.flow || 0);
  }

  const hourlyAvg = {};
  for (const hour in hourlyFlow) {
    const arr = hourlyFlow[hour];
    hourlyAvg[hour] = arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  let baseFlow = 0;
  const hourCount = Object.keys(hourlyAvg).length;
  if (hourCount === 0) {
    const totalCapacity = stations.reduce((sum, s) => sum + (s.capacity || 0), 0);
    baseFlow = totalCapacity * 0.5;
  } else {
    for (const hour in hourlyAvg) {
      baseFlow += hourlyAvg[hour];
    }
    baseFlow = baseFlow / 24;
  }

  const predictedPeakFlow = baseFlow * (1 + totalMM * 0.015);
  if (predictedPeakFlow <= 0) {
    const totalCapacity = stations.reduce((sum, s) => sum + (s.capacity || 0), 0);
    const fallback = totalCapacity * 0.4 * (1 + totalMM * 0.015);
    const prediction = await db.FlowPrediction.create({
      district,
      predictedPeakFlow: fallback,
      predictedPeakTime: null,
      rainfallForecast,
      confidence: 0.1,
      modelVersion: 'v1.0',
    });
    return { ...prediction.toJSON(), sampleSize, confidenceNote: '历史流量数据计算结果为零，已使用站点容量40%作为估算基准，置信度极低' };
  }

  let peakHour = 8;
  const morningAvg = ((hourlyAvg[8] || 0) + (hourlyAvg[9] || 0) + (hourlyAvg[10] || 0)) / (hourlyAvg[8] !== undefined ? 1 : 0) || 0.001;
  const eveningAvg = ((hourlyAvg[18] || 0) + (hourlyAvg[19] || 0) + (hourlyAvg[20] || 0)) / (hourlyAvg[18] !== undefined ? 1 : 0) || 0.001;
  if (eveningAvg > morningAvg) {
    peakHour = 18;
  }
  if (totalMM > 30) {
    peakHour = peakHour + 2;
    if (peakHour > 23) peakHour = 23;
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(peakHour, 0, 0, 0);

  let confidence;
  let confidenceNote;
  if (sampleSize < 24) {
    confidence = 0.2;
    confidenceNote = `数据样本量仅${sampleSize}条，不足1天完整数据，预测结果参考价值有限`;
  } else if (sampleSize < 168) {
    confidence = Math.max(0.3, 0.5 - (1 / sampleSize) * 10);
    confidenceNote = `数据样本量${sampleSize}条，不足1周完整数据，预测置信度较低`;
  } else if (sampleSize < 720) {
    confidence = Math.max(0.5, Math.min(0.75, 0.6 + (sampleSize / 2000)));
    confidenceNote = `数据样本量${sampleSize}条，预测置信度中等`;
  } else {
    confidence = Math.max(0.7, Math.min(0.95, 0.8 + (sampleSize / 5000) * 0.1));
    confidenceNote = `数据样本量${sampleSize}条，预测置信度较高`;
  }

  if (totalMM > 50) {
    confidence = Math.max(0.1, confidence - 0.15);
    confidenceNote += '；强降雨预报增加了不确定性';
  }

  const prediction = await db.FlowPrediction.create({
    district,
    predictedPeakFlow,
    predictedPeakTime: tomorrow,
    rainfallForecast,
    confidence,
    modelVersion: 'v1.0',
  });

  await generateScheduleInstructions(prediction);

  return { ...prediction.toJSON(), sampleSize, confidenceNote };
}

async function generateScheduleInstructions(prediction) {
  const stations = await db.PumpStation.findAll({
    where: { district: prediction.district },
  });

  for (const station of stations) {
    if (prediction.predictedPeakFlow > station.capacity * 0.8) {
      await db.ScheduleInstruction.create({
        pumpStationId: station.id,
        instructionType: 'start_additional_pumps',
        parameters: {
          predictedPeakFlow: prediction.predictedPeakFlow,
          stationCapacity: station.capacity,
          targetActivePumps: station.pumpCount,
        },
        reason: `预测峰值流量 ${prediction.predictedPeakFlow.toFixed(2)} 超过站点容量80% (${(station.capacity * 0.8).toFixed(2)})`,
        status: 'pending',
      });
    }
  }

  const plants = await db.TreatmentPlant.findAll({
    where: { district: prediction.district },
  });

  for (const plant of plants) {
    if (prediction.predictedPeakFlow > plant.currentLoad + plant.designCapacity * 0.3) {
      await db.ScheduleInstruction.create({
        plantId: plant.id,
        instructionType: 'prepare_for_increased_load',
        parameters: {
          predictedPeakFlow: prediction.predictedPeakFlow,
          currentLoad: plant.currentLoad,
          designCapacity: plant.designCapacity,
        },
        reason: `预测峰值流量 ${prediction.predictedPeakFlow.toFixed(2)} 超过当前负荷+设计容量30% (${(plant.currentLoad + plant.designCapacity * 0.3).toFixed(2)})`,
        status: 'pending',
      });
    }
  }

  pushNotification('operator', 'schedule_instruction_generated', {
    district: prediction.district,
    predictedPeakFlow: prediction.predictedPeakFlow,
    predictedPeakTime: prediction.predictedPeakTime,
  });
  pushNotification('supervisor', 'schedule_instruction_generated', {
    district: prediction.district,
    predictedPeakFlow: prediction.predictedPeakFlow,
    predictedPeakTime: prediction.predictedPeakTime,
  });
}

async function getPredictions(options = {}) {
  const { page = 1, pageSize = 20, district } = options;
  const where = {};
  if (district) where.district = district;

  const { count, rows } = await db.FlowPrediction.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return { total: count, page, pageSize, data: rows };
}

async function getScheduleInstructions(options = {}) {
  const { page = 1, pageSize = 20, status } = options;
  const where = {};
  if (status) where.status = status;

  const { count, rows } = await db.ScheduleInstruction.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return { total: count, page, pageSize, data: rows };
}

async function executeScheduleInstruction(instructionId) {
  const instruction = await db.ScheduleInstruction.findByPk(instructionId);
  if (!instruction) return null;

  await instruction.update({
    status: 'executed',
    executedAt: new Date(),
  });

  return instruction;
}

module.exports = {
  predictFlow,
  generateScheduleInstructions,
  getRainfallForecast,
  getPredictions,
  getScheduleInstructions,
  executeScheduleInstruction,
};
