const db = require('../models');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

function resolveDistrictForDischarge(discharge) {
  const addressDistrict = extractDistrictFromAddress(discharge.address || '');
  const coordDistrict = extractDistrictFromCoords(discharge);
  const reporterDistrict = discharge.reporter?.district || null;

  if (addressDistrict && coordDistrict && addressDistrict !== coordDistrict) {
    return {
      district: coordDistrict,
      attributionBasis: 'coordinate',
      attributionConflict: true,
      addressDistrict,
      coordDistrict,
      reporterDistrict,
    };
  }

  if (addressDistrict) {
    return { district: addressDistrict, attributionBasis: 'address', attributionConflict: false, reporterDistrict };
  }
  if (coordDistrict) {
    return { district: coordDistrict, attributionBasis: 'coordinate', attributionConflict: false, reporterDistrict };
  }
  if (reporterDistrict) {
    return { district: reporterDistrict, attributionBasis: 'reporter', attributionConflict: false, reporterDistrict };
  }

  return { district: null, attributionBasis: 'unknown', attributionConflict: false, reporterDistrict };
}

function extractDistrictFromAddress(address) {
  const DISTRICTS = ['东区', '西区', '南区', '北区'];
  for (const d of DISTRICTS) {
    if (address.includes(d)) return d;
  }
  return null;
}

function extractDistrictFromCoords(discharge) {
  let lat = null;
  let lng = null;
  if (discharge.location && discharge.location.lat && discharge.location.lng) {
    lat = discharge.location.lat;
    lng = discharge.location.lng;
  } else if (discharge.coordinates) {
    const parts = String(discharge.coordinates).split(',');
    if (parts.length >= 2) {
      lat = parseFloat(parts[0]);
      lng = parseFloat(parts[1]);
    }
  }
  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return null;
  return getDistrictByCoords(lat, lng);
}

function getDistrictByCoords(lat, lng) {
  const DISTRICT_BOUNDS = {
    '东区': { minLat: 30.5, maxLat: 30.7, minLng: 104.0, maxLng: 104.2 },
    '西区': { minLat: 30.5, maxLat: 30.7, minLng: 103.8, maxLng: 104.0 },
    '南区': { minLat: 30.3, maxLat: 30.5, minLng: 103.9, maxLng: 104.1 },
    '北区': { minLat: 30.7, maxLat: 30.9, minLng: 103.9, maxLng: 104.1 },
  };
  for (const [district, bounds] of Object.entries(DISTRICT_BOUNDS)) {
    if (lat >= bounds.minLat && lat <= bounds.maxLat && lng >= bounds.minLng && lng <= bounds.maxLng) {
      return district;
    }
  }
  return null;
}

