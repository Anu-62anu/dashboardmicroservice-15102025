const path = require('path');
const dotenv = require('dotenv');

const { initializeFirebase } = require('../../initialize-firebase');
const { initializeSDK } = require('../../sdk-config');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });


module.exports = {
  initializeFirebase,
  initializeSDK,
};
