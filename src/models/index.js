const { sequelize, Sequelize } = require('../config/database');
const { DataTypes } = Sequelize;

const PumpStation = sequelize.define('PumpStation', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  code: { type: DataTypes.STRING, allowNull: false, unique: true },
  district: { type: DataTypes.STRING },
  location: { type: DataTypes.JSON },
  capacity: { type: DataTypes.FLOAT },
  currentLevel: { type: DataTypes.FLOAT },
  currentFlow: { type: DataTypes.FLOAT },
  currentCurrent: { type: DataTypes.FLOAT },
  pumpCount: { type: DataTypes.INTEGER },
  activePumps: { type: DataTypes.INTEGER },
  status: { type: DataTypes.STRING },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
});

const PumpStationData = sequelize.define('PumpStationData', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  pumpStationId: { type: DataTypes.INTEGER, allowNull: false },
  level: { type: DataTypes.FLOAT },
  flow: { type: DataTypes.FLOAT },
  current: { type: DataTypes.FLOAT },
  pumpStatus: { type: DataTypes.JSON },
  timestamp: { type: DataTypes.DATE, allowNull: false },
});

const ControlLog = sequelize.define('ControlLog', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  pumpStationId: { type: DataTypes.INTEGER, allowNull: false },
  action: { type: DataTypes.STRING, allowNull: false },
  previousValue: { type: DataTypes.FLOAT },
  newValue: { type: DataTypes.FLOAT },
  reason: { type: DataTypes.STRING },
  operator: { type: DataTypes.STRING },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
});

const TreatmentPlant = sequelize.define('TreatmentPlant', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  code: { type: DataTypes.STRING, allowNull: false, unique: true },
  district: { type: DataTypes.STRING },
  location: { type: DataTypes.JSON },
  designCapacity: { type: DataTypes.FLOAT },
  currentLoad: { type: DataTypes.FLOAT },
  effluentStandard: { type: DataTypes.JSON },
  status: { type: DataTypes.STRING },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
});

const PlantInfluentData = sequelize.define('PlantInfluentData', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  plantId: { type: DataTypes.INTEGER, allowNull: false },
  cod: { type: DataTypes.FLOAT },
  ammoniaNitrogen: { type: DataTypes.FLOAT },
  totalPhosphorus: { type: DataTypes.FLOAT },
  suspendedSolids: { type: DataTypes.FLOAT },
  waterVolume: { type: DataTypes.FLOAT },
  ph: { type: DataTypes.FLOAT },
  timestamp: { type: DataTypes.DATE, allowNull: false },
});

const PlantEffluentData = sequelize.define('PlantEffluentData', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  plantId: { type: DataTypes.INTEGER, allowNull: false },
  cod: { type: DataTypes.FLOAT },
  ammoniaNitrogen: { type: DataTypes.FLOAT },
  totalPhosphorus: { type: DataTypes.FLOAT },
  suspendedSolids: { type: DataTypes.FLOAT },
  waterVolume: { type: DataTypes.FLOAT },
  ph: { type: DataTypes.FLOAT },
  isCompliant: { type: DataTypes.BOOLEAN },
  timestamp: { type: DataTypes.DATE, allowNull: false },
});

const LoadDistribution = sequelize.define('LoadDistribution', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  plantId: { type: DataTypes.INTEGER, allowNull: false },
  fromPlantId: { type: DataTypes.INTEGER },
  transferredLoad: { type: DataTypes.FLOAT },
  reason: { type: DataTypes.STRING },
  status: { type: DataTypes.STRING },
  confirmedAt: { type: DataTypes.DATE },
  rejectReason: { type: DataTypes.STRING },
  finalTransferredLoad: { type: DataTypes.FLOAT },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
});

