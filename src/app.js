const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const cron = require('node-cron');

const db = require('./models');
const auth = require('./middleware/auth');

const pumpStationRoutes = require('./routes/pumpStation');
const pipelineRoutes = require('./routes/pipeline');
const treatmentPlantRoutes = require('./routes/treatmentPlant');
const illegalDischargeRoutes = require('./routes/illegalDischarge');
const permitRoutes = require('./routes/permit');
const predictionRoutes = require('./routes/prediction');
const notificationRoutes = require('./routes/notification');
const reportRoutes = require('./routes/report');

const warningService = require('./services/warningEngine');
const permitService = require('./services/permitManager');
const predictionService = require('./services/flowPrediction');
const reportService = require('./services/reportGenerator');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
app.use(auth);

app.use('/api', pumpStationRoutes);
app.use('/api', pipelineRoutes);
app.use('/api', treatmentPlantRoutes);
app.use('/api', illegalDischargeRoutes);
app.use('/api', permitRoutes);
app.use('/api', predictionRoutes);
app.use('/api', notificationRoutes);
app.use('/api', reportRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

let io = null;

function getIO() {
  return io;
}

io = new Server(server, {
  cors: { origin: '*' },
});

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on('join_role', (role) => {
    socket.join(role);
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

cron.schedule('*/5 * * * *', async () => {
  try {
    await warningService.checkPipelineAnomalies();
    await warningService.checkOverdueOrders();
  } catch (err) {
    console.error('Cron error (5min):', err.message);
  }
});

cron.schedule('0 * * * *', async () => {
  try {
    await permitService.checkPermitExpiry();
    await permitService.restrictExpiredPermits();
  } catch (err) {
    console.error('Cron error (hourly):', err.message);
  }
});

cron.schedule('0 */6 * * *', async () => {
  try {
    const stations = await db.PumpStation.findAll({ attributes: ['district'], group: ['district'] });
    const districts = stations.map(s => s.district).filter(Boolean);
    for (const district of districts) {
      await predictionService.predictFlow(district);
    }
  } catch (err) {
    console.error('Cron error (6h):', err.message);
  }
});

cron.schedule('30 0 * * *', async () => {
  try {
    await reportService.generateAllDailyReports();
  } catch (err) {
    console.error('Cron error (daily):', err.message);
  }
});

async function seedData() {
  const stationCount = await db.PumpStation.count();
  if (stationCount > 0) return;

  await db.PumpStation.bulkCreate([
    {
      name: '东区1号泵站',
      code: 'PS-EAST-01',
      district: '东区',
      location: { lat: 30.57, lng: 104.07 },
      capacity: 5000,
      currentLevel: 3.2,
      currentFlow: 1200,
      currentCurrent: 45,
      pumpCount: 4,
      activePumps: 2,
      status: 'normal',
    },
    {
      name: '西区1号泵站',
      code: 'PS-WEST-01',
      district: '西区',
      location: { lat: 30.67, lng: 103.97 },
      capacity: 4500,
      currentLevel: 2.8,
      currentFlow: 980,
      currentCurrent: 38,
      pumpCount: 3,
      activePumps: 2,
      status: 'normal',
    },
    {
      name: '南区1号泵站',
      code: 'PS-SOUTH-01',
      district: '南区',
      location: { lat: 30.47, lng: 104.07 },
      capacity: 6000,
      currentLevel: 3.5,
      currentFlow: 1500,
      currentCurrent: 52,
      pumpCount: 5,
      activePumps: 3,
      status: 'normal',
    },
  ]);

  await db.TreatmentPlant.bulkCreate([
    {
      name: '东区污水处理厂',
      code: 'TP-EAST-01',
      district: '东区',
      location: { lat: 30.55, lng: 104.10 },
      designCapacity: 10000,
      currentLoad: 6500,
      effluentStandard: { cod: 50, ammoniaNitrogen: 5, totalPhosphorus: 0.5, suspendedSolids: 10 },
      status: 'normal',
    },
    {
      name: '西区污水处理厂',
      code: 'TP-WEST-01',
      district: '西区',
      location: { lat: 30.68, lng: 103.95 },
      designCapacity: 8000,
      currentLoad: 5200,
      effluentStandard: { cod: 50, ammoniaNitrogen: 5, totalPhosphorus: 0.5, suspendedSolids: 10 },
      status: 'normal',
    },
  ]);

  await db.PipelineNode.bulkCreate([
    {
      name: '东区主管节点A',
      code: 'PN-EAST-A',
      district: '东区',
      location: { lat: 30.56, lng: 104.06 },
      nodeType: 'main',
      normalLevel: 2.5,
      normalFlowRate: 800,
      currentLevel: 2.5,
      currentFlowRate: 800,
      status: 'normal',
    },
    {
      name: '东区主管节点B',
      code: 'PN-EAST-B',
      district: '东区',
      location: { lat: 30.58, lng: 104.08 },
      nodeType: 'branch',
      normalLevel: 2.0,
      normalFlowRate: 500,
      currentLevel: 2.0,
      currentFlowRate: 500,
      status: 'normal',
    },
    {
      name: '西区主管节点A',
      code: 'PN-WEST-A',
      district: '西区',
      location: { lat: 30.66, lng: 103.96 },
      nodeType: 'main',
      normalLevel: 2.2,
      normalFlowRate: 700,
      currentLevel: 2.2,
      currentFlowRate: 700,
      status: 'normal',
    },
    {
      name: '南区主管节点A',
      code: 'PN-SOUTH-A',
      district: '南区',
      location: { lat: 30.46, lng: 104.06 },
      nodeType: 'main',
      normalLevel: 2.8,
      normalFlowRate: 900,
      currentLevel: 2.8,
      currentFlowRate: 900,
      status: 'normal',
    },
  ]);

  await db.User.bulkCreate([
    { name: '系统管理员', role: 'admin', district: 'all', status: 'active' },
    { name: '运维调度员', role: 'operator', district: '东区', status: 'active' },
    { name: '巡查员张三', role: 'inspector', district: '东区', location: { lat: 30.57, lng: 104.07 }, status: 'active' },
    { name: '执法队长李四', role: 'enforcement_captain', district: 'all', status: 'active' },
    { name: '监管员王五', role: 'supervisor', district: 'all', status: 'active' },
  ]);

  console.log('Seed data created');
}

const PORT = process.env.PORT || 3000;

db.sequelize.sync({ alter: false, force: false }).then(async () => {
  await seedData();
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch((err) => {
  console.error('DB sync failed:', err);
});

module.exports = { app, server, getIO };
