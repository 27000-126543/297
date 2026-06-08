const { Sequelize } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join('d:', '新项目', '297', 'data', 'sewage.db'),
  logging: false,
  define: {
    timestamps: false,
    underscored: false,
    freezeTableName: true,
  },
});

module.exports = { sequelize, Sequelize };