const PipelineNode = sequelize.define('PipelineNode', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  code: { type: DataTypes.STRING, allowNull: false, unique: true },
  district: { type: DataTypes.STRING },
  location: { type: DataTypes.JSON },
  nodeType: { type: DataTypes.STRING },
  normalLevel: { type: DataTypes.FLOAT },
  normalFlowRate: { type: DataTypes.FLOAT },
  currentLevel: { type: DataTypes.FLOAT },
  currentFlowRate: { type: DataTypes.FLOAT },
  status: { type: DataTypes.STRING },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
});

const PipelineNodeData = sequelize.define('PipelineNodeData', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  nodeId: { type: DataTypes.INTEGER, allowNull: false },
  level: { type: DataTypes.FLOAT },
  flowRate: { type: DataTypes.FLOAT },
  timestamp: { type: DataTypes.DATE, allowNull: false },
});

const Warning = sequelize.define('Warning', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  nodeId: { type: DataTypes.INTEGER },
  pumpStationId: { type: DataTypes.INTEGER },
  level: { type: DataTypes.STRING },
  type: { type: DataTypes.STRING },
  description: { type: DataTypes.STRING },
  threshold: { type: DataTypes.FLOAT },
  actualValue: { type: DataTypes.FLOAT },
  status: { type: DataTypes.STRING },
  resolvedAt: { type: DataTypes.DATE },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
});

const InspectionOrder = sequelize.define('InspectionOrder', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  warningId: { type: DataTypes.INTEGER },
  assigneeId: { type: DataTypes.INTEGER },
  nodeId: { type: DataTypes.INTEGER },
  title: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.STRING },
  priority: { type: DataTypes.STRING },
  status: { type: DataTypes.STRING },
  dueTime: { type: DataTypes.DATE },
  completedAt: { type: DataTypes.DATE },
  escalationLevel: { type: DataTypes.INTEGER },
  fieldCondition: { type: DataTypes.TEXT },
  handlingResult: { type: DataTypes.TEXT },
  handlingPhotos: { type: DataTypes.JSON },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
});

const IllegalDischarge = sequelize.define('IllegalDischarge', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  reporterId: { type: DataTypes.INTEGER },
  location: { type: DataTypes.JSON },
  address: { type: DataTypes.STRING },
  description: { type: DataTypes.STRING },
  photoUrls: { type: DataTypes.JSON },
  coordinates: { type: DataTypes.STRING },
  status: { type: DataTypes.STRING },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
});

const EvidenceTask = sequelize.define('EvidenceTask', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  illegalDischargeId: { type: DataTypes.INTEGER, allowNull: false },
  coordinates: { type: DataTypes.STRING },
  photoUrls: { type: DataTypes.JSON },
  comparisonResult: { type: DataTypes.STRING },
  exceedanceMultiple: { type: DataTypes.FLOAT },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
});

const PenaltyCase = sequelize.define('PenaltyCase', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  illegalDischargeId: { type: DataTypes.INTEGER, allowNull: false },
  evidenceTaskId: { type: DataTypes.INTEGER },
  enterpriseName: { type: DataTypes.STRING },
  enterpriseContact: { type: DataTypes.STRING },
  violationType: { type: DataTypes.STRING },
  exceedanceMultiple: { type: DataTypes.FLOAT },
  penaltyClause: { type: DataTypes.STRING },
  penaltyAmount: { type: DataTypes.FLOAT },
  penaltySuggestion: { type: DataTypes.STRING },
  status: { type: DataTypes.STRING },
  approverId: { type: DataTypes.INTEGER },
  approvedAt: { type: DataTypes.DATE },
  ticketNumber: { type: DataTypes.STRING },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
});

