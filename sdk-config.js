require('dotenv').config({ path: '.env.local' });

const { NodeSettings, LookerNodeSDK } = require('@looker/sdk-node');


const CLOUD_RUN_CONFIG_URL = process.env.CLOUD_RUN_CONFIG_URL;
console.log('CLOUD_RUN_CONFIG_URL is ', CLOUD_RUN_CONFIG_URL);

let sdk;
let configPromise;

async function initializeSDK() {
  if (sdk) return sdk;
  
  if (!configPromise) {
    configPromise = (async () => {
      const response = await fetch(CLOUD_RUN_CONFIG_URL);
      if (!response.ok) {
        throw new Error(`Failed to fetch config: ${response.statusText}`);
      }
      return await response.json();
    })();
  }
  
  const data = await configPromise;

  class EnvConfig extends NodeSettings {
    constructor(settings) {
      super('', settings);
    }

    readConfig() {
      return {
        client_id: data.LOOKERSDK_CLIENT_ID,
        client_secret: data.LOOKERSDK_CLIENT_SECRET,
      };
    }
  }

  sdk = LookerNodeSDK.init40(
    new EnvConfig({
      base_url: process.env.LOOKER_EMBED_BASE_URL,
      verify_ssl: process.env.LOOKERSDK_VERIFY_SSL === 'true',
      timeout: Number(process.env.LOOKERSDK_TIMEOUT) || 60,
    })
  );

  return sdk;
}

async function authenticate() {
  try {
    const sdkInstance = await initializeSDK();
    const session = await sdkInstance.authSession.login();
    console.log('Looker SDK authenticated successfully!');
    return session;
  } catch (error) {
    console.error('Looker Authentication Failed:', error);
    throw error;
  }
}

module.exports = { initializeSDK, authenticate };
