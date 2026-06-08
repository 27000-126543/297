const usersMap = {
  'admin-token': { id: 1, name: '系统管理员', role: 'admin', district: 'all' },
  'operator-token': { id: 2, name: '运维调度员', role: 'operator', district: '东区' },
  'inspector-token': { id: 3, name: '巡查员张三', role: 'inspector', district: '东区' },
  'captain-token': { id: 4, name: '执法队长李四', role: 'enforcement_captain', district: 'all' },
  'supervisor-token': { id: 5, name: '监管员王五', role: 'supervisor', district: 'all' },
};

function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const token = authHeader.split(' ')[1];
  if (usersMap[token]) {
    req.user = usersMap[token];
  } else {
    req.user = null;
  }

  next();
}

module.exports = auth;