const DischargePermit = sequelize.define('DischargePermit', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  enterpriseName: { type: DataTypes.STRING, allowNull: false },
  enterpriseCode: { type: DataTypes.STRING, allowNull: false },
  permitNumber: { type: DataTypes.STRING, allowNull: false, unique: true },
  permittedVolume: { type: DataTypes.FLOAT },
  permittedPollutants: { type: DataTypes.JSON },
  drainLocation: { type: DataTypes.JSON },
  issueDate: { type: DataTypes.DATE },
  expiryDate: { type: DataTypes.DATE },
  status: { type: DataTypes.STRING },
  isRestricted: { type: DataTypes.BOOLEAN, defaultValue: false },
  restrictedAt: { type: DataTypes.DATE },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
});

const PermitReminder = sequelize.define('PermitReminder', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  permitId: { type: DataTypes.INTEGER, allowNull: false },
  reminderDate: { type: DataTypes.DATE, allowNull: false },
  reminderType: { type: DataTypes.STRING, allowNull: false },
  isSent: { type: DataTypes.BOOLEAN, defaultValue: false },
  sentAt: { type: DataTypes.DATE },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
});

const FlowPrediction = sequelize.define('FlowPrediction', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  district: { type: DataTypes.STRING },
  predictedPeakFlow: { type: DataTypes.FLOAT },
  predictedPeakTime: { type: DataTypes.DATE },
  rainfallForecast: { type: DataTypes.JSON },
  confidence: { type: DataTypes.FLOAT },
  modelVersion: { type: DataTypes.STRING },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
});

const ScheduleInstruction = sequelize.define('ScheduleInstruction', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  pumpStationId: { type: DataTypes.INTEGER },
  plantId: { type: DataTypes.INTEGER },
  instructionType: { type: DataTypes.STRING, allowNull: false },
  parameters: { type: DataTypes.JSON },
  reason: { type: DataTypes.STRING },
  status: { type: DataTypes.STRING },
  confirmedAt: { type: DataTypes.DATE },
  rejectReason: { type: DataTypes.STRING },
  executedAt: { type: DataTypes.DATE },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
});

const DailyReport = sequelize.define('DailyReport', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  reportDate: { type: DataTypes.DATE, allowNull: false },
  district: { type: DataTypes.STRING },
  pumpEnergyConsumption: { type: DataTypes.FLOAT },
  plantComplianceRate: { type: DataTypes.FLOAT },
  pipelineFaultResponseTime: { type: DataTypes.FLOAT },
  illegalDischargeCases: { type: DataTypes.INTEGER },
  details: { type: DataTypes.JSON },
  fileUrl: { type: DataTypes.STRING },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
});

const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  phone: { type: DataTypes.STRING },
  role: { type: DataTypes.STRING, allowNull: false },
  district: { type: DataTypes.STRING },
  location: { type: DataTypes.JSON },
  status: { type: DataTypes.STRING },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
});

PumpStation.hasMany(PumpStationData, { foreignKey: 'pumpStationId', as: 'data' });
PumpStationData.belongsTo(PumpStation, { foreignKey: 'pumpStationId', as: 'pumpStation' });

PumpStation.hasMany(ControlLog, { foreignKey: 'pumpStationId', as: 'controlLogs' });
ControlLog.belongsTo(PumpStation, { foreignKey: 'pumpStationId', as: 'pumpStation' });

PumpStation.hasMany(Warning, { foreignKey: 'pumpStationId', as: 'warnings' });
Warning.belongsTo(PumpStation, { foreignKey: 'pumpStationId', as: 'pumpStation' });

PumpStation.hasMany(ScheduleInstruction, { foreignKey: 'pumpStationId', as: 'scheduleInstructions' });
ScheduleInstruction.belongsTo(PumpStation, { foreignKey: 'pumpStationId', as: 'pumpStation' });

TreatmentPlant.hasMany(PlantInfluentData, { foreignKey: 'plantId', as: 'influentData' });
PlantInfluentData.belongsTo(TreatmentPlant, { foreignKey: 'plantId', as: 'plant' });

TreatmentPlant.hasMany(PlantEffluentData, { foreignKey: 'plantId', as: 'effluentData' });
PlantEffluentData.belongsTo(TreatmentPlant, { foreignKey: 'plantId', as: 'plant' });