async function generateDailyReport(reportDate, district) {
  let date = reportDate ? new Date(reportDate) : new Date();
  if (!reportDate) {
    date.setDate(date.getDate() - 1);
  }
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  const stations = await db.PumpStation.findAll({ where: { district } });
  const stationIds = stations.map((s) => s.id);

  const pumpData = await db.PumpStationData.findAll({
    where: {
      pumpStationId: { [db.Sequelize.Op.in]: stationIds },
      timestamp: { [db.Sequelize.Op.gte]: dayStart, [db.Sequelize.Op.lte]: dayEnd },
    },
  });

  const pumpEnergyConsumption = pumpData.reduce((sum, record) => {
    const current = record.current || 0;
    return sum + current;
  }, 0);

  const plantIds = (await db.TreatmentPlant.findAll({ where: { district } })).map((p) => p.id);

  const effluentRecords = await db.PlantEffluentData.findAll({
    where: {
      plantId: { [db.Sequelize.Op.in]: plantIds },
      timestamp: { [db.Sequelize.Op.gte]: dayStart, [db.Sequelize.Op.lte]: dayEnd },
    },
  });

  const totalEffluent = effluentRecords.length;
  const compliantEffluent = effluentRecords.filter((r) => r.isCompliant).length;
  const plantComplianceRate = totalEffluent > 0 ? (compliantEffluent / totalEffluent) * 100 : 100;

  const nodeIds = (await db.PipelineNode.findAll({ where: { district } })).map((n) => n.id);

  const warnings = await db.Warning.findAll({
    where: {
      nodeId: { [db.Sequelize.Op.in]: nodeIds },
      createdAt: { [db.Sequelize.Op.gte]: dayStart, [db.Sequelize.Op.lte]: dayEnd },
    },
  });

  const warningIds = warnings.map((w) => w.id);

  const completedOrders = await db.InspectionOrder.findAll({
    where: {
      warningId: { [db.Sequelize.Op.in]: warningIds },
      status: 'completed',
      completedAt: { [db.Sequelize.Op.ne]: null },
    },
  });

  let pipelineFaultResponseTime = 0;
  if (completedOrders.length > 0) {
    const totalResponseTime = completedOrders.reduce((sum, order) => {
      const warning = warnings.find((w) => w.id === order.warningId);
      if (warning && order.completedAt) {
        return sum + (new Date(order.completedAt) - new Date(warning.createdAt));
      }
      return sum;
    }, 0);
    pipelineFaultResponseTime = totalResponseTime / completedOrders.length / (1000 * 60);
  }

  const allDischarges = await db.IllegalDischarge.findAll({
    where: {
      createdAt: { [db.Sequelize.Op.gte]: dayStart, [db.Sequelize.Op.lte]: dayEnd },
    },
    include: [
      { model: db.User, as: 'reporter', attributes: ['id', 'name', 'district'] },
    ],
  });

  const dischargeAttributions = allDischarges.map((d) => {
    const resolved = resolveDistrictForDischarge(d);
    return { discharge: d, resolved };
  });

  const byAddress = dischargeAttributions.filter((a) => a.resolved.addressDistrict === district).length;
  const byCoordinate = dischargeAttributions.filter((a) => a.resolved.coordDistrict === district).length;
  const byReporter = dischargeAttributions.filter((a) => a.resolved.reporterDistrict === district).length;
  const byFinal = dischargeAttributions.filter((a) => a.resolved.district === district).length;

  const conflictCases = dischargeAttributions
    .filter((a) => a.resolved.attributionConflict)
    .map((a) => ({
      id: a.discharge.id,
      address: a.discharge.address,
      coordinates: a.discharge.coordinates,
      description: a.discharge.description,
      status: a.discharge.status,
      addressDistrict: a.resolved.addressDistrict,
      coordDistrict: a.resolved.coordDistrict,
      reporterDistrict: a.resolved.reporterDistrict,
      finalDistrict: a.resolved.district,
      attributionBasis: a.resolved.attributionBasis,
      conflictNote: `地址归属${a.resolved.addressDistrict}，坐标归属${a.resolved.coordDistrict}，最终按${a.resolved.attributionBasis === 'coordinate' ? '坐标' : '地址'}归属${a.resolved.district}`,
    }));

  const illegalDischargeCases = byFinal;

  const illegalDischargeDetails = dischargeAttributions
    .filter((a) => a.resolved.district === district)
    .map((a) => ({
      id: a.discharge.id,
      address: a.discharge.address,
      coordinates: a.discharge.coordinates,
      description: a.discharge.description,
      status: a.discharge.status,
      attributionBasis: a.resolved.attributionBasis,
      attributionConflict: a.resolved.attributionConflict,
      addressDistrict: a.resolved.addressDistrict,
      coordDistrict: a.resolved.coordDistrict,
      reporterDistrict: a.resolved.reporterDistrict,
    }));

  const details = {
    pumpEnergy: {
      total: pumpEnergyConsumption,
      stations: stations.map((s) => {
        const stationRecords = pumpData.filter((r) => r.pumpStationId === s.id);
        return {
          id: s.id,
          name: s.name,
          currentSum: stationRecords.reduce((sum, r) => sum + (r.current || 0), 0),
          recordCount: stationRecords.length,
        };
      }),
    },
    plantCompliance: {
      totalRecords: totalEffluent,
      compliantRecords: compliantEffluent,
      rate: plantComplianceRate,
    },
    pipelineFaults: {
      totalWarnings: warnings.length,
      completedOrders: completedOrders.length,
      avgResponseTimeMinutes: pipelineFaultResponseTime,
    },
    illegalDischarge: {
      total: illegalDischargeCases,
      cases: illegalDischargeDetails,
      attributionComparison: {
        byAddress,
        byCoordinate,
        byReporter,
        byFinal,
      },
      conflictCases,
    },
  };

  const report = await db.DailyReport.create({
    reportDate: dayStart,
    district,
    pumpEnergyConsumption,
    plantComplianceRate,
    pipelineFaultResponseTime,
    illegalDischargeCases,
    details,
  });

  return report;
}

