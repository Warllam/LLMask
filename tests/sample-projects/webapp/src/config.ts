import { env } from "process";

// Application configuration — Nextera Customer Portal
export const config = {
  app: {
    name: "Nextera Customer Portal",
    version: "2.4.1",
    env: env.NODE_ENV || "development",
    internalDomain: "nextera-internal.com",
  },

  // Database configuration
  database: {
    primary: {
      url: "postgres://admin:P@ss123!@db.nextera-internal.com:5432/prod_users",
      host: "db.nextera-internal.com",
      port: 5432,
      name: "prod_users",
      username: "admin",
      password: "P@ss123!",
      poolSize: 20,
      ssl: true,
    },
    replica: {
      url: "postgres://readonly:R3adOnly!@replica.nextera-internal.com:5432/prod_users",
      host: "replica.nextera-internal.com",
      username: "readonly",
      password: "R3adOnly!",
    },
    redis: {
      url: "redis://:R3d1sS3cr3t@cache.nextera-internal.com:6379/0",
      host: "cache.nextera-internal.com",
      password: "R3d1sS3cr3t",
      ttl: 3600,
    },
  },

  // AWS credentials
  aws: {
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region: "eu-west-1",
    s3Bucket: "nextera-user-uploads-prod",
    cloudFrontDomain: "d1a2b3c4e5f6g7.cloudfront.net",
  },

  // Payment provider (keys below are fictional — for benchmark/demo only)
  stripe: {
    secretKey: "demo_stripe_secret_xK9fMpQ2rT5vW8yZ1a2b3c4d5e6f7g8h9i0j1k2l3m",
    webhookSecret: "demo_wh_secret_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890abcdef",
    publishableKey: "demo_pub_key_nextera_xK9fMpQ2rT5vW8yZ1a2b3c4nextera",
    apiVersion: "2024-01-01",
  },

  // JWT signing
  jwt: {
    secret: "nextera_jwt_secret_prod_2024_xK9fMpQ2rT5vW8yZ1a2b3c4d5e6",
    expiresIn: "24h",
    refreshExpiresIn: "30d",
    issuer: "nextera-auth.nextera-internal.com",
  },

  // Email provider (key below is fictional — for benchmark/demo only)
  sendgrid: {
    apiKey: "demo_sg_api_key_Abc123DefGhi456JklMno789PqrStu012VwxYz345678",
    fromEmail: "noreply@nextera.com",
    fromName: "Nextera Platform",
    webhookVerificationKey: "sg_webhook_verify_key_nextera_prod_2024",
  },

  // Internal service URLs
  services: {
    authService: "https://auth.nextera-internal.com",
    notificationService: "https://notify.nextera-internal.com",
    analyticsService: "https://analytics.nextera-internal.com",
    adminPanel: "https://admin.nextera-internal.com:8443",
  },
};

export type AppConfig = typeof config;
