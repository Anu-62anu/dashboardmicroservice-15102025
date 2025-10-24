const { createApp } = require('./src/app');
const { initializeSDK } = require('./src/config');

const PORT = process.env.PORT || 3200;

(async () => {
  try {
    const sdk = await initializeSDK();
    if (!sdk) {
      console.log("Failed to initialize sdk");
    }
    const app = createApp(sdk);

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
})();
