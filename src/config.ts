import dotenv from "dotenv";
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const config = {
  port: parseInt(process.env.PORT ?? "4000", 10),
  nodeEnv: process.env.NODE_ENV ?? "development",
  mongoUri: required("MONGODB_URI"),
  jwt: {
    secret: required("JWT_SECRET"),
    expiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  },
  verifyMn: {
    // Fail loudly if missing — never hardcode or log this value
    apiKey: required("VERIFY_MN_API_KEY"),
    baseUrl: "https://api.verify.mn",
    pollIntervalMs: 3_000,
    // Dev bypass: set VERIFY_MN_DEV_BYPASS=true to auto-verify without real SMS
    devBypass: process.env.VERIFY_MN_DEV_BYPASS === "true",
  },
  appBaseUrl: process.env.APP_BASE_URL ?? "",
  admin: {
    username: process.env.ADMIN_USERNAME ?? "admin",
    password: required("ADMIN_PASSWORD"),
  },
  qpay: {
    username:    required("QPAY_USERNAME"),
    password:    required("QPAY_PASSWORD"),
    invoiceCode: required("QPAY_INVOICE_CODE"),
    amount:      parseInt(process.env.QPAY_AMOUNT ?? "1000", 10),
  },
  fal: {
    key: process.env.FAL_KEY ?? "",
  },
  cloudinary: {
    cloudName:  required("CLOUDINARY_CLOUD_NAME"),
    apiKey:     required("CLOUDINARY_API_KEY"),
    apiSecret:  required("CLOUDINARY_API_SECRET"),
  },
  openai: {
    apiKey: required("OPENAI_API_KEY"),
  },
};
