// Set required env vars before any module loads config
process.env.JWT_SECRET        = "test_jwt_secret_32chars_minimum!!";
process.env.VERIFY_MN_API_KEY = "test_api_key";
process.env.PORT              = "4001";
process.env.NODE_ENV          = "test";
// MONGODB_URI is overridden in globalSetup via mongodb-memory-server
process.env.MONGODB_URI       = "mongodb://127.0.0.1:27017/beauty_test";