TreatmentPlant.hasMany(LoadDistribution, { foreignKey: 'plantId', as: 'incomingTransfers' });
LoadDistribution.belongsTo(TreatmentPlant, { foreignKey: 'plantId', as: 'plant' });

TreatmentPlant.hasMany(LoadDistribution, { foreignKey: 'fromPlantId', as: 'outgoingTransfers' });
LoadDistribution.belongsTo(TreatmentPlant, { foreignKey: 'fromPlantId', as: 'fromPlant' });

TreatmentPlant.hasMany(ScheduleInstruction, { foreignKey: 'plantId', as: 'scheduleInstructions' });
ScheduleInstruction.belongsTo(TreatmentPlant, { foreignKey: 'plantId', as: 'plant' });

PipelineNode.hasMany(PipelineNodeData, { foreignKey: 'nodeId', as: 'data' });
PipelineNodeData.belongsTo(PipelineNode, { foreignKey: 'nodeId', as: 'node' });

PipelineNode.hasMany(Warning, { foreignKey: 'nodeId', as: 'warnings' });
Warning.belongsTo(PipelineNode, { foreignKey: 'nodeId', as: 'node' });

PipelineNode.hasMany(InspectionOrder, { foreignKey: 'nodeId', as: 'inspectionOrders' });
InspectionOrder.belongsTo(PipelineNode, { foreignKey: 'nodeId', as: 'node' });

Warning.hasOne(InspectionOrder, { foreignKey: 'warningId', as: 'inspectionOrder' });
InspectionOrder.belongsTo(Warning, { foreignKey: 'warningId', as: 'warning' });

User.hasMany(InspectionOrder, { foreignKey: 'assigneeId', as: 'inspectionOrders' });
InspectionOrder.belongsTo(User, { foreignKey: 'assigneeId', as: 'assignee' });

User.hasMany(IllegalDischarge, { foreignKey: 'reporterId', as: 'reportedDischarges' });
IllegalDischarge.belongsTo(User, { foreignKey: 'reporterId', as: 'reporter' });

IllegalDischarge.hasOne(EvidenceTask, { foreignKey: 'illegalDischargeId', as: 'evidenceTask' });
EvidenceTask.belongsTo(IllegalDischarge, { foreignKey: 'illegalDischargeId', as: 'illegalDischarge' });

IllegalDischarge.hasOne(PenaltyCase, { foreignKey: 'illegalDischargeId', as: 'penaltyCase' });
PenaltyCase.belongsTo(IllegalDischarge, { foreignKey: 'illegalDischargeId', as: 'illegalDischarge' });

PenaltyCase.belongsTo(EvidenceTask, { foreignKey: 'evidenceTaskId', as: 'evidenceTask' });
EvidenceTask.hasOne(PenaltyCase, { foreignKey: 'evidenceTaskId', as: 'penaltyCase' });

User.hasMany(PenaltyCase, { foreignKey: 'approverId', as: 'approvedCases' });
PenaltyCase.belongsTo(User, { foreignKey: 'approverId', as: 'approver' });

DischargePermit.hasMany(PermitReminder, { foreignKey: 'permitId', as: 'reminders' });
PermitReminder.belongsTo(DischargePermit, { foreignKey: 'permitId', as: 'permit' });

const db = {
  sequelize,
  Sequelize,
  PumpStation,
  PumpStationData,
  ControlLog,
  TreatmentPlant,
  PlantInfluentData,
  PlantEffluentData,
  LoadDistribution,
  PipelineNode,
  PipelineNodeData,
  Warning,
  InspectionOrder,
  IllegalDischarge,
  EvidenceTask,
  PenaltyCase,
  DischargePermit,
  PermitReminder,
  FlowPrediction,
  ScheduleInstruction,
  DailyReport,
  User,
};

module.exports = db;