async function generateAllDailyReports() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const allStations = await db.PumpStation.findAll({
    attributes: ['district'],
    group: ['district'],
  });
  const districts = allStations.map((s) => s.district).filter(Boolean);

  const reports = [];
  for (const district of districts) {
    const report = await generateDailyReport(yesterday, district);
    reports.push(report);
  }

  return reports;
}

async function listReports(options = {}) {
  const { page = 1, pageSize = 20, reportDate, district } = options;
  const where = {};
  if (reportDate) {
    const date = new Date(reportDate);
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);
    where.reportDate = { [db.Sequelize.Op.gte]: dayStart, [db.Sequelize.Op.lte]: dayEnd };
  }
  if (district) where.district = district;

  const { count, rows } = await db.DailyReport.findAndCountAll({
    where,
    order: [['reportDate', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return { total: count, page, pageSize, data: rows };
}

async function exportReportToExcel(reportId) {
  const report = await db.DailyReport.findByPk(reportId);
  if (!report) return null;

  const reportsDir = path.join('d:', '新项目', '297', 'data', 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const workbook = new ExcelJS.Workbook();
  const dateStr = new Date(report.reportDate).toISOString().split('T')[0];
  const fileName = `daily_report_${report.district || 'all'}_${dateStr}.xlsx`;
  const filePath = path.join(reportsDir, fileName);

  const overviewSheet = workbook.addWorksheet('运行概览');
  overviewSheet.columns = [
    { header: '指标', key: 'metric', width: 25 },
    { header: '数值', key: 'value', width: 20 },
  ];
  overviewSheet.addRow({ metric: '报告日期', value: dateStr });
  overviewSheet.addRow({ metric: '区域', value: report.district || '全部' });
  overviewSheet.addRow({ metric: '泵站能耗', value: report.pumpEnergyConsumption });
  overviewSheet.addRow({ metric: '处理厂达标率(%)', value: report.plantComplianceRate });
  overviewSheet.addRow({ metric: '管网故障响应时间(分钟)', value: report.pipelineFaultResponseTime });
  overviewSheet.addRow({ metric: '非法排污案件数', value: report.illegalDischargeCases });

  const pumpSheet = workbook.addWorksheet('泵站能耗');
  pumpSheet.columns = [
    { header: '泵站ID', key: 'id', width: 10 },
    { header: '泵站名称', key: 'name', width: 20 },
    { header: '电流合计', key: 'currentSum', width: 15 },
    { header: '记录数', key: 'recordCount', width: 10 },
  ];
  const pumpDetails = report.details?.pumpEnergy?.stations || [];
  for (const s of pumpDetails) {
    pumpSheet.addRow(s);
  }

  const complianceSheet = workbook.addWorksheet('处理厂达标');
  complianceSheet.columns = [
    { header: '指标', key: 'metric', width: 25 },
    { header: '数值', key: 'value', width: 20 },
  ];
  const compDetails = report.details?.plantCompliance || {};
  complianceSheet.addRow({ metric: '总记录数', value: compDetails.totalRecords || 0 });
  complianceSheet.addRow({ metric: '达标记录数', value: compDetails.compliantRecords || 0 });
  complianceSheet.addRow({ metric: '达标率(%)', value: compDetails.rate || 0 });

  const faultSheet = workbook.addWorksheet('管网故障');
  faultSheet.columns = [
    { header: '指标', key: 'metric', width: 25 },
    { header: '数值', key: 'value', width: 20 },
  ];
  const faultDetails = report.details?.pipelineFaults || {};
  faultSheet.addRow({ metric: '预警总数', value: faultDetails.totalWarnings || 0 });
  faultSheet.addRow({ metric: '已完成工单数', value: faultDetails.completedOrders || 0 });
  faultSheet.addRow({ metric: '平均响应时间(分钟)', value: faultDetails.avgResponseTimeMinutes || 0 });

  const illegalSheet = workbook.addWorksheet('非法排污');
  illegalSheet.columns = [
    { header: '指标', key: 'metric', width: 25 },
    { header: '数值', key: 'value', width: 20 },
  ];
  const illegalDetails = report.details?.illegalDischarge || {};
  illegalSheet.addRow({ metric: '案件总数', value: illegalDetails.total || 0 });

  const comp = illegalDetails.attributionComparison || {};
  illegalSheet.addRow({ metric: '按地址归属', value: comp.byAddress || 0 });
  illegalSheet.addRow({ metric: '按坐标归属', value: comp.byCoordinate || 0 });
  illegalSheet.addRow({ metric: '按上报人归属', value: comp.byReporter || 0 });
  illegalSheet.addRow({ metric: '最终归属(当前口径)', value: comp.byFinal || 0 });
  illegalSheet.addRow({ metric: '冲突案件数', value: (illegalDetails.conflictCases || []).length });

  if (illegalDetails.conflictCases && illegalDetails.conflictCases.length > 0) {
    const conflictSheet = workbook.addWorksheet('归属冲突案件');
    conflictSheet.columns = [
      { header: '案件ID', key: 'id', width: 10 },
      { header: '地址', key: 'address', width: 30 },
      { header: '坐标', key: 'coordinates', width: 20 },
      { header: '描述', key: 'description', width: 30 },
      { header: '地址片区', key: 'addressDistrict', width: 10 },
      { header: '坐标片区', key: 'coordDistrict', width: 10 },
      { header: '上报人片区', key: 'reporterDistrict', width: 12 },
      { header: '最终归属', key: 'finalDistrict', width: 10 },
      { header: '归属依据', key: 'attributionBasis', width: 12 },
      { header: '冲突说明', key: 'conflictNote', width: 40 },
    ];
    for (const c of illegalDetails.conflictCases) {
      conflictSheet.addRow(c);
    }
  }

  if (illegalDetails.cases && illegalDetails.cases.length > 0) {
    const caseListSheet = workbook.addWorksheet('非法排污明细');
    caseListSheet.columns = [
      { header: '案件ID', key: 'id', width: 10 },
      { header: '地址', key: 'address', width: 30 },
      { header: '坐标', key: 'coordinates', width: 20 },
      { header: '描述', key: 'description', width: 30 },
      { header: '状态', key: 'status', width: 12 },
      { header: '归属依据', key: 'attributionBasis', width: 12 },
      { header: '归属冲突', key: 'attributionConflict', width: 12 },
      { header: '地址片区', key: 'addressDistrict', width: 10 },
      { header: '坐标片区', key: 'coordDistrict', width: 10 },
      { header: '上报人片区', key: 'reporterDistrict', width: 12 },
    ];
    for (const c of illegalDetails.cases) {
      caseListSheet.addRow(c);
    }
  }

  await workbook.xlsx.writeFile(filePath);

  await report.update({ fileUrl: filePath });

  return filePath;
}

async function exportReportsBatch(options = {}) {
  const { startDate, endDate, district } = options;
  const where = {};
  if (startDate || endDate) {
    where.reportDate = {};
    if (startDate) where.reportDate[db.Sequelize.Op.gte] = new Date(startDate);
    if (endDate) where.reportDate[db.Sequelize.Op.lte] = new Date(endDate);
  }
  if (district) where.district = district;

  const reports = await db.DailyReport.findAll({ where, order: [['reportDate', 'ASC']] });
  if (reports.length === 0) return null;

  const reportsDir = path.join('d:', '新项目', '297', 'data', 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const workbook = new ExcelJS.Workbook();
  const startStr = startDate ? new Date(startDate).toISOString().split('T')[0] : 'start';
  const endStr = endDate ? new Date(endDate).toISOString().split('T')[0] : 'end';
  const districtStr = district || 'all';
  const fileName = `batch_report_${districtStr}_${startStr}_${endStr}.xlsx`;
  const filePath = path.join(reportsDir, fileName);

  const overviewSheet = workbook.addWorksheet('运行概览');
  overviewSheet.columns = [
    { header: '报告日期', key: 'reportDate', width: 15 },
    { header: '区域', key: 'district', width: 15 },
    { header: '泵站能耗', key: 'pumpEnergyConsumption', width: 15 },
    { header: '处理厂达标率(%)', key: 'plantComplianceRate', width: 18 },
    { header: '管网故障响应时间(分钟)', key: 'pipelineFaultResponseTime', width: 22 },
    { header: '非法排污案件数', key: 'illegalDischargeCases', width: 18 },
  ];
  for (const report of reports) {
    overviewSheet.addRow({
      reportDate: new Date(report.reportDate).toISOString().split('T')[0],
      district: report.district || '全部',
      pumpEnergyConsumption: report.pumpEnergyConsumption,
      plantComplianceRate: report.plantComplianceRate,
      pipelineFaultResponseTime: report.pipelineFaultResponseTime,
      illegalDischargeCases: report.illegalDischargeCases,
    });
  }

  const pumpSheet = workbook.addWorksheet('泵站能耗');
  pumpSheet.columns = [
    { header: '报告日期', key: 'reportDate', width: 15 },
    { header: '泵站ID', key: 'id', width: 10 },
    { header: '泵站名称', key: 'name', width: 20 },
    { header: '电流合计', key: 'currentSum', width: 15 },
    { header: '记录数', key: 'recordCount', width: 10 },
  ];
  for (const report of reports) {
    const stations = report.details?.pumpEnergy?.stations || [];
    for (const s of stations) {
      pumpSheet.addRow({
        reportDate: new Date(report.reportDate).toISOString().split('T')[0],
        ...s,
      });
    }
  }

  const complianceSheet = workbook.addWorksheet('处理厂达标');
  complianceSheet.columns = [
    { header: '报告日期', key: 'reportDate', width: 15 },
    { header: '总记录数', key: 'totalRecords', width: 12 },
    { header: '达标记录数', key: 'compliantRecords', width: 12 },
    { header: '达标率(%)', key: 'rate', width: 12 },
  ];
  for (const report of reports) {
    const comp = report.details?.plantCompliance || {};
    complianceSheet.addRow({
      reportDate: new Date(report.reportDate).toISOString().split('T')[0],
      totalRecords: comp.totalRecords || 0,
      compliantRecords: comp.compliantRecords || 0,
      rate: comp.rate || 0,
    });
  }

  const faultSheet = workbook.addWorksheet('管网故障');
  faultSheet.columns = [
    { header: '报告日期', key: 'reportDate', width: 15 },
    { header: '预警总数', key: 'totalWarnings', width: 12 },
    { header: '已完成工单数', key: 'completedOrders', width: 14 },
    { header: '平均响应时间(分钟)', key: 'avgResponseTimeMinutes', width: 20 },
  ];
  for (const report of reports) {
    const fault = report.details?.pipelineFaults || {};
    faultSheet.addRow({
      reportDate: new Date(report.reportDate).toISOString().split('T')[0],
      totalWarnings: fault.totalWarnings || 0,
      completedOrders: fault.completedOrders || 0,
      avgResponseTimeMinutes: fault.avgResponseTimeMinutes || 0,
    });
  }

  const illegalSheet = workbook.addWorksheet('非法排污');
  illegalSheet.columns = [
    { header: '报告日期', key: 'reportDate', width: 15 },
    { header: '案件总数', key: 'total', width: 12 },
  ];
  for (const report of reports) {
    const illegal = report.details?.illegalDischarge || {};
    illegalSheet.addRow({
      reportDate: new Date(report.reportDate).toISOString().split('T')[0],
      total: illegal.total || 0,
    });
  }

  const caseListSheet = workbook.addWorksheet('非法排污明细');
  caseListSheet.columns = [
    { header: '报告日期', key: 'reportDate', width: 15 },
    { header: '区域', key: 'district', width: 10 },
    { header: '案件ID', key: 'id', width: 10 },
    { header: '地址', key: 'address', width: 30 },
    { header: '坐标', key: 'coordinates', width: 20 },
    { header: '描述', key: 'description', width: 30 },
    { header: '状态', key: 'status', width: 12 },
    { header: '归属依据', key: 'attributionBasis', width: 12 },
    { header: '归属冲突', key: 'attributionConflict', width: 12 },
    { header: '地址片区', key: 'addressDistrict', width: 10 },
    { header: '坐标片区', key: 'coordDistrict', width: 10 },
    { header: '上报人片区', key: 'reporterDistrict', width: 12 },
  ];
  for (const report of reports) {
    const cases = report.details?.illegalDischarge?.cases || [];
    for (const c of cases) {
      caseListSheet.addRow({
        reportDate: new Date(report.reportDate).toISOString().split('T')[0],
        district: report.district,
        ...c,
      });
    }
  }

  await workbook.xlsx.writeFile(filePath);

  return filePath;
}

module.exports = {
  generateDailyReport,
  generateAllDailyReports,
  listReports,
  exportReportToExcel,
  exportReportsBatch,
};
